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

func log(_ msg: String) {
    let ts = isoFormatter.string(from: Date())
    let line = "[\(ts)] \(msg)\n"
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

func logErr(_ msg: String) {
    let ts = isoFormatter.string(from: Date())
    let line = "[\(ts)] \(msg)\n"
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
}

enum WindowKey: String, CaseIterable {
    case d1 = "1D"
    case w1 = "1W"
    case m1 = "1M"
    case m3 = "3M"
    case y1 = "1Y"
    case all = "ALL"

    // Days required for the window to be considered "full" / mature.
    // ALL is always mature once any article is archived — it summarizes the
    // entire game span (since 2026-02-05) regardless of duration.
    var daysRequired: Int {
        switch self {
        case .d1: return 1
        case .w1: return 7
        case .m1: return 30
        case .m3: return 90
        case .y1: return 365
        case .all: return 1
        }
    }

    // Archive lookback. ALL caps at the planned 5-year game length so we
    // never blow up prompt size — top-relevance sampling further trims it.
    var lookbackDays: Int {
        switch self {
        case .all: return 365 * 5
        default:   return daysRequired
        }
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

func articlesForWindow(ticker: String, window: WindowKey) -> [Article] {
    let articles = loadArticlesInLastNDays(ticker: ticker, days: window.lookbackDays)
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

func buildDigestPrompt(ticker: String, window: WindowKey, articles: [Article]) -> String {
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
        return """
        You are a financial analyst writing a monthly briefing for an investor holding \(ticker) (\(name)).
        These are the highest-signal developments from the past 30 days, ranked by investor relevance.
        Write exactly 3 sentences: (1) the month's defining theme, (2) the biggest catalyst or risk that emerged, (3) where the stock stands heading into next month.
        Be specific — cite actual events, not vague generalities. Write only the 3-sentence digest as a single paragraph of plain prose. Do not preface it. Do not number the sentences. Do not use bullet points.

        Articles:
        \(articleText)
        """
    case .m3:
        return """
        You are a financial analyst writing a quarterly briefing for an investor holding \(ticker) (\(name)).
        These are the highest-signal developments from the past 90 days, ranked by investor relevance.
        Write exactly 3 sentences: (1) the quarter's defining theme or catalyst, (2) major risks or opportunities that emerged, (3) how the investment thesis has evolved.
        Be specific — cite actual events, not vague generalities. Write only the 3-sentence digest as a single paragraph of plain prose. Do not preface it. Do not number the sentences. Do not use bullet points.

        Articles:
        \(articleText)
        """
    case .y1:
        return """
        You are a financial analyst writing an annual briefing for an investor holding \(ticker) (\(name)).
        These are the year's most material business developments, filtered for relevance.
        Write exactly 3 sentences: (1) the year's most important storyline and its market impact, (2) how the company's competitive position or financial trajectory changed, (3) the long-term outlook based on this year's arc of events.
        Be concrete and specific. No filler. Write only the 3-sentence digest as a single paragraph of plain prose. Do not preface it. Do not number the sentences. Do not use bullet points.

        Articles:
        \(articleText)
        """
    case .all:
        return """
        You are a financial analyst writing a long-horizon summary for an investor holding \(ticker) (\(name)) since February 5, 2026 — the start of a 5-year tracking period.
        These are the most material business developments across the entire holding period, filtered for investor relevance and ranked by signal.
        Write exactly 3 sentences: (1) the defining arc of the company over this period — biggest catalysts, pivots, or regime changes, (2) how the original investment thesis has evolved or been challenged, (3) the structural outlook from here based on what these events imply about competitive position and execution.
        Be concrete and specific. Reference actual events, not generic commentary. Write only the 3-sentence digest as a single paragraph of plain prose. Do not preface it. Do not number the sentences. Do not use bullet points.

        Articles:
        \(articleText)
        """
    }
}

func generateDigestText(ticker: String, window: WindowKey, articles: [Article]) async -> String? {
    guard !articles.isEmpty else { return nil }
    let prompt = buildDigestPrompt(ticker: ticker, window: window, articles: articles)
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

    // 6. Generate digests for every window
    let daysAvail = daysOfDataAvailable(ticker)
    var anyAI = false
    for w in WindowKey.allCases {
        let articles = articlesForWindow(ticker: ticker, window: w)
        let maturity = dataMaturity(daysOfData: daysAvail, daysRequired: w.daysRequired)

        if articles.isEmpty || maturity == "insufficient" {
            perWindow[w.rawValue] = WindowDigest(
                digest: nil,
                articleCount: 0,
                dateRange: nil,
                avgRelevanceScore: nil,
                generatedAt: nowISO,
                aiEngine: nil,
                dataMaturity: maturity,
                daysOfData: daysAvail,
                daysRequired: w.daysRequired,
                sources: nil
            )
            continue
        }

        let digestText = await generateDigestText(ticker: ticker, window: w, articles: articles)
        let scores = articles.compactMap { $0.relevanceScore }
        let avg = scores.isEmpty ? nil : (Double(scores.reduce(0, +)) / Double(scores.count))
        let dates = articles.map { dayFormatter.string(from: parseFetchedAtDate($0.fetchedAt) ?? Date()) }.sorted()
        let dateRange: DateRange? = (dates.first.map { from in
            DateRange(from: from, to: dates.last ?? from)
        })
        let sources = articles.prefix(8).map { a in
            SourceArticle(
                title: a.title,
                link: a.link,
                source: a.source,
                date: dayFormatter.string(from: parseFetchedAtDate(a.fetchedAt) ?? Date()),
                score: a.relevanceScore ?? 0
            )
        }
        if digestText != nil { anyAI = true }
        perWindow[w.rawValue] = WindowDigest(
            digest: digestText,
            articleCount: articles.count,
            dateRange: dateRange,
            avgRelevanceScore: avg,
            generatedAt: nowISO,
            aiEngine: digestText != nil ? "AppleIntelligence" : nil,
            dataMaturity: maturity,
            daysOfData: daysAvail,
            daysRequired: w.daysRequired,
            sources: Array(sources)
        )
        log("  \(ticker) \(w.rawValue) → \(digestText != nil ? "✓" : "—") (\(articles.count) articles, maturity=\(maturity))")
    }

    return TickerOutcome(ticker: ticker, windows: perWindow, aiEngineUsed: anyAI)
}

func parseFetchedAtDate(_ s: String) -> Date? {
    isoFormatter.date(from: s) ?? ISO8601DateFormatter().date(from: s)
}

// MARK: - Output writer

func writeOutputJSON(_ outcomes: [TickerOutcome], to outputURL: URL) throws {
    var holdings: [String: [String: WindowDigest]] = [:]
    for o in outcomes where !o.windows.isEmpty {
        holdings[o.ticker] = o.windows
    }
    let out = OutputJSON(
        generatedAt: isoFormatter.string(from: Date()),
        aiEngine: "AppleIntelligence",
        holdings: holdings
    )
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    encoder.dateEncodingStrategy = .iso8601
    let data = try encoder.encode(out)
    let parent = outputURL.deletingLastPathComponent()
    try FileManager.default.createDirectory(at: parent, withIntermediateDirectories: true)
    try data.write(to: outputURL)
    log("✓ wrote \(outputURL.path)  (\(holdings.count) tickers)")
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

    // Sequential — Apple Intelligence sessions are heavyweight and the on-device
    // model serializes its work anyway. Parallelism gains are small vs. log clarity.
    var outcomes: [TickerOutcome] = []
    for t in tickers {
        let o = await processTicker(t, args: args)
        outcomes.append(o)
    }

    if args.fetchOnly {
        log("--fetch-only complete; skipped digest output.")
        return
    }

    if args.dryRun {
        log("DRY RUN complete; no files written.")
        return
    }

    do {
        try writeOutputJSON(outcomes, to: args.outputPath)
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
