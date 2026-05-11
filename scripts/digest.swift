#!/usr/bin/env swift

// digest.swift — Stock News Digest pipeline for the Stock Game app.
//
// Fetches per-ticker Yahoo Finance RSS, two-stage filters (keyword pre-filter
// then Apple Intelligence relevance scoring), archives surviving articles
// per-day, then generates time-windowed prose digests (1D / 1W / 1M / 3M / 1Y)
// for each ticker. Output is written to a single digests.json the web app
// reads directly.
//
// Apple Intelligence is the only AI engine — no Claude / cloud fallback.
// If `LanguageModelSession.isAvailable` is false, the run is skipped and
// the previous digests.json keeps serving.
//
// Usage:
//   swift digest.swift                    # all tickers, default config
//   swift digest.swift HON                # specific tickers only
//   swift digest.swift HON AAPL --verbose
//   swift digest.swift --check            # availability probe and exit
//   swift digest.swift --dry-run HON      # fetch + filter, write nothing
//   swift digest.swift --output PATH      # override digests.json destination
//   swift digest.swift --fetch-only       # fetch + archive, skip digest gen
//   swift digest.swift --digests-only     # regenerate digests from archive

import Foundation
import FoundationModels

// MARK: - Configuration

let DEFAULT_TICKERS = [
    "ASTS","AMZN","UBER","SERV","AAPL","QCOM","ISRG","CRSP","HON","EXOD",
    "TSLA","NVDA","AVGO","MRVL","CRDO","PLTR","ORCL","ZS","VST","VRT",
    "COHR","CRWV","GFS","GOOGL","NBIS","QBTS","RKLB","S","SPY",
]

let TICKER_NAMES: [String: String] = [
    "ASTS": "AST SpaceMobile",
    "AMZN": "Amazon",
    "UBER": "Uber",
    "SERV": "Serve Robotics",
    "AAPL": "Apple",
    "QCOM": "Qualcomm",
    "ISRG": "Intuitive Surgical",
    "CRSP": "CRISPR Therapeutics",
    "HON": "Honeywell",
    "EXOD": "Exodus Movement",
    "TSLA": "Tesla",
    "NVDA": "NVIDIA",
    "AVGO": "Broadcom",
    "MRVL": "Marvell",
    "CRDO": "Credo Technology",
    "PLTR": "Palantir",
    "ORCL": "Oracle",
    "ZS": "Zscaler",
    "VST": "Vistra",
    "VRT": "Vertiv",
    "COHR": "Coherent",
    "CRWV": "CoreWeave",
    "GFS": "GlobalFoundries",
    "GOOGL": "Alphabet",
    "NBIS": "Nebius Group",
    "QBTS": "D-Wave Quantum",
    "RKLB": "Rocket Lab",
    "S": "SentinelOne",
    "SPY": "S&P 500 ETF",
]

let RELEVANCE_THRESHOLD = 6
let DESC_TRUNCATE = 400

// Player roster — mirrors lib/picks.ts on the web side. The IDs match the
// route segments at /portfolio/{id}. If the roster changes there, change it
// here too (or, future work, generate this from picks.ts at build time).
struct PlayerRoster {
    let id: String         // "brian" | "kevin" | "rick" | "lee"
    let name: String
    let tickers: [String]
}

let PLAYERS: [PlayerRoster] = [
    PlayerRoster(id: "brian",  name: "Brian",
        tickers: ["ASTS","AMZN","UBER","SERV","AAPL","QCOM","ISRG","CRSP","HON","EXOD"]),
    PlayerRoster(id: "kevin",  name: "Kevin",
        tickers: ["TSLA","NVDA","AVGO","MRVL","CRDO","PLTR","ORCL","ZS","VST","VRT"]),
    PlayerRoster(id: "rick",   name: "Rick",
        tickers: ["COHR","CRWV","GFS","GOOGL","NBIS","QBTS","NVDA","RKLB","S","TSLA"]),
    PlayerRoster(id: "lee",    name: "Lee",
        tickers: ["SPY"]),
]

// Inverse of PLAYERS: which player ids own each ticker. Used to tag articles
// with their owner so the LLM sees ownership inline (e.g. "[NVDA/kevin,rick]").
// Owners preserve PLAYERS iteration order so the tag is deterministic.
let TICKER_OWNERS: [String: [String]] = {
    var m: [String: [String]] = [:]
    for p in PLAYERS {
        for t in p.tickers {
            m[t, default: []].append(p.id)
        }
    }
    return m
}()

func ownerSuffix(forTicker t: String) -> String {
    let owners = TICKER_OWNERS[t] ?? []
    return owners.isEmpty ? "" : "/\(owners.joined(separator: ","))"
}

// Sports/entertainment company list — exemption to "sports" rejection rule.
let SPORTS_COMPANIES: Set<String> = []  // none today; add e.g. "DKNG" if picked

let REJECT_KEYWORDS: [String] = [
    "arrested", "charged with", "sexual", "assault",
    "opens new store in", "opens location in", "grand opening", "ribbon cutting",
    "donates to", "charity", "sponsoring", "scholarship", "community event",
    "obituary", "funeral", "passed away",
    "recipe", "food review", "travel guide",
    "sports", "nfl", "nba", "mlb", "nhl",
]

let ACCEPT_KEYWORDS: [String] = [
    "earnings", "revenue", "profit", "loss", "guidance", "forecast", "outlook",
    "merger", "acquisition", "buyout", "deal", "joint venture",
    "ipo", "share buyback", "dividend",
    "ceo", "cfo", "cto", "chief", "board", "appoints", "resigns",
    "fda", "approval", "regulatory", "sec", "doj", "ftc", "antitrust",
    "product launch", "new product", "announced",
    "layoffs", "restructuring", "cost cutting",
    "analyst", "upgrade", "downgrade", "price target",
    "quarterly", "annual", "fiscal", "q1", "q2", "q3", "q4",
    "beat", "miss", "estimate", "market share",
    "patent", "supply chain", "tariff", "trade",
]

// MARK: - Paths

let HOME = FileManager.default.homeDirectoryForCurrentUser
let DEFAULT_REPO_ROOT = HOME.appendingPathComponent("Repos/stock-game")
let DEFAULT_OUTPUT = DEFAULT_REPO_ROOT.appendingPathComponent("public/digests.json")
let ARCHIVE_DIR = HOME.appendingPathComponent("StockDigests")
let ARTICLES_DIR = ARCHIVE_DIR.appendingPathComponent("articles")
let LOG_FILE = ARCHIVE_DIR.appendingPathComponent("digest.log")
let ERROR_LOG_FILE = ARCHIVE_DIR.appendingPathComponent("digest-error.log")

// MARK: - Args

struct Args {
    var tickers: [String] = []      // empty = all
    var check = false
    var dryRun = false
    var verbose = false
    var fetchOnly = false
    var digestsOnly = false
    var outputPath = DEFAULT_OUTPUT
}

func parseArgs() -> Args {
    var a = Args()
    var i = 1
    let argv = CommandLine.arguments
    while i < argv.count {
        let arg = argv[i]
        switch arg {
        case "--check":         a.check = true
        case "--dry-run":       a.dryRun = true
        case "--verbose", "-v": a.verbose = true
        case "--fetch-only":    a.fetchOnly = true
        case "--digests-only":  a.digestsOnly = true
        case "--output":
            i += 1
            if i < argv.count { a.outputPath = URL(fileURLWithPath: argv[i]) }
        default:
            if arg.hasPrefix("-") {
                fputs("unknown flag: \(arg)\n", stderr)
                exit(2)
            }
            a.tickers.append(arg.uppercased())
        }
        i += 1
    }
    return a
}

// MARK: - Logging

let isoFormatter: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f
}()

func ensureArchiveDir() {
    try? FileManager.default.createDirectory(at: ARCHIVE_DIR, withIntermediateDirectories: true)
    try? FileManager.default.createDirectory(at: ARTICLES_DIR, withIntermediateDirectories: true)
}

var verboseEnabled = false

// Serial queue for log/logErr so concurrent task-group workers don't
// interleave bytes in digest.log / digest-error.log.
let logQueue = DispatchQueue(label: "stockgame.digest.log")

func log(_ msg: String) {
    let ts = isoFormatter.string(from: Date())
    let line = "[\(ts)] \(msg)\n"
    logQueue.sync {
        print(msg)
        ensureArchiveDir()
        if !FileManager.default.fileExists(atPath: LOG_FILE.path) {
            FileManager.default.createFile(atPath: LOG_FILE.path, contents: nil)
        }
        if let data = line.data(using: .utf8),
           let handle = try? FileHandle(forWritingTo: LOG_FILE) {
            handle.seekToEndOfFile()
            handle.write(data)
            try? handle.close()
        }
    }
}

func logErr(_ msg: String) {
    let ts = isoFormatter.string(from: Date())
    let line = "[\(ts)] \(msg)\n"
    logQueue.sync {
        fputs(line, stderr)
        ensureArchiveDir()
        if !FileManager.default.fileExists(atPath: ERROR_LOG_FILE.path) {
            FileManager.default.createFile(atPath: ERROR_LOG_FILE.path, contents: nil)
        }
        if let data = line.data(using: .utf8),
           let handle = try? FileHandle(forWritingTo: ERROR_LOG_FILE) {
            handle.seekToEndOfFile()
            handle.write(data)
            try? handle.close()
        }
    }
}

func vlog(_ msg: String) {
    if verboseEnabled { log(msg) }
}

// MARK: - Date helpers

let dayFormatter: DateFormatter = {
    let f = DateFormatter()
    f.dateFormat = "yyyy-MM-dd"
    f.timeZone = TimeZone(identifier: "America/New_York")
    return f
}()

let dayUTC: DateFormatter = {
    let f = DateFormatter()
    f.dateFormat = "yyyy-MM-dd"
    f.timeZone = TimeZone(secondsFromGMT: 0)
    return f
}()

func todayET() -> String { dayFormatter.string(from: Date()) }

func daysAgo(_ n: Int) -> Date {
    Calendar.current.date(byAdding: .day, value: -n, to: Date())!
}

func parseDay(_ s: String) -> Date? {
    dayUTC.date(from: s) ?? dayFormatter.date(from: s)
}

// MARK: - Data models

struct Article: Codable {
    var title: String
    var description: String
    var link: String
    var source: String
    var pubDate: String?
    var fetchedAt: String
    var relevanceScore: Int?
    var relevanceReason: String?
    var passedKeywordFilter: Bool
    var passedAIFilter: Bool?
    var aiEngine: String?
}

struct DateRange: Codable {
    var from: String
    var to: String
}

struct SourceArticle: Codable {
    var title: String
    var link: String
    var source: String
    var date: String
    var score: Int
}

struct WindowDigest: Codable {
    var digest: String?
    var articleCount: Int
    var dateRange: DateRange?
    var avgRelevanceScore: Double?
    var generatedAt: String
    var aiEngine: String?
    var dataMaturity: String        // "full" | "partial" | "insufficient"
    var daysOfData: Int
    var daysRequired: Int
    var sources: [SourceArticle]?
}

struct OutputJSON: Codable {
    var generatedAt: String
    var aiEngine: String
    var holdings: [String: [String: WindowDigest]]
    // Per-user portfolio rollups (Phase 2). Key is the user id ("brian"/"kevin"/...).
    // Same WindowDigest shape as `holdings`; sources draw from across the user's
    // ticker list, not a single ticker.
    var portfolios: [String: [String: WindowDigest]]?
    // Game-wide leaderboard analysis (Phase 3). Per-window digests that
    // explain *why* the standings look the way they do, citing player names,
    // specific tickers, and percentages from the live price data.
    var game: [String: WindowDigest]?
}

// Game inception. Every multi-day window's lookback is capped at the elapsed
// game age — there is no news before the start of the game, so 1Y on day 95
// is identical to ALL until day 365 has passed. After Feb 5, 2027, 1Y starts
// becoming a true rolling-365-day window. Same logic for 1M / 3M.
let GAME_START_DATE = "2026-02-05"

func gameAgeInDays(asOf: Date = Date()) -> Int {
    let cal = Calendar.current
    let f = DateFormatter()
    f.dateFormat = "yyyy-MM-dd"
    f.timeZone = TimeZone(identifier: "America/New_York")
    guard let start = f.date(from: GAME_START_DATE) else { return 1 }
    let days = cal.dateComponents([.day], from: start, to: asOf).day ?? 0
    return max(1, days + 1)        // inclusive of day 1
}

enum WindowKey: String, CaseIterable {
    case d1 = "1D"
    case w1 = "1W"
    case m1 = "1M"
    case m3 = "3M"
    case y1 = "1Y"
    case all = "ALL"

    // Static window length (days). The *effective* lookback / requirement is
    // capped at gameAge for the multi-day windows — see effectiveDaysRequired.
    private var staticDays: Int {
        switch self {
        case .d1: return 1
        case .w1: return 7
        case .m1: return 30
        case .m3: return 90
        case .y1: return 365
        case .all: return 365 * 5    // hard ceiling — caller caps to gameAge
        }
    }

    // Days the window is allowed to look back, capped at game age.
    func effectiveLookback(gameAge: Int) -> Int {
        switch self {
        case .d1, .w1: return staticDays
        case .m1, .m3, .y1, .all: return min(staticDays, gameAge)
        }
    }

    // Effective daysRequired controls when the panel says "insufficient" vs
    // "full". For multi-day windows we only need ONE archive day to start
    // showing a digest — there's no earlier history to wait for, so the
    // window just summarizes whatever fraction of itself has elapsed
    // (1Y on day 5 = "5 days since Feb 5"; 3M on day 95 = full sliding 90).
    // 1W is the exception: until we have ~7 distinct archive days, a "1W"
    // digest would be misleading because it would just be today's news,
    // so we keep the 7-day requirement there.
    func effectiveDaysRequired(gameAge: Int) -> Int {
        switch self {
        case .d1: return 1
        case .w1: return min(7, gameAge)
        case .m1, .m3, .y1, .all: return 1
        }
    }

    // What we *display* in the JSON as the threshold — useful only for the
    // 1W "X more days needed" countdown. Returns the same value as
    // effectiveDaysRequired today; kept separate in case we want different
    // semantics later (e.g., "this digest reflects N days of the M-day window").
    func displayDaysRequired(gameAge: Int) -> Int {
        effectiveDaysRequired(gameAge: gameAge)
    }
}

// MARK: - Yahoo RSS fetch + parse

func fetchRSS(ticker: String) async throws -> Data {
    var components = URLComponents(string: "https://feeds.finance.yahoo.com/rss/2.0/headline")!
    components.queryItems = [
        URLQueryItem(name: "s", value: ticker),
        URLQueryItem(name: "region", value: "US"),
        URLQueryItem(name: "lang", value: "en-US"),
    ]
    var req = URLRequest(url: components.url!)
    req.setValue("Mozilla/5.0 (Macintosh; Apple Silicon) StockGameDigest/1.0", forHTTPHeaderField: "User-Agent")
    req.timeoutInterval = 30
    let (data, response) = try await URLSession.shared.data(for: req)
    if let http = response as? HTTPURLResponse, http.statusCode != 200 {
        throw NSError(domain: "RSS", code: http.statusCode,
                      userInfo: [NSLocalizedDescriptionKey: "HTTP \(http.statusCode) for \(ticker)"])
    }
    return data
}

final class RSSParserDelegate: NSObject, XMLParserDelegate {
    var items: [Article] = []
    private var inItem = false
    private var currentField = ""
    private var titleBuf = ""
    private var descBuf = ""
    private var linkBuf = ""
    private var pubDateBuf = ""
    private let now = isoFormatter.string(from: Date())

    func parser(_ parser: XMLParser, didStartElement elementName: String,
                namespaceURI: String?, qualifiedName qName: String?,
                attributes attributeDict: [String: String] = [:]) {
        if elementName == "item" {
            inItem = true
            titleBuf = ""; descBuf = ""; linkBuf = ""; pubDateBuf = ""
        }
        currentField = elementName
    }

    func parser(_ parser: XMLParser, foundCharacters string: String) {
        guard inItem else { return }
        switch currentField {
        case "title":       titleBuf += string
        case "description": descBuf += string
        case "link":        linkBuf += string
        case "pubDate":     pubDateBuf += string
        default: break
        }
    }

    func parser(_ parser: XMLParser, foundCDATA CDATABlock: Data) {
        guard inItem, let s = String(data: CDATABlock, encoding: .utf8) else { return }
        switch currentField {
        case "title":       titleBuf += s
        case "description": descBuf += s
        default: break
        }
    }

    func parser(_ parser: XMLParser, didEndElement elementName: String,
                namespaceURI: String?, qualifiedName qName: String?) {
        if elementName == "item" {
            let cleanedDesc = stripHTML(descBuf).trimmingCharacters(in: .whitespacesAndNewlines)
            let cleanedTitle = titleBuf.trimmingCharacters(in: .whitespacesAndNewlines)
            let cleanedLink = linkBuf.trimmingCharacters(in: .whitespacesAndNewlines)
            if !cleanedTitle.isEmpty && !cleanedLink.isEmpty {
                items.append(Article(
                    title: cleanedTitle,
                    description: cleanedDesc,
                    link: cleanedLink,
                    source: extractSource(from: cleanedLink, fallback: "Yahoo Finance"),
                    pubDate: pubDateBuf.isEmpty ? nil : pubDateBuf,
                    fetchedAt: now,
                    relevanceScore: nil,
                    relevanceReason: nil,
                    passedKeywordFilter: false,
                    passedAIFilter: nil,
                    aiEngine: nil
                ))
            }
            inItem = false
        }
        currentField = ""
    }
}

func stripHTML(_ s: String) -> String {
    s.replacingOccurrences(of: "<[^>]+>", with: " ", options: .regularExpression)
     .replacingOccurrences(of: "&nbsp;", with: " ")
     .replacingOccurrences(of: "&amp;", with: "&")
     .replacingOccurrences(of: "&quot;", with: "\"")
     .replacingOccurrences(of: "&#39;", with: "'")
     .replacingOccurrences(of: "  ", with: " ")
}

func extractSource(from link: String, fallback: String) -> String {
    if let host = URL(string: link)?.host {
        // "finance.yahoo.com" → "Yahoo Finance", "www.reuters.com" → "Reuters"
        let h = host.replacingOccurrences(of: "www.", with: "")
        if h.contains("yahoo.com") { return "Yahoo Finance" }
        if h.contains("reuters") { return "Reuters" }
        if h.contains("bloomberg") { return "Bloomberg" }
        if h.contains("cnbc") { return "CNBC" }
        if h.contains("marketwatch") { return "MarketWatch" }
        if h.contains("investorplace") { return "InvestorPlace" }
        if h.contains("seekingalpha") { return "Seeking Alpha" }
        if h.contains("benzinga") { return "Benzinga" }
        if h.contains("fool.com") { return "Motley Fool" }
        if h.contains("barrons") { return "Barron's" }
        if h.contains("wsj") { return "Wall Street Journal" }
        if h.contains("ft.com") { return "Financial Times" }
        return h
    }
    return fallback
}

func parseRSS(_ data: Data) -> [Article] {
    let parser = XMLParser(data: data)
    let delegate = RSSParserDelegate()
    parser.delegate = delegate
    parser.parse()
    return delegate.items
}

// MARK: - Stage 1 keyword filter

func keywordFilter(_ a: Article, ticker: String) -> (passed: Bool, alwaysAccept: Bool) {
    let title = a.title.lowercased()
    let desc = a.description.lowercased()
    let combined = title + " " + desc

    // Hard accept always wins
    for kw in ACCEPT_KEYWORDS where combined.contains(kw) {
        return (true, true)
    }
    // Hard reject (with sports exemption for sports companies)
    for kw in REJECT_KEYWORDS {
        if kw == "sports" || kw == "nfl" || kw == "nba" || kw == "mlb" || kw == "nhl" {
            if SPORTS_COMPANIES.contains(ticker) { continue }
        }
        if combined.contains(kw) {
            return (false, false)
        }
    }
    // Neither — passes to Stage 2
    return (true, false)
}

// MARK: - Stage 2 AI relevance scoring

struct AIScore { let score: Int; let reason: String }

func scoreArticleAI(_ article: Article, ticker: String) async -> AIScore? {
    let title = article.title
    let desc = String(article.description.prefix(DESC_TRUNCATE))
    let prompt = """
    You are a financial news filter for an investor tracking \(ticker) stock.

    Score this article's investor relevance from 1 to 10.
    8-10: Earnings, revenue, M&A, regulatory decisions, executive leadership changes, analyst ratings, product launches with revenue impact, material legal matters affecting the company.
    5-7: Industry trends, competitive developments, macro factors directly affecting this company.
    1-4: Individual employee misconduct, local store openings, charity, sponsorship, lifestyle content, tangentially related stories.

    Reply with JSON only, no other text:
    {"score": <integer 1-10>, "reason": "<one sentence explaining why>"}

    Article title: \(title)
    Article description: \(desc)
    """
    do {
        let session = LanguageModelSession()    // fresh session per article
        let response = try await session.respond(to: prompt)
        return parseScoreJSON(response.content)
    } catch {
        logErr("scoreArticleAI threw for \(ticker): \(error.localizedDescription)")
        return nil
    }
}

func parseScoreJSON(_ raw: String) -> AIScore? {
    let s = raw
        .replacingOccurrences(of: "```json", with: "")
        .replacingOccurrences(of: "```", with: "")
        .trimmingCharacters(in: .whitespacesAndNewlines)
    guard let openIdx = s.firstIndex(of: "{"),
          let closeIdx = s.lastIndex(of: "}"),
          openIdx <= closeIdx else { return nil }
    let json = String(s[openIdx...closeIdx])
    guard let data = json.data(using: .utf8) else { return nil }
    if let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
        let score = (obj["score"] as? Int) ?? Int((obj["score"] as? Double) ?? 0)
        let reason = (obj["reason"] as? String) ?? ""
        if score >= 1 && score <= 10 { return AIScore(score: score, reason: reason) }
    }
    return nil
}

// MARK: - Article archive I/O

func archiveDirFor(_ ticker: String) -> URL {
    ARTICLES_DIR.appendingPathComponent(ticker)
}

func archiveFileFor(_ ticker: String, day: String) -> URL {
    archiveDirFor(ticker).appendingPathComponent("\(day).json")
}

func loadArchivedDay(_ ticker: String, day: String) -> [Article] {
    let url = archiveFileFor(ticker, day: day)
    guard let data = try? Data(contentsOf: url) else { return [] }
    return (try? JSONDecoder().decode([Article].self, from: data)) ?? []
}

func writeArchivedDay(_ ticker: String, day: String, articles: [Article]) throws {
    let dir = archiveDirFor(ticker)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    let data = try encoder.encode(articles)
    try data.write(to: archiveFileFor(ticker, day: day))
}

// Returns dedup key set for a ticker across all archived days.
func loadAllArchivedLinks(_ ticker: String) -> Set<String> {
    let dir = archiveDirFor(ticker)
    guard let entries = try? FileManager.default.contentsOfDirectory(atPath: dir.path) else { return [] }
    var seen: Set<String> = []
    for entry in entries where entry.hasSuffix(".json") {
        let url = dir.appendingPathComponent(entry)
        if let data = try? Data(contentsOf: url),
           let arr = try? JSONDecoder().decode([Article].self, from: data) {
            for a in arr { seen.insert(a.link) }
        }
    }
    return seen
}

// MARK: - Time-window aggregation

func loadArticlesInLastNDays(ticker: String, days: Int) -> [Article] {
    let dir = archiveDirFor(ticker)
    guard let entries = try? FileManager.default.contentsOfDirectory(atPath: dir.path) else { return [] }
    let cutoff = daysAgo(days)
    var out: [Article] = []
    var seenLinks: Set<String> = []
    for entry in entries.sorted() where entry.hasSuffix(".json") {
        let dayStr = String(entry.dropLast(5))
        guard let date = parseDay(dayStr), date >= cutoff else { continue }
        let articles = loadArchivedDay(ticker, day: dayStr)
        for a in articles {
            if seenLinks.contains(a.link) { continue }
            seenLinks.insert(a.link)
            out.append(a)
        }
    }
    return out
}

func articlesForWindow(ticker: String, window: WindowKey, gameAge: Int) -> [Article] {
    let articles = loadArticlesInLastNDays(ticker: ticker, days: window.effectiveLookback(gameAge: gameAge))
    switch window {
    case .d1, .w1:
        return articles                                   // all qualifying, dedup'd
    case .m1:
        return Array(articles.sorted { ($0.relevanceScore ?? 0) > ($1.relevanceScore ?? 0) }.prefix(20))
    case .m3:
        return Array(articles.sorted { ($0.relevanceScore ?? 0) > ($1.relevanceScore ?? 0) }.prefix(30))
    case .y1:
        return Array(articles.sorted { ($0.relevanceScore ?? 0) > ($1.relevanceScore ?? 0) }.prefix(24))
    case .all:
        return Array(articles.sorted { ($0.relevanceScore ?? 0) > ($1.relevanceScore ?? 0) }.prefix(30))
    }
}

func daysOfDataAvailable(_ ticker: String) -> Int {
    let dir = archiveDirFor(ticker)
    guard let entries = try? FileManager.default.contentsOfDirectory(atPath: dir.path) else { return 0 }
    let dayStrs = entries.filter { $0.hasSuffix(".json") }.map { String($0.dropLast(5)) }
    let dates = dayStrs.compactMap { parseDay($0) }.sorted()
    guard let first = dates.first, let last = dates.last else { return 0 }
    let days = Calendar.current.dateComponents([.day], from: first, to: last).day ?? 0
    return days + 1
}

func dataMaturity(daysOfData: Int, daysRequired: Int) -> String {
    if daysOfData == 0 { return "insufficient" }
    if daysOfData >= daysRequired { return "full" }
    if daysOfData >= max(1, daysRequired / 4) { return "partial" }
    return "insufficient"
}

// MARK: - Digest generation

func buildDigestPrompt(ticker: String, window: WindowKey, articles: [Article], gameAge: Int) -> String {
    let name = TICKER_NAMES[ticker] ?? ticker
    var articleText = ""
    for (i, a) in articles.enumerated() {
        let desc = String(a.description.prefix(DESC_TRUNCATE))
        articleText += "\(i + 1). \(a.title)\n\(desc)\n\n"
    }
    switch window {
    case .d1:
        return """
        You are a financial analyst writing a daily briefing for an investor holding \(ticker) (\(name)).
        These articles have been pre-filtered for investor relevance: earnings, products, regulatory news, analyst moves, executive changes only.
        Write exactly 3 sentences: (1) what happened today, (2) why it matters to the stock price or investment thesis, (3) the immediate risk or opportunity.
        No store openings, employee stories, charity, or anything unrelated to financial or competitive position.
        Write only the 3-sentence digest as a single paragraph of plain prose. Do not preface it. Do not number the sentences. Do not use bullet points.

        Articles:
        \(articleText)
        """
    case .w1:
        return """
        You are a financial analyst writing a weekly briefing for an investor holding \(ticker) (\(name)).
        These articles represent the most significant market-relevant developments from the past 7 days.
        Write exactly 3 sentences: (1) the dominant narrative or theme this week, (2) key catalysts or sentiment shifts, (3) momentum heading into next week and what to watch.
        Write only the 3-sentence digest as a single paragraph of plain prose. Do not preface it. Do not number the sentences. Do not use bullet points.

        Articles:
        \(articleText)
        """
    case .m1:
        let scope = gameAge < 30
            ? "since the game's start on February 5, 2026 (\(gameAge) days ago — not yet a full month)"
            : "over the past 30 days"
        return """
        You are a financial analyst writing a monthly-style briefing for an investor holding \(ticker) (\(name)) \(scope).
        These are the highest-signal developments in this period, ranked by investor relevance.
        Write exactly 3 sentences: (1) the period's defining theme, (2) the biggest catalyst or risk that emerged, (3) where the stock stands heading forward.
        Be specific — cite actual events, not vague generalities. Write only the 3-sentence digest as a single paragraph of plain prose. Do not preface it. Do not number the sentences. Do not use bullet points.

        Articles:
        \(articleText)
        """
    case .m3:
        let scope = gameAge < 90
            ? "since the game's start on February 5, 2026 (\(gameAge) days ago — not yet a full quarter)"
            : "over the past 90 days"
        return """
        You are a financial analyst writing a quarterly-style briefing for an investor holding \(ticker) (\(name)) \(scope).
        These are the highest-signal developments in this period, ranked by investor relevance.
        Write exactly 3 sentences: (1) the period's defining theme or catalyst, (2) major risks or opportunities that emerged, (3) how the investment thesis has evolved.
        Be specific — cite actual events, not vague generalities. Write only the 3-sentence digest as a single paragraph of plain prose. Do not preface it. Do not number the sentences. Do not use bullet points.

        Articles:
        \(articleText)
        """
    case .y1:
        // Until the game is at least a year old, "1Y" effectively means
        // "since February 5, 2026" — there is no earlier history to draw on.
        let isYoung = gameAge < 365
        let scopeFraming = isYoung
            ? "since the game's start on February 5, 2026 (the game has been running for \(gameAge) days, so this covers the entire holding period to date)"
            : "over the past 12 months"
        return """
        You are a financial analyst writing an annual-style briefing for an investor holding \(ticker) (\(name)) \(scopeFraming).
        These are the most material business developments in this period, filtered for relevance.
        Write exactly 3 sentences: (1) the period's most important storyline and its market impact, (2) how the company's competitive position or financial trajectory changed, (3) the long-term outlook based on this arc of events.
        Be concrete and specific. No filler. Write only the 3-sentence digest as a single paragraph of plain prose. Do not preface it. Do not number the sentences. Do not use bullet points.

        Articles:
        \(articleText)
        """
    case .all:
        return """
        You are a financial analyst writing a since-inception summary for an investor holding \(ticker) (\(name)) since February 5, 2026 — the start of the tracking period (\(gameAge) days ago).
        These are the most material business developments across the entire holding period, filtered for investor relevance and ranked by signal.
        Write exactly 3 sentences: (1) the defining arc of the company since February 5, 2026 — biggest catalysts, pivots, or regime changes, (2) how the original investment thesis has evolved or been challenged, (3) the structural outlook from here based on what these events imply about competitive position and execution.
        Be concrete and specific. Reference actual events, not generic commentary. Do not refer to "5 years" — the timeframe is whatever has elapsed since February 5, 2026. Write only the 3-sentence digest as a single paragraph of plain prose. Do not preface it. Do not number the sentences. Do not use bullet points.

        Articles:
        \(articleText)
        """
    }
}

func generateDigestText(ticker: String, window: WindowKey, articles: [Article], gameAge: Int) async -> String? {
    guard !articles.isEmpty else { return nil }
    let prompt = buildDigestPrompt(ticker: ticker, window: window, articles: articles, gameAge: gameAge)
    do {
        let session = LanguageModelSession()    // fresh session per (ticker, window)
        let response = try await session.respond(to: prompt)
        let text = cleanDigestProse(response.content)
        return text.isEmpty ? nil : text
    } catch {
        logErr("generateDigestText error \(ticker) \(window.rawValue): \(error.localizedDescription)")
        return nil
    }
}

func cleanDigestProse(_ raw: String) -> String {
    var s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    // Strip common prefacing the model occasionally adds despite instructions.
    let prefixes = [
        "Here is the digest:",
        "Here's the digest:",
        "Daily briefing:",
        "Weekly briefing:",
        "Monthly briefing:",
        "Quarterly briefing:",
        "Annual briefing:",
        "Digest:",
    ]
    for p in prefixes where s.hasPrefix(p) {
        s = String(s.dropFirst(p.count)).trimmingCharacters(in: .whitespacesAndNewlines)
    }
    // Strip numbered-list markers ("1.", "(1)") + bullets ("- ", "* ") at line starts,
    // then collapse paragraph breaks to single spaces — the model occasionally formats
    // 3 sentences as a numbered list despite the prompt asking for prose.
    s = s.replacingOccurrences(
        of: #"(?m)^\s*(?:\(?\d+\)?[.)]|[-*•])\s+"#,
        with: "",
        options: .regularExpression
    )
    s = s.replacingOccurrences(of: "\r\n", with: "\n")
    s = s.replacingOccurrences(
        of: #"\n{2,}"#,
        with: " ",
        options: .regularExpression
    )
    s = s.replacingOccurrences(of: "\n", with: " ")
    s = s.replacingOccurrences(
        of: #" {2,}"#,
        with: " ",
        options: .regularExpression
    )
    return s.trimmingCharacters(in: .whitespacesAndNewlines)
}

// MARK: - Per-ticker pipeline

struct TickerOutcome {
    let ticker: String
    let windows: [String: WindowDigest]
    let aiEngineUsed: Bool
}

func processTicker(_ ticker: String, args: Args) async -> TickerOutcome {
    log("• \(ticker): start")
    var perWindow: [String: WindowDigest] = [:]
    let nowISO = isoFormatter.string(from: Date())
    let today = todayET()

    if !args.digestsOnly {
        // 1. Fetch RSS
        let articles: [Article]
        do {
            let data = try await fetchRSS(ticker: ticker)
            articles = parseRSS(data)
        } catch {
            logErr("\(ticker): RSS fetch failed: \(error.localizedDescription)")
            return TickerOutcome(ticker: ticker, windows: [:], aiEngineUsed: false)
        }
        let fetched = articles.count
        vlog("  \(ticker): \(fetched) articles fetched")

        // 2. Stage 1 keyword filter
        var stage1: [Article] = []
        var keywordRejected = 0
        for var a in articles {
            let kw = keywordFilter(a, ticker: ticker)
            a.passedKeywordFilter = kw.passed
            if kw.passed {
                a.passedAIFilter = kw.alwaysAccept ? true : nil
                if kw.alwaysAccept {
                    a.relevanceScore = 8         // bypass AI when title is a hard-accept
                    a.relevanceReason = "Hard-accept keyword in title/description"
                    a.aiEngine = nil
                }
                stage1.append(a)
            } else {
                keywordRejected += 1
                if verboseEnabled {
                    vlog("  \(ticker) ✗ keyword: \(a.title.prefix(80))")
                }
            }
        }

        // 3. Stage 2 AI relevance scoring (only for ones that haven't been hard-accepted)
        var stage2: [Article] = []
        var aiRejected: [Int] = []
        var aiErrors = 0
        for var a in stage1 {
            if a.relevanceScore != nil {
                stage2.append(a)
                continue
            }
            if let s = await scoreArticleAI(a, ticker: ticker) {
                a.relevanceScore = s.score
                a.relevanceReason = s.reason
                a.aiEngine = "AppleIntelligence"
                if s.score >= RELEVANCE_THRESHOLD {
                    a.passedAIFilter = true
                    stage2.append(a)
                    if verboseEnabled {
                        vlog("  \(ticker) ✓ \(s.score): \(a.title.prefix(80))")
                    }
                } else {
                    a.passedAIFilter = false
                    aiRejected.append(s.score)
                    if verboseEnabled {
                        vlog("  \(ticker) ✗ AI(\(s.score)): \(a.title.prefix(80))")
                    }
                }
            } else {
                // Fail open — keep the article, mark unscored
                aiErrors += 1
                a.passedAIFilter = nil
                stage2.append(a)
            }
        }

        log("  \(ticker): \(fetched) fetched → \(keywordRejected) keyword-rejected → \(aiRejected.count) AI-rejected (scores: \(aiRejected.map(String.init).joined(separator: ", "))) → \(stage2.count) stored\(aiErrors > 0 ? " [\(aiErrors) AI errors, kept]" : "")")

        // 4. Dedupe against archive (across all days, not just today)
        let archiveLinks = loadAllArchivedLinks(ticker)
        let todayPrior = loadArchivedDay(ticker, day: today)
        let priorTodayLinks = Set(todayPrior.map { $0.link })
        var newToday: [Article] = []
        for a in stage2 {
            // Replace today's same-link entry if it already exists (preserving the most recent fetch),
            // otherwise dedup against older days.
            if priorTodayLinks.contains(a.link) {
                newToday.append(a)
            } else if !archiveLinks.contains(a.link) {
                newToday.append(a)
            }
        }
        // Merge: today's file = old today entries that aren't in newToday + newToday
        let newLinks = Set(newToday.map { $0.link })
        let preserved = todayPrior.filter { !newLinks.contains($0.link) }
        let merged = preserved + newToday

        // 5. Write today's archive
        if !args.dryRun && !merged.isEmpty {
            do {
                try writeArchivedDay(ticker, day: today, articles: merged)
            } catch {
                logErr("\(ticker): archive write failed: \(error.localizedDescription)")
            }
        }
    }

    if args.fetchOnly {
        return TickerOutcome(ticker: ticker, windows: [:], aiEngineUsed: false)
    }

    // 6. Generate digests for every window — concurrently. Apple Intelligence
    // sessions are independent (we always create a fresh LanguageModelSession
    // per call), and on PCC-routed calls the latency stacks rather than
    // overlaps when serial. Firing all six window prompts at once for a
    // ticker roughly cuts per-ticker runtime by a third in practice.
    let daysAvail = daysOfDataAvailable(ticker)
    let gameAge = gameAgeInDays()

    let entries: [(String, WindowDigest)] = await withTaskGroup(
        of: (String, WindowDigest).self
    ) { group -> [(String, WindowDigest)] in
        for w in WindowKey.allCases {
            let articles = articlesForWindow(ticker: ticker, window: w, gameAge: gameAge)
            let effRequired = w.effectiveDaysRequired(gameAge: gameAge)
            let maturity = dataMaturity(daysOfData: daysAvail, daysRequired: effRequired)

            if articles.isEmpty || maturity == "insufficient" {
                let key = w.rawValue
                group.addTask {
                    return (key, WindowDigest(
                        digest: nil,
                        articleCount: 0,
                        dateRange: nil,
                        avgRelevanceScore: nil,
                        generatedAt: nowISO,
                        aiEngine: nil,
                        dataMaturity: maturity,
                        daysOfData: daysAvail,
                        daysRequired: effRequired,
                        sources: nil
                    ))
                }
                continue
            }

            group.addTask {
                let digestText = await generateDigestText(ticker: ticker, window: w, articles: articles, gameAge: gameAge)
                let scores = articles.compactMap { $0.relevanceScore }
                let avg = scores.isEmpty ? nil : (Double(scores.reduce(0, +)) / Double(scores.count))
                let dates = articles.map { dayFormatter.string(from: parseFetchedAtDate($0.fetchedAt) ?? Date()) }.sorted()
                let dateRange: DateRange? = dates.first.map { from in
                    DateRange(from: from, to: dates.last ?? from)
                }
                let sources = articles.prefix(8).map { a in
                    SourceArticle(
                        title: a.title,
                        link: a.link,
                        source: a.source,
                        date: dayFormatter.string(from: parseFetchedAtDate(a.fetchedAt) ?? Date()),
                        score: a.relevanceScore ?? 0
                    )
                }
                log("  \(ticker) \(w.rawValue) → \(digestText != nil ? "✓" : "—") (\(articles.count) articles, maturity=\(maturity))")
                return (w.rawValue, WindowDigest(
                    digest: digestText,
                    articleCount: articles.count,
                    dateRange: dateRange,
                    avgRelevanceScore: avg,
                    generatedAt: nowISO,
                    aiEngine: digestText != nil ? "AppleIntelligence" : nil,
                    dataMaturity: maturity,
                    daysOfData: daysAvail,
                    daysRequired: effRequired,
                    sources: Array(sources)
                ))
            }
        }
        var collected: [(String, WindowDigest)] = []
        for await result in group {
            collected.append(result)
        }
        return collected
    }

    for (k, v) in entries {
        perWindow[k] = v
    }
    let anyAI = entries.contains { $0.1.digest != nil }

    return TickerOutcome(ticker: ticker, windows: perWindow, aiEngineUsed: anyAI)
}

func parseFetchedAtDate(_ s: String) -> Date? {
    isoFormatter.date(from: s) ?? ISO8601DateFormatter().date(from: s)
}

// MARK: - Per-user portfolio aggregation (Phase 2)

struct PortfolioOutcome {
    let userId: String
    let windows: [String: WindowDigest]
}

// An article paired with the archive bucket it came from. We tag explicitly
// (instead of re-detecting via title text) so a Brian-portfolio article pulled
// from the EXOD archive is always tagged EXOD, even if the body also mentions
// AAPL. This is what the LLM prompt sees as the bracket tag.
struct TaggedArticle {
    let article: Article
    let ticker: String
}

// Pull articles for a portfolio digest, restricted to the tickers that
// actually drove the window — top movers + drag positions ranked by $
// contribution. The model previously got ~30 articles ordered by raw
// relevanceScore, which made it grasp onto whichever ticker had the loudest
// press regardless of whether it touched the bottom line. With this filter
// the article pool aligns with the STANDINGS block injected into the prompt.
// Cap per ticker keeps the prompt focused; total is ~12 max.
func portfolioArticlesForWindow(
    player: PlayerRoster,
    window: WindowKey,
    gameAge: Int,
    relevantTickers: [String],
    perTickerCap: Int = 2
) -> [TaggedArticle] {
    let lookback = window.effectiveLookback(gameAge: gameAge)
    var seen: Set<String> = []
    var out: [TaggedArticle] = []
    for ticker in relevantTickers {
        let articles = loadArticlesInLastNDays(ticker: ticker, days: lookback)
            .sorted { ($0.relevanceScore ?? 0) > ($1.relevanceScore ?? 0) }
        var kept = 0
        for a in articles where kept < perTickerCap {
            if seen.insert(a.link).inserted {
                out.append(TaggedArticle(article: a, ticker: ticker))
                kept += 1
            }
        }
    }
    return out
}

func buildPortfolioPrompt(
    player: PlayerRoster,
    window: WindowKey,
    articles: [TaggedArticle],
    movers: UserMovers,
    gameAge: Int
) -> String {
    let standingsBlock = formatUserStandingsBlock(movers, window: window)
    var articleText = ""
    for (i, ta) in articles.enumerated() {
        let desc = String(ta.article.description.prefix(DESC_TRUNCATE))
        articleText += "\(i + 1). [\(ta.ticker)\(ownerSuffix(forTicker: ta.ticker))] \(ta.article.title)\n\(desc)\n\n"
    }
    let scope: String
    switch window {
    case .d1: scope = "today"
    case .w1: scope = "this past week"
    case .m1: scope = gameAge < 30  ? "since the game's start on February 5, 2026 (\(gameAge) days ago)" : "the past 30 days"
    case .m3: scope = gameAge < 90  ? "since the game's start on February 5, 2026 (\(gameAge) days ago)" : "the past 90 days"
    case .y1: scope = gameAge < 365 ? "since the game's start on February 5, 2026 (\(gameAge) days ago)" : "the past 12 months"
    case .all: scope = "since the game's start on February 5, 2026 (\(gameAge) days ago)"
    }
    return """
    You are a financial analyst writing a portfolio briefing for \(player.name), a player in a stock-picking game. \(player.name)'s portfolio holds: \(player.tickers.joined(separator: ", ")).

    STANDINGS — \(player.name)'s holdings this \(window.rawValue), ranked by $ contribution to portfolio (most positive at top, drags at bottom):
    \(standingsBlock)

    Articles from the period (each tagged with [TICKER/owner]):
    \(articleText)

    Your reader can already see the STANDINGS table on the page. Your job is to explain WHAT HAPPENED IN THE NEWS that produced those numbers — not to restate the numbers. The standings are the consequence; the news is the story. Lead every sentence with a concrete catalyst from the article archive — an earnings beat or miss, an FDA decision, an M&A announcement, an analyst upgrade or downgrade with a specific reason, a guidance change, a product launch, an executive change, a regulatory action. Subordinate the dollar amounts to the news event, not the other way around.

    Write exactly 3 sentences as a single paragraph of plain prose:
    Sentence 1: Lead with the single most consequential news event behind \(player.name)'s top contributor (the #1 ticker in STANDINGS) — what happened, who reported it, what it implies. Then tie it to the $ impact on \(player.name)'s portfolio.
    Sentence 2: Lead with the specific news event behind the biggest drag (from the Drag section of STANDINGS, or the smallest gainer if no drags exist) — what happened, what it implies. Then tie it to the $ impact.
    Sentence 3: A specific forward-looking catalyst pulled from the article archive — an upcoming earnings date, regulatory milestone, product launch, or named risk for one of \(player.name)'s holdings. Be concrete: name the ticker and the catalyst, not "watch the market."

    Hard rules: Refer only to tickers from \(player.name)'s portfolio. Quote dollar amounts and percentages from STANDINGS exactly — do not invent numbers. Do NOT use the structure "X drove the portfolio with $Y, Z was the drag with $W" — that's just restating the table. Open with the news event, every sentence. Do not preface the digest. Do not number the sentences. Do not use bullet points.
    """
}

// Best-effort ticker tag for an article — checks the title/description for
// any of the user's ticker symbols. Used purely for the LLM prompt so the
// model knows which holding each article maps to.
func detectTickerForArticle(_ a: Article, in tickers: [String]) -> String? {
    let hay = (a.title + " " + a.description).uppercased()
    for t in tickers {
        // Match ticker as a whole word ("HON", "(HON)", "HON:") not as a substring of a larger word.
        let pattern = "\\b\(NSRegularExpression.escapedPattern(for: t))\\b"
        if hay.range(of: pattern, options: .regularExpression) != nil {
            return t
        }
        if let name = TICKER_NAMES[t]?.uppercased(), hay.contains(name) {
            return t
        }
    }
    return nil
}

func generatePortfolioDigestText(
    player: PlayerRoster,
    window: WindowKey,
    articles: [TaggedArticle],
    movers: UserMovers,
    gameAge: Int
) async -> String? {
    let prompt = buildPortfolioPrompt(player: player, window: window, articles: articles, movers: movers, gameAge: gameAge)
    do {
        let session = LanguageModelSession()        // fresh session per (user, window)
        let response = try await session.respond(to: prompt)
        let text = cleanDigestProse(response.content)
        return text.isEmpty ? nil : text
    } catch {
        logErr("generatePortfolioDigestText error \(player.id) \(window.rawValue): \(error.localizedDescription)")
        return nil
    }
}

// Pick the tickers the LLM is allowed to anchor on — top 3 contributors by
// $ + up to 3 negative-$ drags, deduped, in the order they should appear in
// the prompt. The article archive is filtered to articles tagged with these
// tickers (see portfolioArticlesForWindow).
func relevantTickersForPortfolio(_ movers: UserMovers) -> [String] {
    let byDollars = movers.movers.sorted { $0.dollars > $1.dollars }
    var picked: [String] = []
    for m in byDollars.prefix(3) {
        picked.append(m.ticker)
    }
    let drags = byDollars.filter { $0.dollars < 0 }.reversed().prefix(3)
    for d in drags where !picked.contains(d.ticker) {
        picked.append(d.ticker)
    }
    return picked
}

func processPortfolio(_ player: PlayerRoster, data: PriceDataLite, gameAge: Int) async -> PortfolioOutcome {
    log("• \(player.name)'s portfolio: start (\(player.tickers.count) tickers)")
    var perWindow: [String: WindowDigest] = [:]
    let nowISO = isoFormatter.string(from: Date())

    // The "days of data" for a portfolio is the max across its tickers — if
    // any single ticker has been archived for N days, the portfolio rollup
    // can speak to the same span.
    let daysAvail = player.tickers.map { daysOfDataAvailable($0) }.max() ?? 0

    let entries: [(String, WindowDigest)] = await withTaskGroup(
        of: (String, WindowDigest).self
    ) { group -> [(String, WindowDigest)] in
        for w in WindowKey.allCases {
            let movers = computeUserMovers(player: player, data: data, window: w)
            let relevant = relevantTickersForPortfolio(movers)
            let tagged = portfolioArticlesForWindow(
                player: player,
                window: w,
                gameAge: gameAge,
                relevantTickers: relevant
            )
            let effRequired = w.effectiveDaysRequired(gameAge: gameAge)
            let maturity = dataMaturity(daysOfData: daysAvail, daysRequired: effRequired)

            // Skip when there's nothing to narrate. We require all three:
            //   - the portfolio actually moved in this window,
            //   - enough archive depth (the "insufficient" gate),
            //   - at least one relevant article — without one the model has
            //     to invent a catalyst, which is precisely the hallucination
            //     class we're trying to suppress.
            let hasMovement = movers.movers.contains { abs($0.dollars) > 0.01 }
            if !hasMovement || maturity == "insufficient" || tagged.isEmpty {
                let key = w.rawValue
                group.addTask {
                    return (key, WindowDigest(
                        digest: nil,
                        articleCount: 0,
                        dateRange: nil,
                        avgRelevanceScore: nil,
                        generatedAt: nowISO,
                        aiEngine: nil,
                        dataMaturity: maturity,
                        daysOfData: daysAvail,
                        daysRequired: effRequired,
                        sources: nil
                    ))
                }
                continue
            }

            group.addTask {
                let digestText = await generatePortfolioDigestText(
                    player: player, window: w, articles: tagged, movers: movers, gameAge: gameAge
                )
                let articleObjs = tagged.map { $0.article }
                let scores = articleObjs.compactMap { $0.relevanceScore }
                let avg = scores.isEmpty ? nil : (Double(scores.reduce(0, +)) / Double(scores.count))
                let dates = articleObjs.map { dayFormatter.string(from: parseFetchedAtDate($0.fetchedAt) ?? Date()) }.sorted()
                let dateRange: DateRange? = dates.first.map { DateRange(from: $0, to: dates.last ?? $0) }
                let sources = articleObjs.prefix(8).map { a in
                    SourceArticle(
                        title: a.title,
                        link: a.link,
                        source: a.source,
                        date: dayFormatter.string(from: parseFetchedAtDate(a.fetchedAt) ?? Date()),
                        score: a.relevanceScore ?? 0
                    )
                }
                log("  \(player.name) \(w.rawValue) → \(digestText != nil ? "✓" : "—") (\(articleObjs.count) articles, maturity=\(maturity), tickers=[\(relevant.joined(separator: ","))])")
                return (w.rawValue, WindowDigest(
                    digest: digestText,
                    articleCount: articleObjs.count,
                    dateRange: dateRange,
                    avgRelevanceScore: avg,
                    generatedAt: nowISO,
                    aiEngine: digestText != nil ? "AppleIntelligence" : nil,
                    dataMaturity: maturity,
                    daysOfData: daysAvail,
                    daysRequired: effRequired,
                    sources: Array(sources)
                ))
            }
        }
        var collected: [(String, WindowDigest)] = []
        for await result in group {
            collected.append(result)
        }
        return collected
    }

    for (k, v) in entries {
        perWindow[k] = v
    }

    return PortfolioOutcome(userId: player.id, windows: perWindow)
}

// MARK: - Game-wide leaderboard analysis (Phase 3)

// Mirror of the relevant slice of public/data/prices.json. We only decode the
// fields needed for standings — everything else is ignored.
struct PD_DailyClose: Codable { let date: String; let close: Double }
struct PD_IntradayBar: Codable { let t: String; let close: Double }
struct PD_TickerSeries: Codable {
    let ticker: String
    let name: String
    let startClose: Double
    let closes: [PD_DailyClose]
    let intraday: [PD_IntradayBar]?
}
struct PriceDataLite: Codable {
    let startDate: String
    let generatedAt: String
    let intradayDate: String?
    let tickers: [String: PD_TickerSeries]
    let tradingDates: [String]
}

func loadPriceData(at url: URL) -> PriceDataLite? {
    guard let data = try? Data(contentsOf: url) else { return nil }
    return try? JSONDecoder().decode(PriceDataLite.self, from: data)
}

// Mirrors lib/picks.ts STARTING_PORTFOLIO_DOLLARS.
let STARTING_PORTFOLIO_DOLLARS: Double = 100_000

func perHoldingDollarsFor(_ player: PlayerRoster) -> Double {
    return STARTING_PORTFOLIO_DOLLARS / Double(player.tickers.count)
}

func sharesFor(_ player: PlayerRoster, _ series: PD_TickerSeries) -> Double {
    perHoldingDollarsFor(player) / series.startClose
}

func lastKnownClose(_ series: PD_TickerSeries, asOf date: String) -> Double {
    var found = series.startClose
    for c in series.closes {
        if c.date <= date { found = c.close } else { break }
    }
    return found
}

// Port of rangeBounds from lib/portfolio.ts.
func rangeBounds(tradingDates: [String], window: WindowKey) -> (startDate: String, endDate: String) {
    guard let endDate = tradingDates.last else { return ("", "") }
    if window == .all { return (tradingDates.first ?? endDate, endDate) }
    if window == .d1 {
        let prev = tradingDates.count >= 2 ? tradingDates[tradingDates.count - 2] : endDate
        return (prev, endDate)
    }
    let days: Int
    switch window {
    case .w1: days = 7
    case .m1: days = 30
    case .m3: days = 90
    case .y1: days = 365
    default:  days = 0
    }
    let f = DateFormatter()
    f.dateFormat = "yyyy-MM-dd"
    f.timeZone = TimeZone(secondsFromGMT: 0)
    guard let last = f.date(from: endDate),
          let cutoff = Calendar(identifier: .iso8601).date(byAdding: .day, value: -days, to: last) else {
        return (tradingDates.first ?? endDate, endDate)
    }
    let cutoffStr = f.string(from: cutoff)
    let startIdx = tradingDates.firstIndex(where: { $0 >= cutoffStr }) ?? 0
    return (startIdx == 0 ? tradingDates.first ?? endDate : tradingDates[startIdx], endDate)
}

func rangeCloses(series: PD_TickerSeries, data: PriceDataLite, window: WindowKey) -> (start: Double, end: Double) {
    if window == .d1 {
        let intradayDate = data.intradayDate ?? data.tradingDates.last ?? ""
        let prevDate = data.tradingDates.last(where: { $0 < intradayDate }) ?? data.tradingDates.last ?? ""
        let startClose = lastKnownClose(series, asOf: prevDate)
        let endClose = series.intraday?.last?.close ?? series.closes.last?.close ?? startClose
        return (startClose, endClose)
    }
    let bounds = rangeBounds(tradingDates: data.tradingDates, window: window)
    return (lastKnownClose(series, asOf: bounds.startDate),
            lastKnownClose(series, asOf: bounds.endDate))
}

struct TickerMove {
    let ticker: String
    let pct: Double         // fractional, e.g. 0.052 = +5.2%
    let dollars: Double
    let endClose: Double
}

// All of a player's per-ticker contributions for a window, plus the portfolio
// roll-up %. The per-user portfolio prompt (Phase 2) and the game-wide
// standings prompt (Phase 3) both consume this; the only difference is
// whether the consumer sorts the movers by $ (portfolio prompt — answers
// "what drove the portfolio") or by % (legacy standings format).
struct UserMovers {
    let player: PlayerRoster
    let pct: Double
    let movers: [TickerMove]
}

struct UserStanding {
    let player: PlayerRoster
    let pct: Double
    let topMovers: [TickerMove]      // sorted desc by pct
    let bottomMovers: [TickerMove]   // sorted asc by pct
}

// Per-user mover computation. Called per (player, window) — once by the
// portfolio rollup (sorts by $ to find true drivers) and once by the
// game-wide standings (sorts by %).
func computeUserMovers(player: PlayerRoster, data: PriceDataLite, window: WindowKey) -> UserMovers {
    var movers: [TickerMove] = []
    var startTotal: Double = 0
    var endTotal: Double = 0
    for t in player.tickers {
        guard let s = data.tickers[t] else { continue }
        let shares = sharesFor(player, s)
        let r = rangeCloses(series: s, data: data, window: window)
        let pct = r.start == 0 ? 0 : (r.end - r.start) / r.start
        movers.append(TickerMove(ticker: t, pct: pct, dollars: shares * (r.end - r.start), endClose: r.end))
        startTotal += shares * r.start
        endTotal += shares * r.end
    }
    let portfolioPct = startTotal == 0 ? 0 : (endTotal - startTotal) / startTotal
    return UserMovers(player: player, pct: portfolioPct, movers: movers)
}

func computeStandings(data: PriceDataLite, window: WindowKey) -> [UserStanding] {
    var rows: [UserStanding] = []
    for player in PLAYERS {
        let um = computeUserMovers(player: player, data: data, window: window)
        let sorted = um.movers.sorted { $0.pct > $1.pct }
        rows.append(UserStanding(
            player: player,
            pct: um.pct,
            topMovers: Array(sorted.prefix(2)),
            bottomMovers: Array(sorted.reversed().prefix(2))
        ))
    }
    return rows.sorted { $0.pct > $1.pct }
}

// Formatted STANDINGS block injected at the top of the portfolio prompt.
// Sorts the player's positions by $ contribution (most positive at the top)
// then appends a separate "Drag:" subsection for any negative-$ position
// that wasn't already in the top 3.
func formatUserStandingsBlock(_ um: UserMovers, window: WindowKey) -> String {
    let byDollars = um.movers.sorted { $0.dollars > $1.dollars }
    let topN = Array(byDollars.prefix(3))
    let topTickers = Set(topN.map { $0.ticker })
    let drags = byDollars
        .filter { $0.dollars < 0 && !topTickers.contains($0.ticker) }
        .reversed()        // most-negative first
        .prefix(3)

    func line(_ m: TickerMove) -> String {
        let dollarSign = m.dollars >= 0 ? "+" : "-"
        let dollarMag = String(format: "%.0f", abs(m.dollars))
        let pctStr = String(format: "%+.2f%%", m.pct * 100)
        let endStr = String(format: "%.2f", m.endClose)
        return "\(m.ticker): \(dollarSign)$\(dollarMag) (\(pctStr), end price $\(endStr))"
    }

    var lines: [String] = []
    for (i, m) in topN.enumerated() {
        lines.append("  \(i + 1). \(line(m))")
    }
    if !drags.isEmpty {
        lines.append("  Drag:")
        for d in drags {
            lines.append("    \(line(d))")
        }
    }
    let pctStr = String(format: "%+.2f%%", um.pct * 100)
    lines.append("  Portfolio total: \(pctStr)")
    return lines.joined(separator: "\n")
}

func formatStandingsBlock(_ standings: [UserStanding]) -> String {
    let placeLabels = ["1st", "2nd", "3rd", "4th", "5th"]
    var lines: [String] = []
    for (i, s) in standings.enumerated() {
        let place = i < placeLabels.count ? placeLabels[i] : "\(i+1)th"
        let pctStr = String(format: "%+.2f%%", s.pct * 100)
        var line = "  \(place). \(s.player.name): \(pctStr) portfolio"
        let topStr = s.topMovers.prefix(2).map { "\($0.ticker) \(String(format: "%+.2f%%", $0.pct * 100))" }.joined(separator: ", ")
        if !topStr.isEmpty { line += " — top: \(topStr)" }
        let dragOnly = s.bottomMovers.filter { $0.pct < 0 }.prefix(2)
        if !dragOnly.isEmpty {
            let dragStr = dragOnly.map { "\($0.ticker) \(String(format: "%+.2f%%", $0.pct * 100))" }.joined(separator: ", ")
            line += "; drag: \(dragStr)"
        }
        lines.append(line)
    }
    return lines.joined(separator: "\n")
}

// Pull the highest-signal articles in the window across ALL players' tickers.
// Each article is tagged with the archive bucket it came from so the LLM
// prompt can show [TICKER/owners] without re-detecting from the title text
// (which can mismatch when an article mentions multiple tickers).
// Capped at 15 so the prompt stays manageable.
func gameNewsArticles(window: WindowKey, gameAge: Int) -> [TaggedArticle] {
    let lookback = window.effectiveLookback(gameAge: gameAge)
    var seen: Set<String> = []
    var pool: [TaggedArticle] = []
    let allTickers = Array(Set(PLAYERS.flatMap { $0.tickers }))
    for ticker in allTickers {
        for a in loadArticlesInLastNDays(ticker: ticker, days: lookback) {
            if seen.insert(a.link).inserted {
                pool.append(TaggedArticle(article: a, ticker: ticker))
            }
        }
    }
    pool.sort { ($0.article.relevanceScore ?? 0) > ($1.article.relevanceScore ?? 0) }
    return Array(pool.prefix(15))
}

func buildGameSummaryPrompt(window: WindowKey, standings: [UserStanding], articles: [TaggedArticle], gameAge: Int) -> String {
    let standingsBlock = formatStandingsBlock(standings)
    let scope: String
    switch window {
    case .d1:  scope = "today"
    case .w1:  scope = "this past week"
    case .m1:  scope = gameAge < 30  ? "since the game's start on February 5, 2026 (\(gameAge) days ago)" : "this past month"
    case .m3:  scope = gameAge < 90  ? "since the game's start on February 5, 2026 (\(gameAge) days ago)" : "this past quarter"
    case .y1:  scope = gameAge < 365 ? "since the game's start on February 5, 2026 (\(gameAge) days ago)" : "this past year"
    case .all: scope = "since the game's start on February 5, 2026 (\(gameAge) days ago)"
    }
    var articleText = ""
    for (i, ta) in articles.enumerated() {
        let desc = String(ta.article.description.prefix(DESC_TRUNCATE))
        articleText += "\(i + 1). [\(ta.ticker)\(ownerSuffix(forTicker: ta.ticker))] \(ta.article.title)\n\(desc)\n\n"
    }
    return """
    You are commenting on the live leaderboard of a 4-player paper-portfolio competition that started on February 5, 2026. Today is day \(gameAge) of the game. Each player started with $100,000.

    PLAYERS (this is the only source of truth for who owns what):
      Brian: ASTS, AMZN, UBER, SERV, AAPL, QCOM, ISRG, CRSP, HON, EXOD
      Kevin: TSLA, NVDA, AVGO, MRVL, CRDO, PLTR, ORCL, ZS, VST, VRT
      Rick:  COHR, CRWV, GFS, GOOGL, NBIS, QBTS, NVDA, RKLB, S, TSLA
      Lee:   SPY (single position)

    LIVE STANDINGS for \(scope) (sorted by portfolio %, ranked 1st to 4th):
    \(standingsBlock)

    Most market-moving news from the period (each tagged [TICKER/owners], where owners are the player ids that hold that ticker):
    \(articleText)

    Your reader can already see the leaderboard and the standings table on the page. Your job is to explain WHAT HAPPENED IN THE NEWS that produced those rankings — not to restate them. The standings are the consequence; the news is the story. Lead every sentence with a concrete catalyst from the article archive — an earnings beat or miss, an FDA decision, an M&A announcement, an analyst upgrade or downgrade with a specific reason, a guidance change, a product launch, an executive change, a regulatory action. The player and the percentage are the consequence of the news, not the headline.

    Write exactly 3 sentences as a single paragraph of plain prose:
    Sentence 1: Lead with the single most consequential news event of \(scope) — name the specific catalyst (cite the headline or core fact from the article archive), the ticker, what it implies for the business. Then tie it to the player it helped and their portfolio %.
    Sentence 2: Lead with the biggest drag event of \(scope) — same structure: specific catalyst from the article archive, what it implies, then tie it to the player it hurt and their portfolio % loss.
    Sentence 3: A specific forward-looking catalyst from the article archive that could move the standings — upcoming earnings date, FDA milestone, product launch, named macro risk. Tie it to the player whose holding it would affect.

    Hard rules: Use the player names verbatim. Quote percentages from STANDINGS exactly — do not invent numbers or events. Do NOT use the structure "X is leading because of TICKER, Y is trailing because of TICKER" — that's just restating the standings table the reader already sees. Open every sentence with the news event, not the player or the percentage. Do not preface the digest. Do not number the sentences. Do not use bullet points.

    The PLAYERS section above is the only source of truth for which player owns which ticker. Before attributing a ticker move to a player, verify the ticker appears in that player's pick list. If a high-signal article relates to a ticker no one owns, you may omit it. Never invent ownership.
    """
}

struct GameOutcome {
    let windows: [String: WindowDigest]
}

func processGameSummary(data: PriceDataLite, gameAge: Int) async -> GameOutcome {
    log("• Game-wide summary: start")
    var perWindow: [String: WindowDigest] = [:]
    let nowISO = isoFormatter.string(from: Date())

    // Use the max archive depth across any ticker as the "days of data" since
    // the game-wide rollup spans every ticker.
    let allTickers = Array(Set(PLAYERS.flatMap { $0.tickers }))
    let daysAvail = allTickers.map { daysOfDataAvailable($0) }.max() ?? 0

    let entries: [(String, WindowDigest)] = await withTaskGroup(
        of: (String, WindowDigest).self
    ) { group -> [(String, WindowDigest)] in
        for w in WindowKey.allCases {
            let standings = computeStandings(data: data, window: w)
            let articles = gameNewsArticles(window: w, gameAge: gameAge)
            let effRequired = w.effectiveDaysRequired(gameAge: gameAge)
            let maturity = dataMaturity(daysOfData: daysAvail, daysRequired: effRequired)
            let bounds = rangeBounds(tradingDates: data.tradingDates, window: w)

            if standings.isEmpty || articles.isEmpty || maturity == "insufficient" {
                let key = w.rawValue
                group.addTask {
                    return (key, WindowDigest(
                        digest: nil,
                        articleCount: 0,
                        dateRange: nil,
                        avgRelevanceScore: nil,
                        generatedAt: nowISO,
                        aiEngine: nil,
                        dataMaturity: maturity,
                        daysOfData: daysAvail,
                        daysRequired: effRequired,
                        sources: nil
                    ))
                }
                continue
            }

            group.addTask {
                let prompt = buildGameSummaryPrompt(window: w, standings: standings, articles: articles, gameAge: gameAge)
                var digestText: String? = nil
                do {
                    let session = LanguageModelSession()
                    let response = try await session.respond(to: prompt)
                    digestText = cleanDigestProse(response.content)
                } catch {
                    logErr("processGameSummary error \(w.rawValue): \(error.localizedDescription)")
                }

                let articleObjs = articles.map { $0.article }
                let scores = articleObjs.compactMap { $0.relevanceScore }
                let avg = scores.isEmpty ? nil : (Double(scores.reduce(0, +)) / Double(scores.count))
                let sources = articleObjs.prefix(8).map { a in
                    SourceArticle(
                        title: a.title,
                        link: a.link,
                        source: a.source,
                        date: dayFormatter.string(from: parseFetchedAtDate(a.fetchedAt) ?? Date()),
                        score: a.relevanceScore ?? 0
                    )
                }
                log("  Game \(w.rawValue) → \(digestText != nil ? "✓" : "—") (\(articles.count) articles, \(standings.count) players)")
                return (w.rawValue, WindowDigest(
                    digest: digestText,
                    articleCount: articleObjs.count,
                    dateRange: bounds.startDate.isEmpty ? nil : DateRange(from: bounds.startDate, to: bounds.endDate),
                    avgRelevanceScore: avg,
                    generatedAt: nowISO,
                    aiEngine: digestText != nil ? "AppleIntelligence" : nil,
                    dataMaturity: maturity,
                    daysOfData: daysAvail,
                    daysRequired: effRequired,
                    sources: Array(sources)
                ))
            }
        }
        var collected: [(String, WindowDigest)] = []
        for await result in group {
            collected.append(result)
        }
        return collected
    }

    for (k, v) in entries {
        perWindow[k] = v
    }

    return GameOutcome(windows: perWindow)
}

// MARK: - Output writer

func writeOutputJSON(_ outcomes: [TickerOutcome], portfolios: [PortfolioOutcome], game: GameOutcome?, to outputURL: URL) throws {
    var holdings: [String: [String: WindowDigest]] = [:]
    for o in outcomes where !o.windows.isEmpty {
        holdings[o.ticker] = o.windows
    }
    var portfolioBlock: [String: [String: WindowDigest]] = [:]
    for p in portfolios where !p.windows.isEmpty {
        portfolioBlock[p.userId] = p.windows
    }
    let gameBlock = (game?.windows.isEmpty == false) ? game?.windows : nil
    let out = OutputJSON(
        generatedAt: isoFormatter.string(from: Date()),
        aiEngine: "AppleIntelligence",
        holdings: holdings,
        portfolios: portfolioBlock.isEmpty ? nil : portfolioBlock,
        game: gameBlock
    )
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    encoder.dateEncodingStrategy = .iso8601
    let data = try encoder.encode(out)
    let parent = outputURL.deletingLastPathComponent()
    try FileManager.default.createDirectory(at: parent, withIntermediateDirectories: true)
    try data.write(to: outputURL)
    log("✓ wrote \(outputURL.path)  (\(holdings.count) tickers, \(portfolioBlock.count) portfolios, \(gameBlock?.count ?? 0) game windows)")
}

// MARK: - Entry point

func runMain() async {
    let args = parseArgs()
    verboseEnabled = args.verbose

    if args.check {
        let model = SystemLanguageModel.default
        switch model.availability {
        case .available:
            print("✅ Apple Intelligence available (on-device and/or PCC)")
        case .unavailable(let reason):
            print("❌ Apple Intelligence unavailable: \(reason)")
            print("   Enable in System Settings → Apple Intelligence & Siri.")
            exit(1)
        }
        return
    }

    if case .unavailable(let reason) = SystemLanguageModel.default.availability {
        logErr("Apple Intelligence unavailable (\(reason)) — skipping digest run. Previous digests.json keeps serving.")
        exit(0)        // soft skip
    }

    let tickers = args.tickers.isEmpty ? DEFAULT_TICKERS : args.tickers
    log("Stock News Digest — \(tickers.count) ticker(s)")
    log("Engine: Apple Intelligence on-device/PCC")
    if args.dryRun { log("DRY RUN — nothing will be written") }

    // Top level (across tickers / portfolios / game) stays sequential — the
    // bottleneck is Apple Intelligence, and the on-device + PCC serializers
    // give us no meaningful overlap when we try to interleave tickers. WITHIN
    // a ticker / portfolio / game-window-group we fan out via withTaskGroup
    // so the per-window prompts at least pipeline through the model queue
    // back-to-back without per-call setup/teardown gaps.
    var outcomes: [TickerOutcome] = []
    for t in tickers {
        let o = await processTicker(t, args: args)
        outcomes.append(o)
    }

    if args.fetchOnly {
        log("--fetch-only complete; skipped digest output.")
        return
    }

    // Load prices.json up front — Phase 2 (portfolio rollups) needs it for
    // per-user standings, and Phase 3 (game-wide summary) needs it too.
    // The prices file lives next to the output digests.json by convention
    // (publicDir = outputPath's parent → publicDir/data/prices.json).
    let runAllTickers = args.tickers.isEmpty
    var priceData: PriceDataLite? = nil
    if runAllTickers {
        let publicDir = args.outputPath.deletingLastPathComponent()
        let pricesURL = publicDir.appendingPathComponent("data/prices.json")
        priceData = loadPriceData(at: pricesURL)
        if priceData == nil {
            logErr("Could not load prices.json at \(pricesURL.path) — Phase 2 + Phase 3 will be skipped.")
        }
    }

    // Phase 2: per-user portfolio rollups. Skip when running on a subset of
    // tickers (any user whose roster isn't fully covered would generate
    // misleading prose) or when prices.json isn't readable. The full
    // all-tickers run hits this path daily.
    var portfolios: [PortfolioOutcome] = []
    if runAllTickers, let pd = priceData {
        let gameAge = gameAgeInDays()
        for player in PLAYERS {
            let p = await processPortfolio(player, data: pd, gameAge: gameAge)
            portfolios.append(p)
        }
    } else if !runAllTickers {
        log("Skipping portfolio rollups (subset run).")
    } else {
        log("Skipping portfolio rollups (prices.json unavailable).")
    }

    // Phase 3: game-wide leaderboard analysis. Reads public/data/prices.json
    // for live standings, combines with the article archive to explain *why*
    // the leaderboard looks like it does. Same subset-skip rule as above.
    var game: GameOutcome? = nil
    if runAllTickers, let pd = priceData {
        let gameAge = gameAgeInDays()
        game = await processGameSummary(data: pd, gameAge: gameAge)
    } else if !runAllTickers {
        log("Skipping game-wide summary (subset run).")
    }

    if args.dryRun {
        log("DRY RUN complete; no files written.")
        return
    }

    do {
        try writeOutputJSON(outcomes, portfolios: portfolios, game: game, to: args.outputPath)
    } catch {
        logErr("Failed to write output JSON: \(error.localizedDescription)")
        exit(1)
    }
}

// Bridge async to top-level script.
let semaphore = DispatchSemaphore(value: 0)
Task {
    await runMain()
    semaphore.signal()
}
semaphore.wait()
