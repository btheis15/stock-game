#!/usr/bin/env swift

// digest.swift — Stock News Digest pipeline for the Stock Game app.
//
// Fetches per-ticker Yahoo Finance RSS, two-stage filters (keyword pre-filter
// then Apple Intelligence relevance scoring), archives surviving articles
// per-day, then generates time-windowed prose digests (1D / 1W / 1M / 3M / 1Y)
// for each ticker. Output is written to a single digests.json the web app
// reads directly.
//
// Apple Intelligence is the only AI engine — no third-party cloud. On macOS 27
// it prefers Apple's Private Cloud Compute model (larger context window +
// deeper reasoning, reached over the same privacy-preserving path) and falls
// back per-call to the on-device model; set DIGEST_ENGINE=on-device to force
// the legacy on-device-only path. If on-device Apple Intelligence is
// unavailable the run is skipped and the previous digests.json keeps serving.
//
// Usage:
//   swift digest.swift                    # all tickers, default config
//   swift digest.swift HON                # specific tickers only
//   swift digest.swift HON AAPL --verbose
//   swift digest.swift --check            # availability probe (on-device + PCC) and exit
//   DIGEST_ENGINE=on-device swift digest.swift   # force on-device, skip PCC
//   swift digest.swift --dry-run HON      # fetch + filter, write nothing
//   swift digest.swift --output PATH      # override digests.json destination
//   swift digest.swift --fetch-only       # fetch + archive, skip digest gen
//   swift digest.swift --digests-only     # regenerate digests from archive

import Foundation
import FoundationModels

// MARK: - Configuration
//
// Roster / ticker config is loaded from `config/roster.json` at startup —
// the SAME file `lib/picks.ts` imports. Edits land via GitHub web UI or any
// push from any device; the Mac mini's next 15-min git pull picks them up,
// fetch-prices.ts auto-pulls historical bars for any newly-added tickers
// back to start_date (which makes backtracking automatic — shares =
// startingDollars/N / startClose for every holding), and the next daily
// digest run regenerates portfolio + game digests using the new roster.
//
// If the JSON fails to load or parse, we fall back to the EMBEDDED defaults
// below. That avoids leaving the Mac mini stuck if someone pushes malformed
// JSON; the next push that fixes the JSON resumes normal operation.

struct RawRosterUser: Codable {
    let id: String
    let name: String
    let color: String
    let color_rgb: String
    let tickers: [String]
}

struct RawRosterBaseline: Codable {
    let id: String
    let name: String
    let color: String
    let color_rgb: String
    let ticker: String
}

struct RawRoster: Codable {
    let start_date: String
    let starting_dollars: Double
    let baseline: RawRosterBaseline
    let users: [RawRosterUser]
    let ticker_names: [String: String]
}

// Embedded fallback — last-known-good roster as of code commit time. Used
// only when `config/roster.json` is missing or won't parse. Keeping this
// here means a broken roster.json push doesn't disable the pipeline.
let EMBEDDED_DEFAULT_TICKERS = [
    "ASTS","AMZN","UBER","SERV","AAPL","QCOM","ISRG","CRSP","HON","EXOD",
    "TSLA","NVDA","AVGO","MRVL","CRDO","PLTR","ORCL","ZS","VST","VRT",
    "COHR","CRWV","GFS","GOOGL","NBIS","QBTS","RKLB","S",
    "PEP","GM","TAP","VZ","UL","DKS","WMT","PFE","HD",
    "ASML","OKLO","GLUE","VVOS","HUT","AMRZ","SMR","ZBRA",
    "F","STLA","TM","HMC",
]

let EMBEDDED_TICKER_NAMES: [String: String] = [
    "ASTS": "AST SpaceMobile", "AMZN": "Amazon", "UBER": "Uber",
    "SERV": "Serve Robotics", "AAPL": "Apple", "QCOM": "Qualcomm",
    "ISRG": "Intuitive Surgical", "CRSP": "CRISPR Therapeutics",
    "HON": "Honeywell", "EXOD": "Exodus Movement", "TSLA": "Tesla",
    "NVDA": "NVIDIA", "AVGO": "Broadcom", "MRVL": "Marvell",
    "CRDO": "Credo Technology", "PLTR": "Palantir", "ORCL": "Oracle",
    "ZS": "Zscaler", "VST": "Vistra", "VRT": "Vertiv", "COHR": "Coherent",
    "CRWV": "CoreWeave", "GFS": "GlobalFoundries", "GOOGL": "Alphabet",
    "NBIS": "Nebius Group", "QBTS": "D-Wave Quantum", "RKLB": "Rocket Lab",
    "S": "SentinelOne", "PEP": "PepsiCo", "GM": "General Motors",
    "TAP": "Molson Coors Beverage", "VZ": "Verizon", "UL": "Unilever",
    "DKS": "Dick's Sporting Goods", "WMT": "Walmart", "PFE": "Pfizer",
    "HD": "Home Depot", "ASML": "ASML Holding", "OKLO": "Oklo",
    "GLUE": "Monte Rosa Therapeutics", "VVOS": "Vivos Therapeutics",
    "HUT": "Hut 8", "AMRZ": "Amrize", "SMR": "NuScale Power",
    "ZBRA": "Zebra Technologies",
    "F": "Ford",
    "STLA": "Stellantis",
    "TM": "Toyota",
    "HMC": "Honda",
]

// Resolve config/roster.json relative to the swift script's location.
// digest.swift lives in <REPO>/scripts/; roster.json lives in <REPO>/config/.
let ROSTER_JSON_URL: URL = {
    let scriptPath = URL(fileURLWithPath: CommandLine.arguments.first ?? #filePath)
    let scriptsDir = scriptPath.deletingLastPathComponent()
    let repoDir = scriptsDir.deletingLastPathComponent()
    return repoDir.appendingPathComponent("config/roster.json")
}()

func loadRoster() -> RawRoster? {
    guard let data = try? Data(contentsOf: ROSTER_JSON_URL) else {
        fputs("⚠ roster.json missing at \(ROSTER_JSON_URL.path) — using embedded defaults\n", stderr)
        return nil
    }
    do {
        return try JSONDecoder().decode(RawRoster.self, from: data)
    } catch {
        fputs("⚠ roster.json failed to parse (\(error.localizedDescription)) — using embedded defaults\n", stderr)
        return nil
    }
}

// One-time load. All subsequent code reads from the constants below.
let LOADED_ROSTER: RawRoster? = loadRoster()

let DEFAULT_TICKERS: [String] = {
    guard let r = LOADED_ROSTER else { return EMBEDDED_DEFAULT_TICKERS }
    // Dedupe while preserving first-seen order across users.
    var seen: Set<String> = []
    var ordered: [String] = []
    for u in r.users {
        for t in u.tickers where !seen.contains(t) {
            seen.insert(t)
            ordered.append(t)
        }
    }
    return ordered
}()

let TICKER_NAMES: [String: String] = LOADED_ROSTER?.ticker_names ?? EMBEDDED_TICKER_NAMES

let RELEVANCE_THRESHOLD = 6
// Per-article description truncation when an article is rendered into a
// digest prompt. 300 chars × ~30 articles + the prompt template stays under
// ~3K tokens, well within Apple Intelligence's on-device + PCC routing
// thresholds. Earlier versions used 400 chars combined with uncapped
// articles for 1D/1W, which let popular tickers (AMZN, AAPL) blow past
// the context window with 100+ articles in a week.
let DESC_TRUNCATE = 300

// Player roster — sourced from config/roster.json (same file lib/picks.ts
// imports). Falls back to an embedded copy if the JSON load failed; see
// LOADED_ROSTER above.
struct PlayerRoster {
    let id: String
    let name: String
    let tickers: [String]
}

let EMBEDDED_PLAYERS: [PlayerRoster] = [
    PlayerRoster(id: "brian",  name: "Brian",
        tickers: ["ASTS","AMZN","UBER","SERV","AAPL","QCOM","ISRG","CRSP","HON","EXOD"]),
    PlayerRoster(id: "kevin",  name: "Kevin",
        tickers: ["TSLA","NVDA","AVGO","MRVL","CRDO","PLTR","ORCL","ZS","VST","VRT"]),
    PlayerRoster(id: "rick",   name: "Rick",
        tickers: ["COHR","CRWV","GFS","GOOGL","NBIS","QBTS","NVDA","RKLB","S","TSLA"]),
    PlayerRoster(id: "lee",    name: "Lee",
        tickers: ["PEP","GM","TAP","VZ","UL","DKS","WMT","PFE","HD","AAPL"]),
    PlayerRoster(id: "gene",   name: "Gene",
        tickers: ["ASML","CRSP","OKLO","GLUE","VVOS","HUT","AMRZ","SMR","RKLB","ZBRA"]),
]

let PLAYERS: [PlayerRoster] = {
    guard let r = LOADED_ROSTER else { return EMBEDDED_PLAYERS }
    return r.users.map { u in
        PlayerRoster(id: u.id, name: u.name, tickers: u.tickers)
    }
}()

// --- User-created funds (config/funds.json) ---------------------------------
// Read at startup; loaded array stays in memory for the duration of the
// process. Empty array when the file is missing or all funds are archived.
//
// Soft-deleted funds within the 7-day restore window stay in the file too,
// but only ACTIVE funds (deletedAt == nil) get AI digests — once archived,
// the existing prose just sits frozen until restored.

struct RawFundHolding: Codable {
    let ticker: String
    let weight: Double
}

struct RawFund: Codable {
    let id: String
    let name: String
    let creator: String?
    let color: String
    let createdAt: String
    let updatedAt: String
    let deletedAt: String?
    let holdings: [RawFundHolding]
}

struct RawFundsFile: Codable {
    let funds: [RawFund]
}

let FUNDS_JSON_URL: URL = {
    let scriptPath = URL(fileURLWithPath: CommandLine.arguments.first ?? #filePath)
    let scriptsDir = scriptPath.deletingLastPathComponent()
    let repoDir = scriptsDir.deletingLastPathComponent()
    return repoDir.appendingPathComponent("config/funds.json")
}()

func loadFundsFromDisk() -> [RawFund] {
    guard let data = try? Data(contentsOf: FUNDS_JSON_URL) else { return [] }
    guard let parsed = try? JSONDecoder().decode(RawFundsFile.self, from: data) else {
        fputs("⚠ funds.json failed to parse — fund digests will be skipped this run\n", stderr)
        return []
    }
    return parsed.funds
}

// Active funds for digest generation. Archived funds keep their existing
// prose; restoring re-enables digest generation on the next run.
let ACTIVE_FUNDS: [RawFund] = loadFundsFromDisk().filter { $0.deletedAt == nil }

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

// Used inside prompts to make ticker ownership explicit. The previous form
// "[ASTS/brian]" looked too much like a byline ("ASTS as reported by Brian"),
// which led Apple Intelligence to write nonsense like "QCOM's investor day,
// as reported by Brian, …" — Brian doesn't report; he holds. The new form
// "[ASTS · held by Brian]" reads as a clear ownership annotation.
func ownerLabel(forTicker t: String) -> String {
    let ownerIds = TICKER_OWNERS[t] ?? []
    if ownerIds.isEmpty { return "held by no one" }
    let names: [String] = ownerIds.compactMap { id in
        PLAYERS.first(where: { $0.id == id })?.name
    }
    switch names.count {
    case 1: return "held by \(names[0])"
    case 2: return "held by \(names[0]) and \(names[1])"
    default:
        let last = names.last!
        let rest = names.dropLast().joined(separator: ", ")
        return "held by \(rest), and \(last)"
    }
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

// Refresh tier — controls which entities and which windows are regenerated.
// fast   — runs after every 15-min price refresh. Touches only game 1D/1W/1M
//          digests, and only by re-rendering their stored templates against
//          the latest prices.json. Zero AI calls, finishes in <2s.
// daily  — runs once weekday morning. Full RSS fetch + scoring, regenerates
//          holdings 1D + 1W, portfolios 1D + 1W, and ALL game windows (the
//          three short-window game digests are emitted with `digestTemplate`
//          fields so the fast tier can re-render them later).
// weekly — runs Saturday morning. No RSS fetch. Regenerates the slow windows
//          for both holdings and portfolios: 1M / 3M / 1Y / ALL. Game digests
//          are not touched (they refresh daily / fast).
enum Scope: String {
    case fast, daily, weekly, game, finalize, backfill
}

struct Args {
    var tickers: [String] = []      // empty = all
    var check = false
    var dryRun = false
    var verbose = false
    var fetchOnly = false
    var digestsOnly = false
    var scope: Scope = .daily
    var outputPath = DEFAULT_OUTPUT
    // --chunk N/M (0-indexed) — slice DEFAULT_TICKERS into M roughly-equal
    // groups and run only the Nth. Used by the scheduler's chunked morning
    // mode to spread the daily run across multiple shorter passes. Per-ticker
    // work runs for this chunk; per-portfolio and game-wide rollups are
    // skipped automatically because args.tickers ends up non-empty (the
    // existing subset-skip rule in writeOutputJSON's caller).
    var chunkIndex: Int? = nil
    var chunkTotal: Int? = nil
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
        case "--scope":
            i += 1
            if i < argv.count, let s = Scope(rawValue: argv[i].lowercased()) {
                a.scope = s
            } else {
                fputs("--scope requires one of: fast, daily, weekly, game, finalize, backfill\n", stderr)
                exit(2)
            }
        case "--chunk":
            i += 1
            if i < argv.count {
                let parts = argv[i].split(separator: "/")
                if parts.count == 2,
                   let idx = Int(parts[0]),
                   let total = Int(parts[1]),
                   total > 0, idx >= 0, idx < total {
                    a.chunkIndex = idx
                    a.chunkTotal = total
                } else {
                    fputs("--chunk requires N/M where 0 <= N < M and M > 0\n", stderr)
                    exit(2)
                }
            } else {
                fputs("--chunk requires an argument (N/M)\n", stderr)
                exit(2)
            }
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

// Windows each scope is responsible for, per entity. Anything not in the list
// is preserved from the existing digests.json (the loader is responsible for
// reading the prior file and merging).
let HOLDING_WINDOWS_DAILY: [WindowKey]  = [.d1, .w1]
let HOLDING_WINDOWS_WEEKLY: [WindowKey] = [.m1, .m3, .y1, .all]
let PORTFOLIO_WINDOWS_DAILY: [WindowKey]  = [.d1, .w1]
let PORTFOLIO_WINDOWS_WEEKLY: [WindowKey] = [.m1, .m3, .y1, .all]
// User-created funds get a deliberately tighter set: 1D + 1W only. No
// long-window history — funds are lighter-weight than players (2-sentence
// prose, no company brief), so the morning chunked run doesn't balloon
// as the fund count grows.
let FUND_WINDOWS_DAILY: [WindowKey] = [.d1, .w1]
let TEMPLATED_FUND_WINDOWS: Set<WindowKey> = [.d1, .w1]

// Game digests emitted with a `digestTemplate` (rendered & live-substituted
// by the fast tier on every cron tick). The other game windows are regenerated
// daily but not templated — their pcts are stale until the next morning run.
let TEMPLATED_GAME_WINDOWS: Set<WindowKey> = [.d1, .w1, .m1]

// Per-portfolio + per-holding digests also emit templates for these windows.
// Daily AI run produces the prose with `{{TICKER}}` / `{{user:UID}}` placeholders
// (via extractGameDigestTemplate — the function name is historical; the
// extractor is generic), the fast tier re-renders against live prices every
// 15 min. Weekly windows (1M/3M/1Y/ALL) stay literal — they're only
// regenerated weekly and we don't expect intraday-current numbers in them.
let TEMPLATED_PORTFOLIO_WINDOWS: Set<WindowKey> = [.d1, .w1, .m1]
let TEMPLATED_HOLDING_WINDOWS: Set<WindowKey> = [.d1, .w1, .m1]

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
    // Templated prose — present only for game 1D / 1W / 1M digests. Tokens of
    // the form {{TICKER}} or {{user:USERID}} mark the spots where a live
    // percentage should be substituted by the fast tier. The morning daily run
    // generates the prose, extracts the template, and stores both. Each fast
    // tier tick reads `digestTemplate`, substitutes live pcts from prices.json,
    // and overwrites `digest`. `digest` is always the rendered (display-ready)
    // form; `digestTemplate` is the source.
    var digestTemplate: String? = nil
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
    // Per-fund short briefings (Phase 4). Key is the fund id from
    // config/funds.json. Only 1D + 1W windows are stored — funds are
    // intentionally lighter weight than player portfolios (2 sentences,
    // no company brief, no long-window history) so the morning chunked
    // run doesn't balloon as the fund count grows.
    var funds: [String: [String: WindowDigest]]?
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

    // News lookback — deliberately WIDER than the price window for the short
    // windows. A catalyst from a few days ago often still explains where the
    // price sits today (a Thursday report a stock is still riding on Friday,
    // or Friday news read on Monday across a weekend). Searching only the
    // price window made the digest claim "no notable news" while the move was
    // entirely explained by recent-but-just-outside-the-window news. The cap
    // (ARTICLES_PER_WINDOW_CAP) still bounds the prompt size, and the fact
    // block / prompt tell the model how old each catalyst is so it frames an
    // older one as "still reacting to …" rather than as fresh news.
    func newsLookback(gameAge: Int) -> Int {
        switch self {
        case .d1: return 5
        case .w1: return 10
        case .m1, .m3, .y1, .all: return effectiveLookback(gameAge: gameAge)
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

// MARK: - AI engine selection (Apple Intelligence: PCC + on-device)
//
// iOS/macOS 26 only exposed the on-device model (~4k-token context), which is
// the whole reason this pipeline summarizes hierarchically (facts → daily →
// weekly → monthly) to keep every prompt small. macOS 27's FoundationModels
// adds `PrivateCloudComputeLanguageModel` — Apple's own Private Cloud Compute
// model, with a much larger context window and stronger reasoning, reached
// over the same privacy-preserving Apple Intelligence path. It is NOT a
// third-party cloud, so preferring it keeps the "Apple Intelligence is the
// only engine" invariant intact.
//
// We prefer PCC when the device is enrolled and PCC reports available, and
// transparently fall back to the on-device model on a per-call basis if a PCC
// request throws (quota exhausted, transient network). Worst case the run
// degrades to exactly the pre-27 on-device behavior. Override with the
// DIGEST_ENGINE env var: `on-device` forces the legacy path; `auto` (default)
// prefers PCC.

enum DigestReasoning {
    case standard      // classification / extraction — keep it cheap + fast
    case deep          // multi-summary synthesis, leaderboard reasoning
}

final class AIEngine: @unchecked Sendable {
    enum Kind: String { case privateCloudCompute = "Private Cloud Compute", onDevice = "on-device" }
    let kind: Kind
    private let pcc: PrivateCloudComputeLanguageModel?

    private init(kind: Kind, pcc: PrivateCloudComputeLanguageModel?) {
        self.kind = kind
        self.pcc = pcc
    }

    static let onDevice = AIEngine(kind: .onDevice, pcc: nil)

    // PCC can report `.available` yet fail EVERY generation when the host
    // process lacks the PCC entitlement — a bare `swift digest.swift` CLI run
    // hits `ModelManagerError 1046` even with quota to spare. So engine
    // selection is NOT just an availability check: we send one real probe
    // request and only commit to PCC if it actually generates; otherwise we
    // use the on-device model for the whole run (no per-call PCC retries, no
    // log flooding). Resolved once at startup, before any fan-out.
    // DIGEST_ENGINE overrides: `on-device` skips PCC entirely; `pcc` trusts
    // PCC and skips the probe (use once the pipeline runs from a signed,
    // entitled context where PCC generation is permitted).
    static func resolve() async -> AIEngine {
        let env = (ProcessInfo.processInfo.environment["DIGEST_ENGINE"] ?? "auto").lowercased()
        if env == "on-device" || env == "ondevice" { return .onDevice }

        let pcc = PrivateCloudComputeLanguageModel()
        guard case .available = pcc.availability else { return .onDevice }
        let candidate = AIEngine(kind: .privateCloudCompute, pcc: pcc)
        if env == "pcc" || env == "force-pcc" { return candidate }

        do {
            _ = try await candidate.newSession().respond(
                to: "Reply with the single word: ok",
                contextOptions: candidate.contextOptions(for: .standard)
            )
            return candidate
        } catch {
            logErr("PCC reported available but its probe request failed (\(error.localizedDescription)) — using the on-device model for this run. Set DIGEST_ENGINE=pcc to skip this probe once PCC generation is entitled.")
            return .onDevice
        }
    }

    // Fresh session per call site — the pipeline intentionally never reuses a
    // session, so per-article / per-window prompts can't bleed context.
    func newSession() -> LanguageModelSession {
        if let pcc { return LanguageModelSession(model: pcc) }
        return LanguageModelSession()       // SystemLanguageModel.default (on-device)
    }

    // reasoningLevel only applies to the PCC model; leaving it nil on-device
    // preserves byte-identical pre-27 behavior on the fallback path.
    func contextOptions(for reasoning: DigestReasoning) -> ContextOptions {
        guard kind == .privateCloudCompute else { return ContextOptions() }
        switch reasoning {
        case .standard: return ContextOptions(reasoningLevel: .moderate)
        case .deep:     return ContextOptions(reasoningLevel: .deep)
        }
    }
}

// Set once by main() before any fan-out (via AIEngine.resolve()); read-only
// thereafter, so the concurrent per-window task groups can read it without
// synchronization. Defaults to on-device so any code path that runs before
// resolution still works.
nonisolated(unsafe) var AI_ENGINE: AIEngine = .onDevice

// Bounds the number of Apple Intelligence requests in flight at once.
//
// On iOS/macOS 26 the model SERIALIZED concurrent respond() calls — firing
// several gave no overlap — so this pipeline processed tickers strictly one at
// a time. macOS 27 runs concurrent respond() calls genuinely in parallel
// (measured ~2.7x for 4-way on-device on this M1). So we now fan the
// previously-serial ticker / portfolio / fund loops out (see mapConcurrent
// below). This actor is the single global throttle: every AI call funnels
// through it, so no matter how the outer loops nest with the per-window
// withTaskGroups inside each item, total in-flight inference never exceeds the
// limit — which keeps us from swamping the model queue / memory on constrained
// hardware (the 8 GB M1 mini). Tune with DIGEST_AI_CONCURRENCY (default 4); 1
// restores the old strictly-serial behavior.
actor AIGate {
    static let limit: Int = {
        if let v = ProcessInfo.processInfo.environment["DIGEST_AI_CONCURRENCY"],
           let n = Int(v), n >= 1 { return n }
        return 4
    }()
    static let shared = AIGate()
    private var available = AIGate.limit
    private var waiters: [CheckedContinuation<Void, Never>] = []

    func acquire() async {
        if available > 0 { available -= 1; return }
        await withCheckedContinuation { waiters.append($0) }   // resumed = slot handed to us
    }
    func release() {
        if waiters.isEmpty { available += 1 }
        else { waiters.removeFirst().resume() }                 // hand the slot straight to a waiter
    }
}

// Concurrency cap for PCC-via-fm-serve prose calls. PCC runs in the cloud, not
// on the mini's 8 GB of RAM, so it isn't bound by the on-device memory limit
// that pins AIGate at 4 — we can fan the per-ticker / per-window summary calls
// out much wider. The real ceiling here is fm serve / PCC throughput. Tune with
// DIGEST_PCC_CONCURRENCY (default 8). A failed PCC call hands its slot back
// before the on-device fallback acquires an AIGate slot, so the two gates are
// never held at once and can't deadlock.
actor PCCGate {
    static let limit: Int = {
        if let v = ProcessInfo.processInfo.environment["DIGEST_PCC_CONCURRENCY"],
           let n = Int(v), n >= 1 { return n }
        return 8
    }()
    static let shared = PCCGate()
    private var available = PCCGate.limit
    private var waiters: [CheckedContinuation<Void, Never>] = []
    func acquire() async {
        if available > 0 { available -= 1; return }
        await withCheckedContinuation { waiters.append($0) }
    }
    func release() {
        if waiters.isEmpty { available += 1 }
        else { waiters.removeFirst().resume() }
    }
}

// ── Apple Intelligence prose engine: Private Cloud Compute via `fm serve` ────
//
// Every PROSE summary in this pipeline (facts, daily/weekly/monthly summaries,
// company briefs, per-stock / portfolio / fund / game window digests) now runs
// on PCC. PCC's larger model is dramatically better at multi-source synthesis
// than the small on-device one — it's what fixes the vague, "generic"-padded
// summaries the on-device model produced.
//
// PCC isn't reachable in-process from a plain `swift digest.swift` CLI run — the
// process isn't entitled, so every in-process PCC generation fails with
// `ModelManagerError 1046`. Apple's own `fm serve` is the way through: an
// OpenAI-compatible HTTP endpoint, hosted inside a foreground Terminal/GUI
// context (a Login Item on the Mac mini — see APPLE_PCC.md), that reaches PCC on
// our behalf. So prose calls POST to fm serve with `model=pcc`, and fall back to
// the in-process on-device model if the server is down or PCC errors mid-run, so
// the digest always ships. All AI stays inside Apple — no third-party API.
//
// The relevance SCORER (scoreArticleAI) is deliberately NOT routed here: it's a
// high-volume, temperature-0 per-article filter (hundreds of calls per run), not
// a summary, so it stays on-device for speed + determinism. Callers that must
// stay on-device pass `preferPCCServe: false`.
//
// SUMMARY_ENGINE=on-device forces the whole prose pipeline back on-device.
let FM_SERVE_URL = ProcessInfo.processInfo.environment["FM_SERVE_URL"]
    ?? "http://127.0.0.1:8799/v1/chat/completions"
let SUMMARY_ENGINE: String = (
    ProcessInfo.processInfo.environment["SUMMARY_ENGINE"]
        // GAME_SUMMARY_ENGINE was the older game-only knob; honor it for back-compat.
        ?? ProcessInfo.processInfo.environment["GAME_SUMMARY_ENGINE"]
        ?? "on-device"
).lowercased()
let SUMMARY_USES_PCC = (SUMMARY_ENGINE != "on-device" && SUMMARY_ENGINE != "ondevice")

// Backfill mode (--scope backfill) regenerates the cached summary chain on PCC.
// When strict, a PCC failure does NOT fall back to on-device — which would
// poison the write-once cache with a lesser summary that then looks "done" —
// instead it throws, the generator skips the write, and the entry is retried on
// the next backfill run. The failure count drives the run's quota hard-stop.
nonisolated(unsafe) var BACKFILL_STRICT_PCC = false
actor PCCFailureTracker {
    static let shared = PCCFailureTracker()
    private var n = 0
    func record() { n += 1 }
    func count() -> Int { n }
}

// Temperature per tier (engine-independent). Classification/extraction
// (.standard) runs at 0.0 so the same input scores identically every run; prose
// synthesis (.deep) gets a mild temperature to read naturally.
func temperatureFor(_ reasoning: DigestReasoning) -> Double {
    switch reasoning {
    case .standard: return 0.0
    case .deep:     return 0.4
    }
}

func generationOptions(for reasoning: DigestReasoning) -> GenerationOptions {
    GenerationOptions(temperature: temperatureFor(reasoning))
}

// POST one prompt to `fm serve` (PCC) and return the completion text. Throws on
// any transport / HTTP / empty-content failure so the caller can fall back.
func pccServeRespond(_ prompt: String, temperature: Double) async throws -> String {
    struct Req: Encodable { let model: String; let temperature: Double; let stream: Bool; let messages: [[String: String]] }
    let body = Req(model: "pcc", temperature: temperature, stream: false,
                   messages: [["role": "user", "content": prompt]])
    var r = URLRequest(url: URL(string: FM_SERVE_URL)!)
    r.httpMethod = "POST"
    r.setValue("application/json", forHTTPHeaderField: "Content-Type")
    r.httpBody = try JSONEncoder().encode(body)
    r.timeoutInterval = 180
    let (data, resp) = try await URLSession.shared.data(for: r)
    guard let http = resp as? HTTPURLResponse, http.statusCode == 200 else {
        throw NSError(domain: "fmserve", code: 1,
                      userInfo: [NSLocalizedDescriptionKey: "fm serve HTTP \((resp as? HTTPURLResponse)?.statusCode ?? -1)"])
    }
    struct Resp: Decodable {
        struct Choice: Decodable { struct Msg: Decodable { let content: String }; let message: Msg }
        let choices: [Choice]
    }
    let decoded = try JSONDecoder().decode(Resp.self, from: data)
    guard let content = decoded.choices.first?.message.content, !content.isEmpty else {
        throw NSError(domain: "fmserve", code: 2, userInfo: [NSLocalizedDescriptionKey: "fm serve empty content"])
    }
    return content
}

// Single entry point that replaces the old two-liner
//   `let session = LanguageModelSession(); let r = try await session.respond(to: prompt)`
// at every call site. Prefers PCC (via fm serve) for prose, and falls back to a
// one-shot on-device request if PCC is unreachable / errors so the digest still
// ships. Each engine path self-gates — PCC through PCCGate (wide, cloud-bound),
// on-device through AIGate (narrow, memory-bound) — so the whole pipeline of
// per-ticker / per-window summaries runs in parallel up to those caps.
func aiRespond(_ prompt: String, reasoning: DigestReasoning = .deep, preferPCCServe: Bool = true) async throws -> String {
    try await aiRespondUngated(prompt, reasoning: reasoning, preferPCCServe: preferPCCServe)
}

func aiRespondUngated(_ prompt: String, reasoning: DigestReasoning, preferPCCServe: Bool = true) async throws -> String {
    // Primary path: PCC via fm serve (the better model), gated by PCCGate. One
    // failed attempt hands the slot back, logs, and degrades this single call to
    // on-device rather than failing the run.
    if preferPCCServe && SUMMARY_USES_PCC {
        await PCCGate.shared.acquire()
        do {
            let out = try await pccServeRespond(prompt, temperature: temperatureFor(reasoning))
            await PCCGate.shared.release()
            return out
        } catch {
            await PCCGate.shared.release()
            if BACKFILL_STRICT_PCC {
                await PCCFailureTracker.shared.record()
                throw error            // no on-device fallback during backfill — don't poison the cache
            }
            logErr("PCC via fm serve failed (\(error.localizedDescription)) — falling back to on-device for this call")
        }
    }
    // Fallback path: in-process model, gated by AIGate (the 8 GB memory cap).
    // AI_ENGINE is on-device from the CLI (PCC is entitlement-gated in-process);
    // the inner PCC→on-device retry only fires in the rare case AI_ENGINE
    // actually resolved to in-process PCC.
    await AIGate.shared.acquire()
    let engine = AI_ENGINE
    let options = generationOptions(for: reasoning)
    do {
        let response = try await engine.newSession().respond(
            to: prompt,
            options: options,
            contextOptions: engine.contextOptions(for: reasoning)
        )
        await AIGate.shared.release()
        return response.content
    } catch {
        guard engine.kind == .privateCloudCompute else { await AIGate.shared.release(); throw error }
        logErr("in-process PCC request failed mid-run (\(error.localizedDescription)) — falling back to on-device for this call")
        do {
            let response = try await LanguageModelSession().respond(to: prompt, options: options)
            await AIGate.shared.release()
            return response.content
        } catch {
            await AIGate.shared.release()
            throw error
        }
    }
}

// Structured-output sibling of aiRespond. Same AIGate slot + engine selection +
// temperature + PCC→on-device fallback, but constrains the model to a
// GenerationSchema so callers get typed fields back instead of parsing
// free-text JSON. Caller reads properties via `.value(_:forProperty:)`.
func aiRespondStructured(_ prompt: String, schema: GenerationSchema, reasoning: DigestReasoning = .standard) async throws -> GeneratedContent {
    await AIGate.shared.acquire()
    do {
        let out = try await aiRespondStructuredUngated(prompt, schema: schema, reasoning: reasoning)
        await AIGate.shared.release()
        return out
    } catch {
        await AIGate.shared.release()
        throw error
    }
}

func aiRespondStructuredUngated(_ prompt: String, schema: GenerationSchema, reasoning: DigestReasoning) async throws -> GeneratedContent {
    let engine = AI_ENGINE
    let options = generationOptions(for: reasoning)
    // Force includeSchemaInPrompt=true (the field defaults to nil) so the small
    // on-device model still sees the field layout; preserve the engine's
    // reasoningLevel (nil on-device, set on PCC).
    let base = engine.contextOptions(for: reasoning)
    let ctx = ContextOptions(includeSchemaInPrompt: true, reasoningLevel: base.reasoningLevel)
    do {
        return try await engine.newSession().respond(
            to: prompt,
            schema: schema,
            options: options,
            contextOptions: ctx
        ).content
    } catch {
        guard engine.kind == .privateCloudCompute else { throw error }
        logErr("PCC structured request failed mid-run (\(error.localizedDescription)) — falling back to on-device for this call")
        return try await LanguageModelSession().respond(to: prompt, schema: schema, options: options).content
    }
}

// Runs `body` over `items` with at most `limit` tasks live at once, preserving
// input order in the result. Used to fan out the per-ticker / per-portfolio /
// per-fund phases that used to be serial for-loops. AIGate (above) is the real
// inference throttle; bounding task creation here too just caps how many items'
// working sets (article arrays, prompts) sit in memory simultaneously. Falls
// back to a plain serial pass when limit==1 or there's nothing to overlap.
func mapConcurrent<T: Sendable, R: Sendable>(
    _ items: [T], limit: Int, _ body: @Sendable @escaping (T) async -> R
) async -> [R] {
    if limit <= 1 || items.count <= 1 {
        var out: [R] = []
        out.reserveCapacity(items.count)
        for it in items { out.append(await body(it)) }
        return out
    }
    var results = [R?](repeating: nil, count: items.count)
    await withTaskGroup(of: (Int, R).self) { group in
        var next = 0
        let prime = min(limit, items.count)
        while next < prime {
            let i = next, it = items[i]
            group.addTask { (i, await body(it)) }
            next += 1
        }
        for await (i, r) in group {
            results[i] = r
            if next < items.count {
                let j = next, it = items[j]
                group.addTask { (j, await body(it)) }
                next += 1
            }
        }
    }
    return results.map { $0! }
}

// MARK: - Stage 2 AI relevance scoring

struct AIScore { let score: Int; let reason: String }

// Schema for the relevance scorer's structured output. Built once at startup.
// Constraining the model to {score, reason} means we read typed fields back via
// `.value(_:forProperty:)` instead of brace-matching free-text JSON. `try?` so a
// schema-build failure degrades to the parseScoreJSON text path below rather
// than crashing the run.
let RELEVANCE_SCHEMA: GenerationSchema? = {
    let score = DynamicGenerationSchema.Property(
        name: "score", description: "Investor relevance, an integer from 1 to 10",
        schema: DynamicGenerationSchema(type: Int.self))
    let reason = DynamicGenerationSchema.Property(
        name: "reason", description: "One sentence explaining the score",
        schema: DynamicGenerationSchema(type: String.self))
    let root = DynamicGenerationSchema(
        name: "ArticleRelevance",
        description: "Relevance assessment for one financial news article",
        properties: [score, reason])
    return try? GenerationSchema(root: root, dependencies: [])
}()

func scoreArticleAI(_ article: Article, ticker: String) async -> AIScore? {
    let title = article.title
    let desc = String(article.description.prefix(DESC_TRUNCATE))
    // Shared criteria — used verbatim by the structured path; the text-fallback
    // path appends the JSON-format instruction.
    let criteria = """
    You are a financial news filter for an investor tracking \(ticker) stock.

    Score this article's investor relevance from 1 to 10.
    8-10: Earnings, revenue, M&A, regulatory decisions, executive leadership changes, analyst ratings, product launches with revenue impact, material legal matters affecting the company.
    5-7: Industry trends, competitive developments, macro factors directly affecting this company.
    1-4: Individual employee misconduct, local store openings, charity, sponsorship, lifestyle content, tangentially related stories.

    Article title: \(title)
    Article description: \(desc)
    """

    // Preferred: schema-constrained structured output — no free-text JSON to parse.
    if let schema = RELEVANCE_SCHEMA {
        do {
            let gc = try await aiRespondStructured(criteria, schema: schema, reasoning: .standard)
            let score = try gc.value(Int.self, forProperty: "score")
            if score >= 1 && score <= 10 {
                let reason = (try? gc.value(String.self, forProperty: "reason")) ?? ""
                return AIScore(score: score, reason: reason)
            }
            // Out-of-range → fall through and let the text path take a second pass.
        } catch {
            logErr("scoreArticleAI structured path failed for \(ticker) (\(error.localizedDescription)) — retrying via text+parse")
        }
    }

    // Fallback: ask for JSON in the prompt and parse it (pre-structured behavior).
    // preferPCCServe:false keeps scoring on-device — it's a high-volume,
    // deterministic per-article filter, not a summary, so it doesn't go to PCC.
    let textPrompt = criteria + "\n\nReply with JSON only, no other text:\n{\"score\": <integer 1-10>, \"reason\": \"<one sentence explaining why>\"}"
    do {
        let content = try await aiRespond(textPrompt, reasoning: .standard, preferPCCServe: false)
        return parseScoreJSON(content)
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

// MARK: - Hierarchical summaries (Phase 2)
//
// To keep window-digest prompts under Apple Intelligence's context window
// (and to give the model a higher-signal input than 30-100 raw articles for
// long windows), we summarize in layers:
//
//   Layer 0  raw articles            ~/StockDigests/articles/{T}/{YYYY-MM-DD}.json
//   Layer 1  daily summary           ~/StockDigests/summaries/{T}/daily/{YYYY-MM-DD}.json
//   Layer 2  weekly summary          ~/StockDigests/summaries/{T}/weekly/{YYYY-MM-DD}.json   (Monday of week)
//   Layer 3  monthly summary         ~/StockDigests/summaries/{T}/monthly/{YYYY-MM}.json
//
// Each summary is generated once for a completed period and cached forever —
// historical periods don't change, so re-reading from disk on later runs
// costs nothing. The chain composes: daily → weekly → monthly → window
// digest. Window digests for 1W use 7 daily summaries; 1M uses 4 weekly;
// 3M uses 13 weekly OR 3 monthly; 1Y/ALL uses monthly. Each AI call has
// bounded, small input (≤ 2 K chars) so no call can blow the context window
// no matter how newsy the period was.

struct DailySummary: Codable {
    let ticker: String
    let date: String          // YYYY-MM-DD
    let summary: String
    let generatedAt: String
    let sourceArticleCount: Int
    let aiEngine: String?
}

struct WeeklySummary: Codable {
    let ticker: String
    let weekStartMonday: String   // YYYY-MM-DD of the Monday
    let summary: String
    let generatedAt: String
    let sourceDailyCount: Int
    let aiEngine: String?
}

struct MonthlySummary: Codable {
    let ticker: String
    let yearMonth: String         // YYYY-MM
    let summary: String
    let generatedAt: String
    let sourceWeeklyCount: Int
    let aiEngine: String?
}

let SUMMARIES_DIR = ARCHIVE_DIR.appendingPathComponent("summaries")

func summaryDirFor(_ ticker: String, layer: String) -> URL {
    SUMMARIES_DIR.appendingPathComponent(ticker).appendingPathComponent(layer)
}

func dailySummaryFile(_ ticker: String, date: String) -> URL {
    summaryDirFor(ticker, layer: "daily").appendingPathComponent("\(date).json")
}

func weeklySummaryFile(_ ticker: String, weekStartMonday: String) -> URL {
    summaryDirFor(ticker, layer: "weekly").appendingPathComponent("\(weekStartMonday).json")
}

func monthlySummaryFile(_ ticker: String, yearMonth: String) -> URL {
    summaryDirFor(ticker, layer: "monthly").appendingPathComponent("\(yearMonth).json")
}

func loadDailySummary(_ ticker: String, date: String) -> DailySummary? {
    let url = dailySummaryFile(ticker, date: date)
    guard let data = try? Data(contentsOf: url) else { return nil }
    return try? JSONDecoder().decode(DailySummary.self, from: data)
}

func loadWeeklySummary(_ ticker: String, weekStartMonday: String) -> WeeklySummary? {
    let url = weeklySummaryFile(ticker, weekStartMonday: weekStartMonday)
    guard let data = try? Data(contentsOf: url) else { return nil }
    return try? JSONDecoder().decode(WeeklySummary.self, from: data)
}

func loadMonthlySummary(_ ticker: String, yearMonth: String) -> MonthlySummary? {
    let url = monthlySummaryFile(ticker, yearMonth: yearMonth)
    guard let data = try? Data(contentsOf: url) else { return nil }
    return try? JSONDecoder().decode(MonthlySummary.self, from: data)
}

func writeSummary<T: Codable>(_ s: T, to url: URL) throws {
    try FileManager.default.createDirectory(
        at: url.deletingLastPathComponent(),
        withIntermediateDirectories: true
    )
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    let data = try encoder.encode(s)
    try data.write(to: url)
}

// MARK: - Per-day fact extraction (Phase 4)
//
// One intermediate layer beneath the daily summary. After Stage-2 scoring
// keeps the day's top articles, a single AI call extracts atomic facts —
// one sentence each, tagged by event type (earnings, M&A, analyst, etc.)
// — and we persist them as `facts/<TICKER>/<DATE>.json`. The daily summary
// prompt then consumes facts instead of raw articles, so:
//   - Cross-day dedup is a string-similarity check on the fact list rather
//     than another AI pass.
//   - The daily summary becomes a paraphrase-of-structured-input instead
//     of a fresh distillation, which keeps signal tighter.
//   - Facts are inspectable in isolation (handy when a digest goes weird —
//     you can see whether the AI hallucinated or just paraphrased loosely).
//
// One extra AI call per ticker per day; the chunked schedule absorbs the
// wallclock easily.

let FACTS_DIR = ARCHIVE_DIR.appendingPathComponent("facts")

let FACT_TAGS: Set<String> = [
    "EARNINGS", "MNA", "ANALYST", "PRODUCT",
    "REGULATORY", "GUIDANCE", "EXEC", "MACRO", "OTHER",
]

struct Fact: Codable {
    let tag: String              // one of FACT_TAGS
    let sentence: String         // one-sentence statement of the event
    let sourceLink: String?      // first cited article's URL, if mappable
    let score: Int?              // relevanceScore of the source article (for sorting/debugging)
}

struct DailyFacts: Codable {
    let ticker: String
    let date: String             // YYYY-MM-DD (ET)
    let generatedAt: String
    let facts: [Fact]
    let sourceArticleCount: Int
    let aiEngine: String?
}

func factsFile(_ ticker: String, date: String) -> URL {
    FACTS_DIR.appendingPathComponent(ticker).appendingPathComponent("\(date).json")
}

func loadDailyFacts(_ ticker: String, date: String) -> DailyFacts? {
    let url = factsFile(ticker, date: date)
    guard let data = try? Data(contentsOf: url) else { return nil }
    return try? JSONDecoder().decode(DailyFacts.self, from: data)
}

// Load the last N days of facts ending the day BEFORE `date`. Used to dedup
// today's freshly-extracted facts against recent history so the daily
// digest doesn't read "Apple beat earnings" three days in a row.
func loadRecentFacts(_ ticker: String, before date: String, days: Int) -> [Fact] {
    guard let endDay = parseDay(date) else { return [] }
    var all: [Fact] = []
    for offset in 1...days {
        guard let d = nyCalendar.date(byAdding: .day, value: -offset, to: endDay) else { continue }
        let key = dayFormatter.string(from: d)
        if let df = loadDailyFacts(ticker, date: key) {
            all.append(contentsOf: df.facts)
        }
    }
    return all
}

// --- Facts extraction prompt + parser ------------------------------------

let FACT_DESC_TRUNCATE = 360         // tighter than the daily-summary prompt
let FACTS_ARTICLE_CAP = 20           // fact extractor sees the top-scored slice
let FACTS_MAX_OUT = 6                // bound on extracted facts per day per ticker

func buildFactsExtractionPrompt(ticker: String, name: String, date: String, articles: [Article]) -> String {
    let top = articles
        .sorted { ($0.relevanceScore ?? 0) > ($1.relevanceScore ?? 0) }
        .prefix(FACTS_ARTICLE_CAP)
    var lines = ""
    for (i, a) in top.enumerated() {
        let desc = String(a.description.prefix(FACT_DESC_TRUNCATE))
        lines += "\(i + 1). \(a.title)\n\(desc)\n\n"
    }
    return """
    Extract atomic business facts about \(ticker) (\(name)) from the articles below, for date \(date). Each fact = ONE specific event with a concrete who/what/when.

    Tag every fact with ONE of these labels:
      EARNINGS    — quarterly results, revenue/EPS prints
      MNA         — mergers, acquisitions, divestitures
      ANALYST     — upgrades, downgrades, price-target moves, initiations
      PRODUCT     — launches, recalls, major feature ships, contracts won
      REGULATORY  — FDA, FTC, SEC actions; lawsuits; antitrust
      GUIDANCE    — forward guidance changes, raised/lowered outlook
      EXEC        — CEO/CFO/board changes, key hires/departures
      MACRO       — sector-wide moves that materially hit this name
      OTHER       — material business news that doesn't fit above

    Rules:
    - One sentence per fact. State the event concretely ("Apple reported Q2 EPS of $1.65 vs. $1.50 consensus"), not vaguely ("Apple had earnings").
    - Cite the source article with its number in brackets at the end of the sentence: [N]. If multiple articles cover the same event, write ONE fact and cite all: [N][M].
    - Skip non-material news: store openings, charity, employee features, generic market commentary.
    - Maximum \(FACTS_MAX_OUT) facts. Pick the highest-signal events if there are more.
    - If there is no material news today, write the single line: NONE: No material business news today.

    Output format — exactly one fact per line, no preface, no numbering, no bullets:
    TAG: One-sentence statement of the event. [N]

    Articles:
    \(lines)
    """
}

private let FACT_LINE_RE = try? NSRegularExpression(
    pattern: #"^([A-Z]{3,12}):\s+(.+?)(?:\s*((?:\[\d+\])+))?\s*$"#,
    options: [.anchorsMatchLines]
)

func parseFactsResponse(_ raw: String, articles: [Article]) -> [Fact] {
    guard let regex = FACT_LINE_RE else { return [] }
    // Build an article-index → (link, score) lookup keyed to the order the
    // prompt presented them in (top-score-first slice).
    let top = articles
        .sorted { ($0.relevanceScore ?? 0) > ($1.relevanceScore ?? 0) }
        .prefix(FACTS_ARTICLE_CAP)
    let articleByIndex: [Int: Article] = Dictionary(
        uniqueKeysWithValues: top.enumerated().map { (i, a) in (i + 1, a) }
    )

    var out: [Fact] = []
    let ns = raw as NSString
    let matches = regex.matches(in: raw, range: NSRange(location: 0, length: ns.length))
    for m in matches {
        let tagRange = m.range(at: 1)
        let sentRange = m.range(at: 2)
        guard tagRange.location != NSNotFound, sentRange.location != NSNotFound else { continue }
        let tagRaw = ns.substring(with: tagRange).uppercased()
        var tag = tagRaw
        if tagRaw == "NONE" { continue }              // sentinel for "no news"
        if !FACT_TAGS.contains(tag) { tag = "OTHER" } // be forgiving on unknown tags
        let sentence = ns.substring(with: sentRange).trimmingCharacters(in: .whitespaces)
        if sentence.isEmpty { continue }

        // Citations: parse [N] or [N][M] etc.
        var sourceLink: String? = nil
        var score: Int? = nil
        if m.numberOfRanges > 3, m.range(at: 3).location != NSNotFound {
            let citationBlob = ns.substring(with: m.range(at: 3))
            let digitsRegex = try? NSRegularExpression(pattern: #"\d+"#)
            let citationNS = citationBlob as NSString
            if let r = digitsRegex {
                let dMatches = r.matches(in: citationBlob, range: NSRange(location: 0, length: citationNS.length))
                if let firstMatch = dMatches.first {
                    let idx = Int(citationNS.substring(with: firstMatch.range)) ?? 0
                    if let a = articleByIndex[idx] {
                        sourceLink = a.link
                        score = a.relevanceScore
                    }
                }
            }
        }
        out.append(Fact(tag: tag, sentence: sentence, sourceLink: sourceLink, score: score))
        if out.count >= FACTS_MAX_OUT { break }
    }
    return out
}

// Jaccard similarity on lowercased non-trivial tokens. Drops common stop-words
// and short tokens so "the", "a", "of" don't dominate. Threshold 0.5 catches
// near-duplicates without being so strict that legitimate followups ("Apple
// reported earnings" → "Apple's earnings call raised…") get flagged.
let STOPWORDS: Set<String> = [
    "the", "a", "an", "and", "or", "but", "of", "in", "on", "at", "to", "for",
    "with", "from", "by", "as", "is", "was", "were", "be", "been", "being",
    "are", "this", "that", "these", "those", "it", "its", "he", "she", "they",
    "their", "his", "her", "has", "have", "had", "will", "would", "could",
    "should", "may", "might", "can", "than", "then", "also", "after", "before",
    "into", "over", "under", "about", "more", "less", "today", "yesterday",
]

func factTokens(_ s: String) -> Set<String> {
    let lowered = s.lowercased()
    var tokens: Set<String> = []
    var current = ""
    for ch in lowered {
        if ch.isLetter || ch.isNumber {
            current.append(ch)
        } else {
            if current.count >= 3, !STOPWORDS.contains(current) {
                tokens.insert(current)
            }
            current = ""
        }
    }
    if current.count >= 3, !STOPWORDS.contains(current) {
        tokens.insert(current)
    }
    return tokens
}

func jaccard(_ a: Set<String>, _ b: Set<String>) -> Double {
    if a.isEmpty || b.isEmpty { return 0 }
    let inter = a.intersection(b).count
    let union = a.union(b).count
    return Double(inter) / Double(union)
}

func dedupFactsAgainstRecent(_ today: [Fact], recent: [Fact], threshold: Double = 0.55) -> [Fact] {
    if recent.isEmpty { return today }
    let recentTokens = recent.map { factTokens($0.sentence) }
    var kept: [Fact] = []
    for f in today {
        let ft = factTokens(f.sentence)
        var isDup = false
        for rt in recentTokens {
            if jaccard(ft, rt) >= threshold { isDup = true; break }
        }
        if !isDup { kept.append(f) }
    }
    return kept
}

func extractFactsForDay(_ ticker: String, date: String, articles: [Article]) async -> DailyFacts? {
    guard !articles.isEmpty else { return nil }
    let name = TICKER_NAMES[ticker] ?? ticker
    let prompt = buildFactsExtractionPrompt(ticker: ticker, name: name, date: date, articles: articles)
    do {
        let raw = try await aiRespond(prompt)
        let parsed = parseFactsResponse(raw, articles: articles)
        let recent = loadRecentFacts(ticker, before: date, days: 7)
        let deduped = dedupFactsAgainstRecent(parsed, recent: recent)
        let df = DailyFacts(
            ticker: ticker,
            date: date,
            generatedAt: isoFormatter.string(from: Date()),
            facts: deduped,
            sourceArticleCount: articles.count,
            aiEngine: "AppleIntelligence"
        )
        try writeSummary(df, to: factsFile(ticker, date: date))
        log("  \(ticker) facts cached for \(date): \(deduped.count) of \(parsed.count) parsed (\(parsed.count - deduped.count) dedup'd against prior 7d, from \(articles.count) articles)")
        return df
    } catch {
        logErr("facts-extract error \(ticker) \(date): \(error.localizedDescription)")
        return nil
    }
}

func getOrGenerateDailyFacts(_ ticker: String, date: String, articles: [Article]) async -> DailyFacts? {
    if let cached = loadDailyFacts(ticker, date: date) { return cached }
    return await extractFactsForDay(ticker, date: date, articles: articles)
}

// MARK: - Per-ticker company brief (Phase 4)
//
// A ~4-5 sentence "what this company is, what it does, what's been driving
// it lately" file. Regenerated monthly (the cadence is right — the brief
// updates as new monthly summaries land, the company doesn't change
// week-to-week). Prepended to weekly / monthly / 3M / 1Y / ALL prompts as
// background context so the model doesn't have to infer the company from
// distilled snippets. Cheap: one AI call per ticker per month.

let BRIEFS_DIR = ARCHIVE_DIR.appendingPathComponent("briefs")

struct CompanyBrief: Codable {
    let ticker: String
    let yearMonth: String        // YYYY-MM the brief was generated for
    let generatedAt: String
    let brief: String            // 4-5 sentences
    let sourceMonthlyCount: Int
    let aiEngine: String?
}

func briefFile(_ ticker: String, yearMonth: String) -> URL {
    BRIEFS_DIR.appendingPathComponent(ticker).appendingPathComponent("\(yearMonth).json")
}

func loadCompanyBrief(_ ticker: String, yearMonth: String) -> CompanyBrief? {
    let url = briefFile(ticker, yearMonth: yearMonth)
    guard let data = try? Data(contentsOf: url) else { return nil }
    return try? JSONDecoder().decode(CompanyBrief.self, from: data)
}

// Latest available brief, walking back from `yearMonth` up to 12 months. Used
// by the long-window digest prompts so they get *some* context even before
// this month's brief has been generated.
func latestCompanyBrief(_ ticker: String, asOf yearMonth: String) -> CompanyBrief? {
    let parts = yearMonth.split(separator: "-")
    guard parts.count == 2, let y = Int(parts[0]), let m = Int(parts[1]) else { return nil }
    var year = y
    var month = m
    for _ in 0..<12 {
        let key = String(format: "%04d-%02d", year, month)
        if let b = loadCompanyBrief(ticker, yearMonth: key) { return b }
        month -= 1
        if month == 0 { month = 12; year -= 1 }
    }
    return nil
}

func buildCompanyBriefPrompt(ticker: String, name: String, yearMonth: String, monthlies: [MonthlySummary]) -> String {
    var lines = ""
    for ms in monthlies {
        lines += "\(ms.yearMonth): \(ms.summary)\n\n"
    }
    return """
    Write a concise 4-5 sentence company brief for \(ticker) (\(name)) as of \(yearMonth): what the company does and where it sits competitively, the dominant narrative driving the stock over the past several months (from the summaries below), and the most important catalyst or risk from here. Be specific — name actual products, competitors, and catalysts. Plain prose, one paragraph.

    Recent monthly summaries (oldest first):
    \(lines)
    """
}

func generateAndCacheCompanyBrief(_ ticker: String, yearMonth: String, monthlies: [MonthlySummary]) async -> CompanyBrief? {
    guard !monthlies.isEmpty else { return nil }
    let name = TICKER_NAMES[ticker] ?? ticker
    let prompt = buildCompanyBriefPrompt(ticker: ticker, name: name, yearMonth: yearMonth, monthlies: monthlies)
    do {
        guard let text = try await runAISummary(prompt: prompt) else { return nil }
        let b = CompanyBrief(
            ticker: ticker,
            yearMonth: yearMonth,
            generatedAt: isoFormatter.string(from: Date()),
            brief: text,
            sourceMonthlyCount: monthlies.count,
            aiEngine: "AppleIntelligence"
        )
        try writeSummary(b, to: briefFile(ticker, yearMonth: yearMonth))
        log("  \(ticker) company brief cached for \(yearMonth) (\(monthlies.count) monthly summaries)")
        return b
    } catch {
        logErr("brief-generate error \(ticker) \(yearMonth): \(error.localizedDescription)")
        return nil
    }
}

// --- Date helpers for summary layer keys ---------------------------------
// All summary keys are anchored to America/New_York to match the rest of
// the pipeline (intradayDate, trading-date logic, etc.). Using ET means the
// daily summary for "2026-05-13" covers everything Yahoo published on the
// ET calendar day, matching how the user thinks about market days.

private let nyCalendar: Calendar = {
    var cal = Calendar(identifier: .gregorian)
    cal.timeZone = TimeZone(identifier: "America/New_York") ?? TimeZone(identifier: "UTC")!
    return cal
}()

func mondayOfWeekFor(_ date: Date) -> Date {
    // Gregorian weekday: 1=Sunday, 2=Monday, ..., 7=Saturday. Walk back to
    // the most recent Monday at midnight ET.
    var d = nyCalendar.startOfDay(for: date)
    while nyCalendar.component(.weekday, from: d) != 2 {
        d = nyCalendar.date(byAdding: .day, value: -1, to: d)!
    }
    return d
}

func mondayKey(_ date: Date) -> String {
    dayFormatter.string(from: mondayOfWeekFor(date))
}

func yearMonthKey(_ date: Date) -> String {
    let comps = nyCalendar.dateComponents([.year, .month], from: date)
    return String(format: "%04d-%02d", comps.year ?? 0, comps.month ?? 0)
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

// Per-window article caps. Every window now caps; the older "1D/1W return
// everything" path hit Apple Intelligence's context window for newsy
// tickers (100+ Yahoo articles for AMZN/AAPL in a week → 12K+ tokens →
// "Exceeded model context window size"). Caps are tuned so 15 × 300-char
// description × ~480 chars per article × prompt template stays under
// ~2.5K tokens for every window.
let ARTICLES_PER_WINDOW_CAP: [WindowKey: Int] = [
    .d1: 15,
    .w1: 15,
    .m1: 20,
    .m3: 25,
    .y1: 24,
    .all: 25,
]

func articlesForWindow(ticker: String, window: WindowKey, gameAge: Int) -> [Article] {
    let articles = loadArticlesInLastNDays(ticker: ticker, days: window.newsLookback(gameAge: gameAge))
    let cap = ARTICLES_PER_WINDOW_CAP[window] ?? 15
    // Sort by relevance score (highest first), then keep the top N. Articles
    // without a score sink to the bottom; they'll only be picked if the
    // window is very article-light.
    let sorted = articles.sorted { ($0.relevanceScore ?? 0) > ($1.relevanceScore ?? 0) }
    return Array(sorted.prefix(cap))
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
        // Tag each headline with how recent it is so the model can tell fresh
        // news from a catalyst the stock is still reacting to days later.
        let recency = articleRecencyPhrase(a)
        let recencyTag = recency.isEmpty ? "" : " [\(recency)]"
        articleText += "\(i + 1).\(recencyTag) \(a.title)\n\(desc)\n\n"
    }
    // Templated short windows (1D/1W/1M) get their live pct injected after
    // generation, so the model must name the ticker symbol and write no numbers.
    let numbersNote = TEMPLATED_HOLDING_WINDOWS.contains(window)
        ? " Mention the ticker symbol \(ticker); don't include any percentages or numbers in the prose."
        : ""
    // 1D widened its news lookback to the last few days (see newsLookback), so
    // a headline here may be a still-driving catalyst from earlier in the week
    // rather than fresh news — tell the model to frame it that way.
    let recencyNote = window == .d1
        ? " A headline tagged \"reported yesterday\" / \"reported N days ago\" is news the stock is STILL reacting to — say it's still riding that, not that it happened today. Only a headline tagged \"reported today\" is fresh."
        : ""
    let framing: String
    switch window {
    case .d1:
        framing = "what's driving \(ticker) (\(name)) right now — the latest catalyst still moving it (which may be from the past few days if the stock is still reacting to it) and why it matters"
    case .w1:
        framing = "the week's dominant story for \(ticker) (\(name)) and what to watch heading into next week"
    case .m1:
        let scope = gameAge < 30 ? "since the game's start on February 5, 2026 (\(gameAge) days ago)" : "over the past month"
        framing = "the defining theme for \(ticker) (\(name)) \(scope), the biggest catalyst or risk that emerged, and where it stands now"
    case .m3:
        let scope = gameAge < 90 ? "since the game's start on February 5, 2026 (\(gameAge) days ago)" : "over the past quarter"
        framing = "the defining theme for \(ticker) (\(name)) \(scope), the major risks or opportunities that emerged, and how the investment thesis has evolved"
    case .y1:
        let scope = gameAge < 365 ? "since the game's start on February 5, 2026 (\(gameAge) days ago)" : "over the past year"
        framing = "the most important storyline for \(ticker) (\(name)) \(scope), how its competitive position or trajectory changed, and the long-term outlook"
    case .all:
        framing = "the defining arc for \(ticker) (\(name)) since February 5, 2026 (\(gameAge) days ago), how the original thesis has held up or been challenged, and the outlook from here"
    }
    return """
    You're writing a short briefing for an investor holding \(ticker) (\(name)). The articles below are pre-filtered for investor relevance.

    In two or three short sentences of plain prose, in your own words (don't quote or paste the article text), cover \(framing). Be concrete — cite the actual events, skip filler. Output only the briefing — no notes about yourself or how it was generated.\(numbersNote)\(recencyNote)

    Articles:
    \(articleText)
    """
}

// MARK: - Intermediate summary prompts + generators (Phase 2)

// Cap + tighter truncation for the daily-summary prompt. Originally
// uncapped, this path was the last remaining context-window risk: very
// newsy days for popular tickers (AAPL/AMZN/TSLA with 25-30 articles)
// would push past the on-device limit and the AI call would error
// with "Exceeded model context window size". Phase 1's
// ARTICLES_PER_WINDOW_CAP covered the window-digest paths but not this
// one. The cap is generous enough that nothing material is dropped —
// it's already pre-filtered by Stage-2 relevance scoring upstream, and
// we sort by score desc so the strongest signal makes the cut.
let DAILY_SUMMARY_ARTICLE_CAP = 15
let DAILY_SUMMARY_DESC_TRUNCATE = 200

func buildDailySummaryPrompt(ticker: String, name: String, date: String, articles: [Article]) -> String {
    // Legacy article-driven path. Retained as a fallback when facts
    // extraction returned empty (no material news or extraction errored)
    // and we still want a one-line "quiet day" placeholder.
    let topArticles = articles
        .sorted { ($0.relevanceScore ?? 0) > ($1.relevanceScore ?? 0) }
        .prefix(DAILY_SUMMARY_ARTICLE_CAP)
    var lines = ""
    for (i, a) in topArticles.enumerated() {
        let desc = String(a.description.prefix(DAILY_SUMMARY_DESC_TRUNCATE))
        lines += "\(i + 1). \(a.title)\n\(desc)\n\n"
    }
    let totalNote = articles.count > DAILY_SUMMARY_ARTICLE_CAP
        ? " (top \(DAILY_SUMMARY_ARTICLE_CAP) by relevance out of \(articles.count) archived)"
        : ""
    return """
    Summarize the day's business news for \(ticker) (\(name)), \(date) — \(min(articles.count, DAILY_SUMMARY_ARTICLE_CAP)) article(s) below\(totalNote).

    In 2-3 sentences, capture the day's key developments, focusing on concrete events (earnings, guidance, M&A, regulatory actions, launches, executive or analyst moves). If there's no material business news, just say the day was quiet for this ticker. Plain prose, one paragraph.

    Articles:
    \(lines)
    """
}

func buildDailySummaryFromFactsPrompt(
    ticker: String,
    name: String,
    date: String,
    facts: [Fact],
    yesterdaySummary: String?
) -> String {
    var factLines = ""
    for f in facts {
        factLines += "- [\(f.tag)] \(f.sentence)\n"
    }
    let yesterdayBlock: String = {
        guard let y = yesterdaySummary, !y.isEmpty else { return "" }
        return """

        Yesterday's takeaway (for context — do NOT restate it):
        \(y)

        """
    }()
    return """
    Write a 2-3 sentence daily summary for \(ticker) (\(name)) on \(date), synthesizing today's facts below into plain prose. Lead with the highest-signal event and combine facts that share a theme.
    \(yesterdayBlock)
    Today's facts (already deduped against the prior 7 days):
    \(factLines)
    If today extends yesterday's narrative you can note that briefly, but don't restate yesterday's events. Plain prose, one paragraph.
    """
}

func buildWeeklySummaryPrompt(ticker: String, name: String, weekStartMonday: String, weekEndSunday: String, dailies: [DailySummary]) -> String {
    var lines = ""
    for d in dailies {
        lines += "\(d.date): \(d.summary)\n\n"
    }
    return """
    Summarize the week of business news for \(ticker) (\(name)), \(weekStartMonday) through \(weekEndSunday), from the daily summaries below.

    In 3-4 sentences, capture the week's most important storylines — what changed, what was confirmed, what's new — as themes that span the week, not a day-by-day list. Plain prose, one paragraph.

    Daily summaries:
    \(lines)
    """
}

func buildMonthlySummaryPrompt(ticker: String, name: String, yearMonth: String, weeklies: [WeeklySummary]) -> String {
    var lines = ""
    for w in weeklies {
        lines += "Week of \(w.weekStartMonday): \(w.summary)\n\n"
    }
    return """
    Summarize the month of business news for \(ticker) (\(name)), \(yearMonth), from the weekly summaries below.

    In 4-5 sentences, capture the month's key narratives — what trajectories developed, what themes emerged, what catalysts mattered most — synthesized across the weeks, not a week-by-week list. Plain prose, one paragraph.

    Weekly summaries:
    \(lines)
    """
}

func runAISummary(prompt: String) async throws -> String? {
    let text = cleanDigestProse(try await aiRespond(prompt))
    return text.isEmpty ? nil : text
}

func generateAndCacheDailySummary(_ ticker: String, date: String, articles: [Article]) async -> DailySummary? {
    guard !articles.isEmpty else { return nil }
    let name = TICKER_NAMES[ticker] ?? ticker

    // 1) Ensure facts are extracted (one AI call) + cross-day deduped. This
    //    is the new primary intermediate — the daily summary used to read
    //    raw articles; now it reads structured facts. The articles path
    //    survives as a fallback below for the case where extraction returns
    //    empty (transient extractor error or genuinely quiet day).
    let facts = await getOrGenerateDailyFacts(ticker, date: date, articles: articles)

    // 2) Yesterday's daily summary, for narrative continuity. Walk back up
    //    to 5 days to skip weekends / quiet days where no summary was
    //    written. Capped at 5 so a stale "yesterday" doesn't leak into
    //    today's framing.
    let yesterdaySummary: String? = {
        guard let endDay = parseDay(date) else { return nil }
        for offset in 1...5 {
            guard let d = nyCalendar.date(byAdding: .day, value: -offset, to: endDay) else { continue }
            let key = dayFormatter.string(from: d)
            if let s = loadDailySummary(ticker, date: key) { return s.summary }
        }
        return nil
    }()

    // 3) Pick the prompt: facts path if we got non-empty facts, otherwise
    //    fall back to the legacy article-driven prompt so a "quiet day"
    //    still produces the existing one-line placeholder.
    let prompt: String
    let factCount: Int
    if let f = facts, !f.facts.isEmpty {
        prompt = buildDailySummaryFromFactsPrompt(
            ticker: ticker, name: name, date: date,
            facts: f.facts, yesterdaySummary: yesterdaySummary
        )
        factCount = f.facts.count
    } else {
        prompt = buildDailySummaryPrompt(ticker: ticker, name: name, date: date, articles: articles)
        factCount = 0
    }
    do {
        guard let text = try await runAISummary(prompt: prompt) else { return nil }
        let s = DailySummary(
            ticker: ticker, date: date, summary: text,
            generatedAt: isoFormatter.string(from: Date()),
            sourceArticleCount: articles.count,
            aiEngine: "AppleIntelligence"
        )
        try writeSummary(s, to: dailySummaryFile(ticker, date: date))
        log("  \(ticker) daily summary cached for \(date) (\(factCount) facts, \(articles.count) articles, yesterday=\(yesterdaySummary != nil ? "yes" : "no"))")
        return s
    } catch {
        logErr("daily-summary error \(ticker) \(date): \(error.localizedDescription)")
        return nil
    }
}

func generateAndCacheWeeklySummary(_ ticker: String, weekStartMonday: String, dailies: [DailySummary]) async -> WeeklySummary? {
    guard !dailies.isEmpty else { return nil }
    let name = TICKER_NAMES[ticker] ?? ticker
    // End-of-week = Monday + 6 days, formatted as YYYY-MM-DD
    let weekEndSunday: String = {
        guard let monday = parseDay(weekStartMonday),
              let sunday = nyCalendar.date(byAdding: .day, value: 6, to: monday) else {
            return weekStartMonday
        }
        return dayFormatter.string(from: sunday)
    }()
    let prompt = buildWeeklySummaryPrompt(
        ticker: ticker, name: name,
        weekStartMonday: weekStartMonday, weekEndSunday: weekEndSunday,
        dailies: dailies
    )
    do {
        guard let text = try await runAISummary(prompt: prompt) else { return nil }
        let s = WeeklySummary(
            ticker: ticker, weekStartMonday: weekStartMonday, summary: text,
            generatedAt: isoFormatter.string(from: Date()),
            sourceDailyCount: dailies.count,
            aiEngine: "AppleIntelligence"
        )
        try writeSummary(s, to: weeklySummaryFile(ticker, weekStartMonday: weekStartMonday))
        log("  \(ticker) weekly summary cached for week of \(weekStartMonday) (\(dailies.count) days)")
        return s
    } catch {
        logErr("weekly-summary error \(ticker) \(weekStartMonday): \(error.localizedDescription)")
        return nil
    }
}

func generateAndCacheMonthlySummary(_ ticker: String, yearMonth: String, weeklies: [WeeklySummary]) async -> MonthlySummary? {
    guard !weeklies.isEmpty else { return nil }
    let name = TICKER_NAMES[ticker] ?? ticker
    let prompt = buildMonthlySummaryPrompt(
        ticker: ticker, name: name, yearMonth: yearMonth, weeklies: weeklies
    )
    do {
        guard let text = try await runAISummary(prompt: prompt) else { return nil }
        let s = MonthlySummary(
            ticker: ticker, yearMonth: yearMonth, summary: text,
            generatedAt: isoFormatter.string(from: Date()),
            sourceWeeklyCount: weeklies.count,
            aiEngine: "AppleIntelligence"
        )
        try writeSummary(s, to: monthlySummaryFile(ticker, yearMonth: yearMonth))
        log("  \(ticker) monthly summary cached for \(yearMonth) (\(weeklies.count) weeks)")

        // Piggyback: regenerate the per-ticker company brief on the same
        // cadence as the monthly summary. The brief uses the most recent 6
        // monthly summaries as input — including the one we just wrote —
        // and provides stable context that the 1M/3M/1Y/ALL prompts
        // prepend. Failures here never block the monthly summary itself.
        await refreshCompanyBriefIfNeeded(ticker, asOf: yearMonth)
        return s
    } catch {
        logErr("monthly-summary error \(ticker) \(yearMonth): \(error.localizedDescription)")
        return nil
    }
}

// Regenerate the brief if there isn't one for this year-month yet. The
// monthly path is the natural trigger: the brief consumes monthly summaries,
// so refreshing it right after a new monthly lands keeps the cadence aligned
// with the data. Walks back up to 6 prior monthlies for context.
func refreshCompanyBriefIfNeeded(_ ticker: String, asOf yearMonth: String) async {
    if loadCompanyBrief(ticker, yearMonth: yearMonth) != nil { return }
    let parts = yearMonth.split(separator: "-")
    guard parts.count == 2, let y = Int(parts[0]), let m = Int(parts[1]) else { return }
    var monthlies: [MonthlySummary] = []
    var year = y
    var month = m
    for _ in 0..<6 {
        let key = String(format: "%04d-%02d", year, month)
        if let ms = loadMonthlySummary(ticker, yearMonth: key) {
            monthlies.append(ms)
        }
        month -= 1
        if month == 0 { month = 12; year -= 1 }
    }
    if monthlies.isEmpty { return }
    monthlies.reverse()                     // oldest-first for the prompt
    _ = await generateAndCacheCompanyBrief(ticker, yearMonth: yearMonth, monthlies: monthlies)
}

// Cached-or-generate. These are the bread-and-butter entry points the
// window-digest builders call. Each checks the on-disk cache first; if
// missing, calls the layer below it to assemble inputs, then generates
// + caches. The chain is daily ← raw articles, weekly ← daily summaries,
// monthly ← weekly summaries.

func getOrGenerateDailySummary(_ ticker: String, date: String) async -> DailySummary? {
    if let cached = loadDailySummary(ticker, date: date) { return cached }
    let articles = loadArchivedDay(ticker, day: date)
    return await generateAndCacheDailySummary(ticker, date: date, articles: articles)
}

func getOrGenerateWeeklySummary(_ ticker: String, weekStartMonday: String) async -> WeeklySummary? {
    if let cached = loadWeeklySummary(ticker, weekStartMonday: weekStartMonday) { return cached }
    // Build the daily-summary list for Mon..Sun of this week
    guard let monday = parseDay(weekStartMonday) else { return nil }
    var dailies: [DailySummary] = []
    for offset in 0..<7 {
        guard let d = nyCalendar.date(byAdding: .day, value: offset, to: monday) else { continue }
        let dateStr = dayFormatter.string(from: d)
        if let s = await getOrGenerateDailySummary(ticker, date: dateStr) {
            dailies.append(s)
        }
    }
    return await generateAndCacheWeeklySummary(ticker, weekStartMonday: weekStartMonday, dailies: dailies)
}

func getOrGenerateMonthlySummary(_ ticker: String, yearMonth: String) async -> MonthlySummary? {
    if let cached = loadMonthlySummary(ticker, yearMonth: yearMonth) { return cached }
    // Build the weekly-summary list for every Monday that falls in this month
    let parts = yearMonth.split(separator: "-")
    guard parts.count == 2,
          let y = Int(parts[0]), let m = Int(parts[1]),
          let monthStart = nyCalendar.date(from: DateComponents(year: y, month: m, day: 1)),
          let monthEnd = nyCalendar.date(byAdding: .month, value: 1, to: monthStart)
    else { return nil }
    var weeklies: [WeeklySummary] = []
    var cursor = mondayOfWeekFor(monthStart)
    while cursor < monthEnd {
        let key = dayFormatter.string(from: cursor)
        if let s = await getOrGenerateWeeklySummary(ticker, weekStartMonday: key) {
            weeklies.append(s)
        }
        guard let next = nyCalendar.date(byAdding: .day, value: 7, to: cursor) else { break }
        cursor = next
    }
    return await generateAndCacheMonthlySummary(ticker, yearMonth: yearMonth, weeklies: weeklies)
}

// MARK: - PCC cache backfill (--scope backfill)
//
// One-time pass that regenerates the hierarchical summary cache (daily → weekly
// → monthly → company brief) on PCC, replacing summaries left over from the
// on-device era. It's deliberately conservative to stay well within PCC limits
// and to never starve the other PCC client on this Mac (the MLR moderation that
// shares the same `fm serve`):
//   • Runs the chain SEQUENTIALLY (one ticker at a time; the cascade within a
//     ticker is awaited in series), so PCC concurrency stays ~1 — far gentler
//     than the daily briefing's fan-out.
//   • STRICT PCC: a failed PCC call doesn't fall back to on-device (that would
//     poison the write-once cache); it skips the write and is retried next run.
//   • Hard-stops after BACKFILL_ABORT_AFTER (default 5) PCC failures — the
//     signal that quota is exhausted — leaving the rest of the cache untouched.
//   • Resumable: a per-ticker marker under ~/StockDigests/.backfill-done is
//     written only when a ticker completes with zero PCC failures, so a re-run
//     skips finished tickers. BACKFILL_RESET=1 clears the markers.
//   • Facts (Layer 0.5) and raw articles are left as-is, so the bulk of the
//     volume is just the summary layers. Limit to specific tickers with
//     BACKFILL_TICKERS=AAPL,MSFT.

func backfillYearMonths(_ ticker: String) -> [String] {
    let dir = archiveDirFor(ticker)
    guard let entries = try? FileManager.default.contentsOfDirectory(atPath: dir.path) else { return [] }
    var months = Set<String>()
    for e in entries where e.hasSuffix(".json") {
        let day = String(e.dropLast(5))                       // YYYY-MM-DD
        if day.count >= 7 { months.insert(String(day.prefix(7))) }   // YYYY-MM
    }
    return months.sorted()
}

func backfillClearTickerSummaries(_ ticker: String) {
    for layer in ["daily", "weekly", "monthly"] {
        try? FileManager.default.removeItem(at: summaryDirFor(ticker, layer: layer))
    }
    try? FileManager.default.removeItem(at: BRIEFS_DIR.appendingPathComponent(ticker))
}

func runBackfill() async {
    BACKFILL_STRICT_PCC = true
    let env = ProcessInfo.processInfo.environment
    let only = (env["BACKFILL_TICKERS"] ?? "")
        .split(separator: ",")
        .map { $0.trimmingCharacters(in: .whitespaces).uppercased() }
        .filter { !$0.isEmpty }
    let tickers = only.isEmpty ? DEFAULT_TICKERS : only
    let abortAfter = Int(env["BACKFILL_ABORT_AFTER"] ?? "") ?? 5

    let doneDir = ARCHIVE_DIR.appendingPathComponent(".backfill-done")
    if env["BACKFILL_RESET"] == "1" { try? FileManager.default.removeItem(at: doneDir) }
    try? FileManager.default.createDirectory(at: doneDir, withIntermediateDirectories: true)

    log("Backfill — regenerating summary chain on PCC for \(tickers.count) ticker(s), sequentially. Strict PCC (no on-device fallback); hard-stop after \(abortAfter) PCC failures. Facts + raw articles kept.")
    var done = 0, skipped = 0
    for ticker in tickers {
        let marker = doneDir.appendingPathComponent(ticker)
        if FileManager.default.fileExists(atPath: marker.path) { skipped += 1; continue }

        let failsBefore = await PCCFailureTracker.shared.count()
        // Clear only THIS ticker's cache right before rebuilding it, so an abort
        // leaves every not-yet-started ticker's existing cache intact.
        backfillClearTickerSummaries(ticker)
        let months = backfillYearMonths(ticker)
        for ym in months { _ = await getOrGenerateMonthlySummary(ticker, yearMonth: ym) }  // cascades to weekly → daily
        if let latest = months.last {
            var monthlies: [MonthlySummary] = []
            for ym in months { if let m = loadMonthlySummary(ticker, yearMonth: ym) { monthlies.append(m) } }
            _ = await generateAndCacheCompanyBrief(ticker, yearMonth: latest, monthlies: monthlies)
        }
        let totalFails = await PCCFailureTracker.shared.count()

        if totalFails == failsBefore {
            FileManager.default.createFile(atPath: marker.path, contents: Data())
            done += 1
            log("  ✓ \(ticker) backfilled (\(months.count) month(s))")
        } else {
            log("  ⚠ \(ticker): \(totalFails - failsBefore) PCC failure(s) — not marked done, will retry on re-run")
        }
        if totalFails >= abortAfter {
            logErr("Backfill HARD-STOP: \(totalFails) PCC failures (likely quota exhausted). \(done) done, \(skipped) skipped this run. Re-run `--scope backfill` later to resume where it left off.")
            return
        }
    }
    log("Backfill pass complete — \(done) ticker(s) regenerated, \(skipped) already done, \(await PCCFailureTracker.shared.count()) PCC failure(s).")
}

// Walk back N days from `endDate` (inclusive), collecting any cached or
// lazy-generated daily summaries. Used by the 1W window-digest builder.
func getRecentDailySummaries(_ ticker: String, endingAt endDate: Date, days: Int) async -> [DailySummary] {
    var out: [DailySummary] = []
    for offset in 0..<days {
        guard let d = nyCalendar.date(byAdding: .day, value: -offset, to: endDate) else { continue }
        let dateStr = dayFormatter.string(from: d)
        if let s = await getOrGenerateDailySummary(ticker, date: dateStr) {
            out.append(s)
        }
    }
    return out.reversed()      // oldest first for the prompt
}

// Walk back N weeks from `endDate`'s Monday-of-week. Used by 1M and 3M.
func getRecentWeeklySummaries(_ ticker: String, endingAt endDate: Date, weeks: Int) async -> [WeeklySummary] {
    var out: [WeeklySummary] = []
    var cursor = mondayOfWeekFor(endDate)
    for _ in 0..<weeks {
        let key = dayFormatter.string(from: cursor)
        if let s = await getOrGenerateWeeklySummary(ticker, weekStartMonday: key) {
            out.append(s)
        }
        guard let prev = nyCalendar.date(byAdding: .day, value: -7, to: cursor) else { break }
        cursor = prev
    }
    return out.reversed()
}

// Walk back N months from `endDate`'s yearMonth. Used by 1Y and ALL.
func getRecentMonthlySummaries(_ ticker: String, endingAt endDate: Date, months: Int) async -> [MonthlySummary] {
    var out: [MonthlySummary] = []
    var cursor = endDate
    for _ in 0..<months {
        let key = yearMonthKey(cursor)
        if let s = await getOrGenerateMonthlySummary(ticker, yearMonth: key) {
            out.append(s)
        }
        guard let prev = nyCalendar.date(byAdding: .month, value: -1, to: cursor) else { break }
        cursor = prev
    }
    return out.reversed()
}

// MARK: - Window-digest prompt builders (Phase 2 — operate on summaries)

func buildSummaryBackedWindowPrompt(
    ticker: String,
    window: WindowKey,
    dailies: [DailySummary],
    weeklies: [WeeklySummary],
    monthlies: [MonthlySummary],
    gameAge: Int
) -> String? {
    let name = TICKER_NAMES[ticker] ?? ticker
    // Templated short windows get their live pct injected after generation, so
    // the model must name the ticker symbol and write no numbers.
    let numbersNote = TEMPLATED_HOLDING_WINDOWS.contains(window)
        ? " Mention the ticker symbol \(ticker); don't include any percentages or numbers in the prose."
        : ""

    // Company-brief context block — the most recent rolling brief, prepended
    // to give the model a stable "what this company is + recent narrative"
    // anchor before it reads the distilled summary stream. Skipped on the 1W
    // window (already very recent) and when no brief exists yet (e.g., new
    // ticker without a monthly chain).
    let briefBlock: String = {
        guard window != .w1 else { return "" }
        let asOf = yearMonthKey(Date())
        guard let brief = latestCompanyBrief(ticker, asOf: asOf) else { return "" }
        return "Company context (as of \(brief.yearMonth)):\n\(brief.brief)\n\n"
    }()

    // Render the available material as a labeled block. The model's input
    // is always small — the longest case (1Y / ALL with 12 monthly
    // summaries) is ~3 K chars; everything else is smaller.
    func renderDailies(_ items: [DailySummary]) -> String {
        items.map { "\($0.date): \($0.summary)" }.joined(separator: "\n\n")
    }
    func renderWeeklies(_ items: [WeeklySummary]) -> String {
        items.map { "Week of \($0.weekStartMonday): \($0.summary)" }.joined(separator: "\n\n")
    }
    func renderMonthlies(_ items: [MonthlySummary]) -> String {
        items.map { "\($0.yearMonth): \($0.summary)" }.joined(separator: "\n\n")
    }

    switch window {
    case .w1:
        guard !dailies.isEmpty else { return nil }
        return """
        You're writing a 1-week briefing for an investor in \(ticker) (\(name)). The daily summaries below are already filtered to material business news.

        Daily summaries (past 7 days, oldest first):
        \(renderDailies(dailies))

        In three sentences, synthesize the week's story — the most important development, what it implies for the company, and a catalyst or risk ahead. Plain prose, one paragraph.\(numbersNote)
        """
    case .m1:
        let scope = gameAge < 30
            ? "since the game's start on February 5, 2026 (\(gameAge) days ago)"
            : "over the past month"
        let weeklyBlock = weeklies.isEmpty ? "(none yet)" : renderWeeklies(weeklies)
        let dailyBlock = dailies.isEmpty ? "" : "\n\nRecent daily summaries (current partial week):\n\(renderDailies(dailies))"
        return """
        You're writing a 1-month briefing for an investor in \(ticker) (\(name)) \(scope). The summaries below are already filtered to material business news.

        \(briefBlock)Weekly summaries (oldest first):
        \(weeklyBlock)\(dailyBlock)

        In three sentences, cover the period's defining theme, the biggest catalyst or risk that emerged, and where the stock stands now — citing actual events from the summaries. Plain prose, one paragraph.\(numbersNote)
        """
    case .m3:
        let scope = gameAge < 90
            ? "since the game's start on February 5, 2026 (\(gameAge) days ago)"
            : "over the past quarter"
        let weeklyBlock = weeklies.isEmpty ? "(none yet)" : renderWeeklies(weeklies)
        return """
        You're writing a quarterly briefing for an investor in \(ticker) (\(name)) \(scope). The weekly summaries below are already filtered to material business news.

        \(briefBlock)Weekly summaries (oldest first):
        \(weeklyBlock)

        In three sentences, cover the period's defining theme or catalyst, the major risks or opportunities that emerged, and how the investment thesis has evolved — citing actual events from the summaries. Plain prose, one paragraph.
        """
    case .y1:
        let isYoung = gameAge < 365
        let scope = isYoung
            ? "since the game's start on February 5, 2026 (\(gameAge) days ago — the whole holding period so far)"
            : "over the past 12 months"
        let monthlyBlock = monthlies.isEmpty ? "(none yet)" : renderMonthlies(monthlies)
        return """
        You're writing an annual briefing for an investor in \(ticker) (\(name)) \(scope). The monthly summaries below cover the period's most material business news.

        \(briefBlock)Monthly summaries (oldest first):
        \(monthlyBlock)

        In three sentences, cover the period's most important storyline and its market impact, how the company's competitive position or trajectory changed, and the long-term outlook. Plain prose, one paragraph.
        """
    case .all:
        let monthlyBlock = monthlies.isEmpty ? "(none yet)" : renderMonthlies(monthlies)
        return """
        You're writing a since-inception summary for an investor in \(ticker) (\(name)) since February 5, 2026 — the start of tracking (\(gameAge) days ago). The monthly summaries below cover the period's most material business news.

        \(briefBlock)Monthly summaries (oldest first):
        \(monthlyBlock)

        In three sentences, cover the defining arc since February 5, 2026 (biggest catalysts, pivots, regime changes), how the original thesis has held up or been challenged, and the outlook from here. Plain prose, one paragraph.
        """
    case .d1:
        // 1D continues to use raw articles directly — small input, the user
        // wants fine-grained "today" detail rather than a pre-summarized
        // condensed take. Falls through to the legacy buildDigestPrompt
        // path via generateDigestText's dispatcher.
        return nil
    }
}

// Master dispatcher. 1D still uses raw articles; everything else uses the
// hierarchical summary chain. Falls back to the legacy raw-article path
// if the summary-backed prompt returned nil (no data available yet for
// the chain — happens before the first summary lands).
func generateDigestText(ticker: String, window: WindowKey, articles: [Article], gameAge: Int) async -> String? {
    let today = Date()
    var dailies: [DailySummary] = []
    var weeklies: [WeeklySummary] = []
    var monthlies: [MonthlySummary] = []

    switch window {
    case .d1:
        // No summary chain; use raw articles directly.
        break
    case .w1:
        dailies = await getRecentDailySummaries(ticker, endingAt: today, days: 7)
    case .m1:
        weeklies = await getRecentWeeklySummaries(ticker, endingAt: today, weeks: 4)
        // Plus any uncovered days in the current week (partial week the
        // weekly cache hasn't been written for yet).
        let mondayThisWeek = mondayOfWeekFor(today)
        let daysIntoWeek = nyCalendar.dateComponents([.day], from: mondayThisWeek, to: today).day ?? 0
        if daysIntoWeek > 0 {
            dailies = await getRecentDailySummaries(ticker, endingAt: today, days: daysIntoWeek + 1)
        }
    case .m3:
        weeklies = await getRecentWeeklySummaries(ticker, endingAt: today, weeks: 13)
    case .y1:
        monthlies = await getRecentMonthlySummaries(ticker, endingAt: today, months: 12)
    case .all:
        // Walk back to Feb 5, 2026 — game inception. Cap at 60 months as a
        // safety bound; we re-evaluate this once the game crosses 5 years.
        let monthsSinceStart = max(1, min(60, (gameAge + 29) / 30))
        monthlies = await getRecentMonthlySummaries(ticker, endingAt: today, months: monthsSinceStart)
    }

    if let prompt = buildSummaryBackedWindowPrompt(
        ticker: ticker, window: window,
        dailies: dailies, weeklies: weeklies, monthlies: monthlies,
        gameAge: gameAge
    ) {
        do {
            return try await runAISummary(prompt: prompt)
        } catch {
            logErr("generateDigestText (summary path) error \(ticker) \(window.rawValue): \(error.localizedDescription)")
            // Fall through to legacy raw-article path
        }
    }

    // Legacy raw-article path. Used unconditionally for 1D, and as a
    // fallback for other windows when no summaries are cached yet (very
    // first run after Phase 2 deploy, or new ticker with no archive).
    guard !articles.isEmpty else { return nil }
    let prompt = buildDigestPrompt(ticker: ticker, window: window, articles: articles, gameAge: gameAge)
    do {
        let text = cleanDigestProse(try await aiRespond(prompt))
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
    // Backstop for the larger PCC model: it occasionally breaks character and
    // appends assistant/meta boilerplate ("As a foundation model developed by
    // Apple, I'm designed to…", "—another way this model supports…") or invents
    // a placeholder bracket for the live pct ("[Live figure: AAPL is currently
    // at …]"). The on-device model never did this. Prompts tell it not to, but
    // strip it here so it can never reach the page. Done on the single-lined
    // string so the trailing-clause `.*$` anchors at the true end.
    s = s.replacingOccurrences(
        of: #"(?i)\s*\[[^\]]*(?:live figure|figure is|placeholder|insert|current (?:value|price)|\.\.\.)[^\]]*\]"#,
        with: "", options: .regularExpression)
    // Markers are deliberately SELF-REFERENCE-specific (first person, or the
    // exact "As a foundation model developed by Apple" boilerplate). A broad
    // "as an ai" / "foundation model" marker would wrongly truncate legitimate
    // prose about AI companies ("cemented its position as an AI leader",
    // "released a new foundation model") — the cut runs to end-of-string, so a
    // false match is destructive. Keep these tight.
    s = s.replacingOccurrences(
        of: #"(?i)\s*[—-]?\s*[^.!?—]*\b(?:i'?m designed|i am designed|i'?m an ai|i am an ai|i'?m a (?:large )?language model|as an ai (?:model|assistant|language)|as a foundation model developed by apple|this (?:foundation |language )?model (?:supports|is designed|can help)|as your (?:ai )?assistant|i can (?:help|assist) you)\b.*$"#,
        with: "", options: .regularExpression)
    return s.trimmingCharacters(in: .whitespacesAndNewlines)
}

// MARK: - Ownership QA
//
// Scans generated prose for (player, ticker) co-occurrences and verifies the
// player actually owns the ticker per PLAYERS. Catches the worst class of
// game/portfolio-digest hallucination — e.g. "ASTS dropped, hurting Kevin"
// when only Brian owns ASTS — that the prompt rules can't fully prevent.
//
// Approach: sentence-by-sentence. Within a sentence, every player name found
// and every ticker found are considered potentially related. If a (player,
// ticker) pair is found where the player doesn't own that ticker AND no
// player named in the same sentence DOES own it, the pair is flagged. The
// "no other owner mentioned" guard handles legitimate multi-player sentences
// like "TSLA helped both Kevin and Rick" — TSLA's owner *is* in the sentence
// so the model wasn't wrong.
//
// We don't auto-reject — we log and return the prose. The user can spot
// violations in the Mac mini log and refine the prompt or push a fix.
// Returning a flagged-but-unchanged string is safer than failing the
// digest entirely.
struct OwnershipViolation {
    let sentence: String
    let player: String
    let ticker: String
}

func detectOwnershipViolations(in prose: String) -> [OwnershipViolation] {
    let knownTickers = Set(DEFAULT_TICKERS)
    // (Earlier draft also built a name→tickers forward map here; turned out
    // we only need the reverse direction via TICKER_OWNERS inside the loop,
    // so the forward map was removed.)
    //
    // Split prose into sentences. The 3-sentence digests are short, so naive
    // splitting on sentence-ending punctuation is fine.
    let sentences = prose
        .components(separatedBy: CharacterSet(charactersIn: ".!?"))
        .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        .filter { !$0.isEmpty }

    let tickerPattern = #"\b([A-Z]{1,5})\b"#
    var violations: [OwnershipViolation] = []
    for sentence in sentences {
        // Find ticker tokens
        var foundTickers: [String] = []
        if let regex = try? NSRegularExpression(pattern: tickerPattern) {
            let ns = sentence as NSString
            let matches = regex.matches(in: sentence, range: NSRange(location: 0, length: ns.length))
            for m in matches {
                let token = ns.substring(with: m.range(at: 1))
                if knownTickers.contains(token) {
                    foundTickers.append(token)
                }
            }
        }
        // Find player names (case-insensitive, whole-word)
        var foundPlayers: [String] = []      // canonical first names (e.g. "Brian")
        for p in PLAYERS {
            let pattern = #"\b"# + NSRegularExpression.escapedPattern(for: p.name) + #"\b"#
            if sentence.range(of: pattern, options: [.regularExpression, .caseInsensitive]) != nil {
                foundPlayers.append(p.name)
            }
        }
        if foundTickers.isEmpty || foundPlayers.isEmpty { continue }
        // For each ticker, decide whether the sentence has a legitimate owner.
        for ticker in foundTickers {
            let validOwnerNames = (TICKER_OWNERS[ticker] ?? []).compactMap { id in
                PLAYERS.first(where: { $0.id == id })?.name
            }
            let validOwnerSet = Set(validOwnerNames)
            let foundOwnerInSentence = foundPlayers.contains(where: { validOwnerSet.contains($0) })
            if foundOwnerInSentence { continue }
            // Every player named in this sentence is a non-owner of `ticker`.
            // Flag all of them.
            for player in foundPlayers {
                if !validOwnerSet.contains(player) {
                    violations.append(OwnershipViolation(
                        sentence: sentence,
                        player: player,
                        ticker: ticker
                    ))
                }
            }
        }
    }
    return violations
}

// Helper used by the per-window digest path to surface violations in logs.
// The prose is returned unchanged so the digest still ships; the violation
// just goes to stderr where it's visible in /tmp/stock-game.log.
func logOwnershipViolations(_ violations: [OwnershipViolation], context: String) {
    for v in violations {
        logErr("OWNERSHIP \(context): \"\(v.ticker)\" attributed to \(v.player), who doesn't hold it. Sentence: \(v.sentence)")
    }
}

// MARK: - Per-ticker pipeline

struct TickerOutcome {
    let ticker: String
    let windows: [String: WindowDigest]
    let aiEngineUsed: Bool
}

func processTicker(_ ticker: String, args: Args, windows: [WindowKey] = WindowKey.allCases, priceData: PriceDataLite? = nil) async -> TickerOutcome {
    log("• \(ticker): start (windows=\(windows.map { $0.rawValue }.joined(separator: ",")))")
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
        // Count articles that actually need an AI call (the hard-accept path
        // already has a score). This is the silent stretch the user couldn't
        // tell was active — log a heads-up before it starts AND log every
        // article-scoring decision as it lands so /tmp/stock-game.log shows
        // continuous progress instead of an apparent freeze. ~20 lines per
        // ticker × 45 tickers = ~900 lines per daily run; the noise is
        // worth the "I can see it's still working" feedback.
        let toScore = stage1.filter { $0.relevanceScore == nil }.count
        if toScore > 0 {
            log("  \(ticker): scoring \(toScore) article\(toScore == 1 ? "" : "s") via Apple Intelligence…")
        }
        var scoredCount = 0
        for var a in stage1 {
            if a.relevanceScore != nil {
                stage2.append(a)
                continue
            }
            if let s = await scoreArticleAI(a, ticker: ticker) {
                scoredCount += 1
                a.relevanceScore = s.score
                a.relevanceReason = s.reason
                a.aiEngine = "AppleIntelligence"
                if s.score >= RELEVANCE_THRESHOLD {
                    a.passedAIFilter = true
                    stage2.append(a)
                    log("    [\(scoredCount)/\(toScore)] ✓ \(s.score)/10  \(a.title.prefix(60))")
                } else {
                    a.passedAIFilter = false
                    aiRejected.append(s.score)
                    log("    [\(scoredCount)/\(toScore)] ✗ \(s.score)/10  \(a.title.prefix(60))")
                }
            } else {
                // Fail open — keep the article, mark unscored
                scoredCount += 1
                aiErrors += 1
                a.passedAIFilter = nil
                stage2.append(a)
                log("    [\(scoredCount)/\(toScore)] ⚠ scoring failed  \(a.title.prefix(60))")
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

    // 5b. Generate today's daily summary (Phase 2 — hierarchical chain).
    // Runs before the per-window digests so the 1W path below finds it in
    // cache instead of triggering a lazy regeneration from raw articles.
    // Skipped on weekly/game scopes — those don't fetch fresh articles, so
    // there's no new daily summary to write.
    if args.scope == .daily {
        _ = await getOrGenerateDailySummary(ticker, date: today)
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
        for w in windows {
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
                // Inject a `{{TICKER}}` placeholder after the first ticker
                // mention so the fast tier can append a live pct in
                // brackets every 15 min. Replaces the old "ask the model
                // to bracket" approach, which produced hallucinated
                // numbers when Apple Intelligence didn't follow the format.
                // Also log if the AI snuck a percentage into the prose
                // anyway — those are hallucinations the new prompt is
                // supposed to prevent.
                var templateText: String? = nil
                if let d = digestText, TEMPLATED_HOLDING_WINDOWS.contains(w) {
                    if proseContainsHallucinatedPcts(d) {
                        logErr("processTicker \(ticker) \(w.rawValue): hallucinated pct in prose — \(d.prefix(160))")
                    }
                    let t = injectDigestPlaceholders(d, tickers: [ticker], userByName: [:])
                    if t.contains("{{") {
                        templateText = t
                    } else {
                        logErr("processTicker \(ticker) \(w.rawValue): model didn't mention the ticker symbol — fast tier won't refresh this window.")
                    }
                }
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
                log("  \(ticker) \(w.rawValue) → \(digestText != nil ? "✓" : "—")\(templateText != nil ? " [template]" : "") (\(articles.count) articles, maturity=\(maturity))")
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
                    sources: Array(sources),
                    digestTemplate: templateText
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
    let lookback = window.newsLookback(gameAge: gameAge)
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
    // For the portfolio digest every article is already filtered to one of
    // \(player.name)'s holdings (see portfolioArticlesForWindow), so the
    // owner tag here would be redundant — and worse, putting "/brian" or
    // similar next to a headline was reading like a byline to the model
    // ("…as reported by Brian"). Tag with the ticker only; the player's
    // ownership is implicit because the prompt is dedicated to them.
    var articleText = ""
    for (i, ta) in articles.enumerated() {
        let desc = String(ta.article.description.prefix(DESC_TRUNCATE))
        articleText += "\(i + 1). [\(ta.ticker)] \(ta.article.title)\n\(desc)\n\n"
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
    Write a short portfolio briefing for \(player.name), a player in a paper-stock game who HOLDS the portfolio below. \(player.name) is the reader, not a reporter — the news comes from outside sources, so never attribute it to \(player.name) or any other player.

    \(player.name)'s holdings: \(player.tickers.joined(separator: ", ")).

    Standings for \(scope) (top contributors first, drags last — \(player.name) can already see these numbers on the page):
    \(standingsBlock)

    Articles from the period (each tagged with the ticker it's about — all are \(player.name)'s holdings):
    \(articleText)

    In three short, flowing sentences (one paragraph), explain the news behind the numbers in your own words — don't quote or paste the article text: the event driving the top contributor, the event behind the biggest drag, and one concrete thing to watch next. Open with the actual catalyst (an earnings beat, an analyst move, an FDA decision, a launch, a guidance change), not a restatement of the standings.

    - Use ticker symbols (e.g. WMT, TSLA), only ones \(player.name) holds, and mention \(player.name) by name at least once.
    - Don't include any percentages or numbers in the prose.
    - Output only the briefing itself — no notes about yourself, being an AI/model, or how it was generated.
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
        let text = cleanDigestProse(try await aiRespond(prompt))
        if !text.isEmpty {
            // QA: portfolio digests should reference only player.tickers.
            // Anything else is a hallucination worth logging. We don't
            // reject the digest — flagged prose still ships and the log
            // gives the user signal to refine the prompt or push a fix.
            let violations = detectOwnershipViolations(in: text).filter { v in
                v.player == player.name
            }
            logOwnershipViolations(violations, context: "portfolio \(player.id) \(window.rawValue)")
        }
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

func processPortfolio(_ player: PlayerRoster, data: PriceDataLite, gameAge: Int, windows: [WindowKey] = WindowKey.allCases) async -> PortfolioOutcome {
    log("• \(player.name)'s portfolio: start (\(player.tickers.count) tickers, windows=\(windows.map { $0.rawValue }.joined(separator: ",")))")
    var perWindow: [String: WindowDigest] = [:]
    let nowISO = isoFormatter.string(from: Date())

    // The "days of data" for a portfolio is the max across its tickers — if
    // any single ticker has been archived for N days, the portfolio rollup
    // can speak to the same span.
    let daysAvail = player.tickers.map { daysOfDataAvailable($0) }.max() ?? 0

    let entries: [(String, WindowDigest)] = await withTaskGroup(
        of: (String, WindowDigest).self
    ) { group -> [(String, WindowDigest)] in
        for w in windows {
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
                // Inject placeholders after first mentions of the player's
                // name and any tickers in their portfolio. Replaces the
                // old "ask the model to bracket pcts" approach (which
                // produced hallucinations). The fast tier renders the
                // placeholders to live `[X.XX%]` brackets every 15 min.
                // Logs hallucinated pcts in the AI output for visibility.
                var templateText: String? = nil
                if let d = digestText, TEMPLATED_PORTFOLIO_WINDOWS.contains(w) {
                    if proseContainsHallucinatedPcts(d) {
                        logErr("processPortfolio \(player.id) \(w.rawValue): hallucinated pct in prose — \(d.prefix(160))")
                    }
                    let t = injectDigestPlaceholders(
                        d,
                        tickers: Set(player.tickers),
                        userByName: [player.name: player.id]
                    )
                    if t.contains("{{") {
                        templateText = t
                    } else {
                        logErr("processPortfolio \(player.id) \(w.rawValue): no entity mentions found — fast tier won't refresh this window.")
                    }
                }
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
                log("  \(player.name) \(w.rawValue) → \(digestText != nil ? "✓" : "—")\(templateText != nil ? " [template]" : "") (\(articleObjs.count) articles, maturity=\(maturity), tickers=[\(relevant.joined(separator: ","))])")
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
                    sources: Array(sources),
                    digestTemplate: templateText
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

// MARK: - User-created funds (Phase 4 — short-form)
//
// Mirrors processPortfolio but with weighted holdings + a tighter prompt.
// Funds are deliberately lighter-weight than players:
//   - 1D + 1W only (no long-window history)
//   - 2-sentence prose (vs 3)
//   - No company-brief prepend
//   - No fact-extraction layer
//   - No long-window stale sweep
//
// What we keep: placeholder injection, so the fast tier swaps live pcts
// every 15 min the same way it does for players + the game digest.

struct FundOutcome {
    let id: String
    let windows: [String: WindowDigest]
}

// Live shares of one ticker in this fund: $ allocated to the ticker /
// startClose at game-inception. Returns 0 when the ticker isn't in the
// fund or its price series isn't in prices.json yet.
func fundShares(fund: RawFund, ticker: String, data: PriceDataLite) -> Double {
    guard let h = fund.holdings.first(where: { $0.ticker == ticker }) else { return 0 }
    guard let s = data.tickers[ticker] else { return 0 }
    return STARTING_PORTFOLIO_DOLLARS * h.weight / s.startClose
}

struct FundMovers {
    let pct: Double
    let movers: [TickerMove]
}

func computeFundMovers(fund: RawFund, data: PriceDataLite, window: WindowKey) -> FundMovers {
    var moves: [TickerMove] = []
    var totalStart = 0.0
    var totalEnd = 0.0
    for h in fund.holdings {
        guard let s = data.tickers[h.ticker] else { continue }
        let r = rangeCloses(series: s, data: data, window: window)
        if r.start == 0 { continue }
        let shares = STARTING_PORTFOLIO_DOLLARS * h.weight / s.startClose
        let pct = (r.end - r.start) / r.start
        let dollars = shares * (r.end - r.start)
        moves.append(TickerMove(ticker: h.ticker, pct: pct, dollars: dollars, endClose: r.end))
        // Anchor the fund's start/end at the window boundary across all
        // currently-priced holdings; weight-zero or missing-ticker
        // holdings are simply excluded.
        totalStart += shares * r.start
        totalEnd += shares * r.end
    }
    let pct = totalStart == 0 ? 0 : (totalEnd - totalStart) / totalStart
    return FundMovers(pct: pct, movers: moves)
}

func formatFundStandingsBlock(_ fm: FundMovers) -> String {
    let byDollars = fm.movers.sorted { $0.dollars > $1.dollars }
    let topN = Array(byDollars.prefix(3))
    let topNTickers = Set(topN.map { $0.ticker })
    let drags = byDollars
        .filter { $0.dollars < 0 && !topNTickers.contains($0.ticker) }
        .reversed()
        .prefix(2)
    var lines: [String] = []
    for (i, m) in topN.enumerated() {
        lines.append("  \(i + 1). \(m.ticker): \(String(format: "%+.2f%%", m.pct * 100))")
    }
    if !drags.isEmpty {
        lines.append("  Drag:")
        for d in drags {
            lines.append("    \(d.ticker): \(String(format: "%+.2f%%", d.pct * 100))")
        }
    }
    return lines.joined(separator: "\n")
}

func buildFundDigestPrompt(
    fund: RawFund,
    window: WindowKey,
    movers: FundMovers,
    gameAge: Int
) -> String {
    let scope: String
    switch window {
    case .d1: scope = "today"
    case .w1: scope = "this past week"
    default: scope = "the active range"
    }
    // Comma list of all holdings with their allocations, capped to keep
    // the prompt tight even when a fund holds 20+ tickers.
    let holdingsLine = fund.holdings
        .prefix(20)
        .map { "\($0.ticker) (\(String(format: "%.1f", $0.weight * 100))%)" }
        .joined(separator: ", ")
    return """
    Write a brief 2-sentence summary of what's driving the user-created comparison fund "\(fund.name)" \(scope). It's a $100,000 paper portfolio split across the holdings below as of the Feb 5, 2026 close (day \(gameAge)).

    Holdings (with allocations): \(holdingsLine)

    Top movers for \(scope):
    \(formatFundStandingsBlock(movers))

    Two short sentences in your own words (don't quote the articles): the dominant driver (a specific holding's move or news), then a secondary contributor or drag. Refer to each cited holding by its ticker symbol (e.g. AAPL, VTI), and don't include any percentages or numbers. Output only the summary — no notes about yourself or how it was generated.
    """
}

func processFund(
    _ fund: RawFund,
    data: PriceDataLite,
    gameAge: Int,
    windows: [WindowKey] = FUND_WINDOWS_DAILY
) async -> FundOutcome {
    log("• Fund \"\(fund.name)\" (\(fund.id)): start (\(fund.holdings.count) holdings)")
    var perWindow: [String: WindowDigest] = [:]
    let nowISO = isoFormatter.string(from: Date())
    let daysAvail = fund.holdings
        .map { daysOfDataAvailable($0.ticker) }
        .max() ?? 0

    let entries: [(String, WindowDigest)] = await withTaskGroup(
        of: (String, WindowDigest).self
    ) { group -> [(String, WindowDigest)] in
        for w in windows {
            let movers = computeFundMovers(fund: fund, data: data, window: w)
            let hasAnyData = movers.movers.contains { abs($0.dollars) > 0.01 }
            let effRequired = w.effectiveDaysRequired(gameAge: gameAge)
            let maturity = dataMaturity(daysOfData: daysAvail, daysRequired: effRequired)
            // Skip if we have no price data at all (just-created fund whose
            // tickers haven't been fetched yet) or the window is too young.
            if !hasAnyData || maturity == "insufficient" {
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
                let prompt = buildFundDigestPrompt(fund: fund, window: w, movers: movers, gameAge: gameAge)
                var digestText: String? = nil
                do {
                    digestText = cleanDigestProse(try await aiRespond(prompt))
                } catch {
                    logErr("processFund error \(fund.id) \(w.rawValue): \(error.localizedDescription)")
                }
                // Same template-injection step as portfolios + game — we
                // ask the AI to mention ticker symbols, then post-process
                // to add {{TICKER}} placeholders that the fast tier swaps
                // for live pcts every 15 min.
                var templateText: String? = nil
                if let d = digestText, TEMPLATED_FUND_WINDOWS.contains(w) {
                    if proseContainsHallucinatedPcts(d) {
                        logErr("processFund \(fund.id) \(w.rawValue): hallucinated pct in prose — \(d.prefix(160))")
                    }
                    let fundTickers = Set(fund.holdings.map { $0.ticker })
                    let t = injectDigestPlaceholders(d, tickers: fundTickers, userByName: [:])
                    if t.contains("{{") {
                        templateText = t
                    } else {
                        logErr("processFund \(fund.id) \(w.rawValue): no ticker mentioned — fast tier won't refresh this window.")
                    }
                }
                log("  Fund \(fund.name) \(w.rawValue) → \(digestText != nil ? "✓" : "—")\(templateText != nil ? " [template]" : "")")
                return (w.rawValue, WindowDigest(
                    digest: digestText,
                    articleCount: 0,
                    dateRange: nil,
                    avgRelevanceScore: nil,
                    generatedAt: nowISO,
                    aiEngine: digestText != nil ? "AppleIntelligence" : nil,
                    dataMaturity: maturity,
                    daysOfData: daysAvail,
                    daysRequired: effRequired,
                    sources: nil,
                    digestTemplate: templateText
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
    return FundOutcome(id: fund.id, windows: perWindow)
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
    // Internal sort uses $ contribution (position size × return) so the
    // ranking reflects what actually drives portfolio value — not just
    // the highest-pct mover, which might be a small position. The output
    // line itself only shows %, since the AI is forbidden from quoting
    // dollar amounts and there's nothing else for the player to look at.
    let byDollars = um.movers.sorted { $0.dollars > $1.dollars }
    let topN = Array(byDollars.prefix(3))
    let topTickers = Set(topN.map { $0.ticker })
    let drags = byDollars
        .filter { $0.dollars < 0 && !topTickers.contains($0.ticker) }
        .reversed()        // most-negative first
        .prefix(3)

    func line(_ m: TickerMove) -> String {
        let pctStr = String(format: "%+.2f%%", m.pct * 100)
        return "\(m.ticker): \(pctStr)"
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
    let lookback = window.newsLookback(gameAge: gameAge)
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

// Built dynamically from PLAYERS so the prompt never drifts from lib/picks.ts.
func playersBlockForPrompt() -> String {
    var lines: [String] = []
    for p in PLAYERS {
        lines.append("  \(p.name): \(p.tickers.joined(separator: ", "))")
    }
    return lines.joined(separator: "\n")
}

// Per-ticker ownership table for the game-summary prompt. The model has
// repeatedly hallucinated wrong (player, ticker) pairs (e.g. "ASTS dropped,
// hurting Kevin" when only Brian owns ASTS). The fix that finally stuck was
// putting an explicit ticker→owners lookup right next to the writing rules,
// so the model can cross-check ownership *as it writes* rather than relying
// on memory of the PLAYERS table earlier in the prompt.
func ownershipTableForPrompt() -> String {
    var lines: [String] = []
    let tickers = DEFAULT_TICKERS
    for t in tickers {
        let names: [String] = (TICKER_OWNERS[t] ?? []).compactMap { id in
            PLAYERS.first(where: { $0.id == id })?.name
        }
        guard !names.isEmpty else { continue }
        lines.append("  \(t) → \(names.joined(separator: " + "))")
    }
    return lines.joined(separator: "\n")
}

// --- Game-summary facts-first layer (Phase 4) -------------------------------
//
// The freeform prompt that used to drive the game-wide digest had Apple
// Intelligence pick its own "top mover" and "drag" and "forward catalyst"
// from a raw article list — which produced hallucinations like
//   • "biggest drag event of the day saw a 40% increase in April"
//   • "TSLA has seen a 30% increase since April, this is a big concern
//      for Rick, who lost 6.24% of his portfolio"
// (Neither April figure was in the inputs; the AI confabulated.)
//
// New approach: Swift computes the three structured anchors deterministically
// from prices.json + the article archive, hands them to the model as labeled
// FACT blocks, and the model's job is just to rephrase each block into one
// natural-sounding sentence — no inference required. The model can't invent
// percentages or dates because none are present to draw from outside the
// FACTS.

struct GameAnchor {
    let ticker: String
    let tickerPct: Double                          // window pct, e.g. 0.052
    let owners: [(name: String, portfolioPct: Double)]   // every player who holds it
    let article: TaggedArticle?                    // best-relevance article for ticker
}

struct GameDigestFacts {
    let topMover: GameAnchor?              // most positive ticker in the window
    let topDrag:  GameAnchor?              // most negative ticker in the window
    let forwardCatalyst: GameAnchor?       // an owned-ticker article hinting at future events
}

// Future-event keywords scanned in article titles/descriptions to pick the
// sentence-3 anchor. Tuned for financial news cadence: earnings calendar,
// regulatory milestones, product launches, scheduled events.
let FUTURE_EVENT_KEYWORDS: [String] = [
    "upcoming", "expected", "expects", "preview", "ahead of", "schedule",
    "scheduled", "set to", "anticipated", "forecast", "outlook", "guidance",
    "plans to", "will report", "next quarter", "next month", "to launch",
    "to release", "fda decision", "pdufa", "investor day", "earnings call",
    "will host", "to host", "will announce", "to announce", "this fall",
    "this spring", "this summer", "this winter", "in q1", "in q2", "in q3",
    "in q4",
]

func computeGameDigestFacts(
    data: PriceDataLite,
    window: WindowKey,
    standings: [UserStanding],
    articles: [TaggedArticle]
) -> GameDigestFacts {
    // Per-ticker window pct, computed directly from prices.json so the
    // numbers in the prompt are exactly what the chart shows.
    let allTickers = Array(Set(PLAYERS.flatMap { $0.tickers }))
    var tickerPctMap: [String: Double] = [:]
    for t in allTickers {
        guard let s = data.tickers[t] else { continue }
        let r = rangeCloses(series: s, data: data, window: window)
        if r.start != 0 { tickerPctMap[t] = (r.end - r.start) / r.start }
    }
    let sortedByPct = tickerPctMap.sorted { $0.value > $1.value }

    // Quick-lookup for an owner's portfolio pct in this window.
    var portfolioPctById: [String: Double] = [:]
    for s in standings { portfolioPctById[s.player.id] = s.pct }

    func bestArticle(for ticker: String) -> TaggedArticle? {
        articles
            .filter { $0.ticker == ticker }
            .max(by: {
                ($0.article.relevanceScore ?? 0) < ($1.article.relevanceScore ?? 0)
            })
    }

    func ownersFor(_ ticker: String) -> [(name: String, portfolioPct: Double)] {
        let ids = TICKER_OWNERS[ticker] ?? []
        return ids.compactMap { id in
            guard let player = PLAYERS.first(where: { $0.id == id }) else { return nil }
            let pct = portfolioPctById[id] ?? 0
            return (name: player.name, portfolioPct: pct)
        }
    }

    func anchor(forTicker ticker: String, withArticle override: TaggedArticle? = nil) -> GameAnchor? {
        guard let pct = tickerPctMap[ticker] else { return nil }
        let owners = ownersFor(ticker)
        guard !owners.isEmpty else { return nil }       // skip un-owned tickers
        return GameAnchor(
            ticker: ticker,
            tickerPct: pct,
            owners: owners,
            article: override ?? bestArticle(for: ticker)
        )
    }

    let topMover = sortedByPct.first.flatMap { anchor(forTicker: $0.key) }
    let topDrag  = sortedByPct.last.flatMap  { anchor(forTicker: $0.key) }

    // Forward catalyst: prefer an article whose text mentions a future
    // event AND covers a ticker not already used in sentences 1-2. Fall
    // back to highest-relevance unused article. Same-ticker reuse is
    // allowed only if no alternative exists at all.
    let usedTickers = Set([topMover?.ticker, topDrag?.ticker].compactMap { $0 })
    let futureArticles = articles.filter { ta in
        let text = (ta.article.title + " " + ta.article.description).lowercased()
        return FUTURE_EVENT_KEYWORDS.contains { text.contains($0) }
    }
    // Only treat an article as "about" its ticker if the title/description
    // actually names that ticker (symbol or company name). This stops the
    // forward slot from pairing a ticker with a story that's really about a
    // different company (e.g. a GOOGL-filed article that's actually about
    // Apple) — those read incoherently and tripped the ownership QA.
    func aboutItsTicker(_ ta: TaggedArticle) -> Bool {
        let hay = (ta.article.title + " " + ta.article.description).uppercased()
        if hay.range(of: "\\b\(NSRegularExpression.escapedPattern(for: ta.ticker))\\b", options: .regularExpression) != nil { return true }
        if let name = TICKER_NAMES[ta.ticker]?.uppercased(),
           let firstWord = name.split(separator: " ").first.map(String.init),
           firstWord.count >= 3, hay.contains(firstWord) { return true }
        return false
    }
    func bestUnused(_ pool: [TaggedArticle]) -> TaggedArticle? {
        pool.filter { !usedTickers.contains($0.ticker) }
            .sorted { ($0.article.relevanceScore ?? 0) > ($1.article.relevanceScore ?? 0) }
            .first
    }
    // Preference order: on-topic future-event article, then on-topic anything,
    // then any future-event article, then anything unused, then last resort.
    let pickFuture: TaggedArticle? =
        bestUnused(futureArticles.filter(aboutItsTicker))
        ?? bestUnused(articles.filter(aboutItsTicker))
        ?? bestUnused(futureArticles)
        ?? bestUnused(articles)
        ?? futureArticles.first
    let forwardCatalyst: GameAnchor? = pickFuture.flatMap { ta in
        anchor(forTicker: ta.ticker, withArticle: ta)
    }

    return GameDigestFacts(
        topMover: topMover,
        topDrag: topDrag,
        forwardCatalyst: forwardCatalyst
    )
}

// How old an article is, in calendar days (ET), for framing a catalyst as
// fresh vs. still-driving. Returns a short phrase the prompt can lean on so an
// older-but-still-relevant report reads as "still reacting to …" rather than
// being passed off as today's news.
func articleRecencyPhrase(_ a: Article) -> String {
    guard let when = parseFetchedAtDate(a.fetchedAt) else { return "" }
    let today = nyCalendar.startOfDay(for: Date())
    let day = nyCalendar.startOfDay(for: when)
    let days = nyCalendar.dateComponents([.day], from: day, to: today).day ?? 0
    if days <= 0 { return "reported today" }
    if days == 1 { return "reported yesterday — the move is still being driven by it" }
    return "reported \(days) days ago — the price is still reacting to it, not to fresh news today"
}

// Render one GameAnchor into a compact fact the model turns into a sentence.
// Carries the ticker, its holders, and the single best article (the catalyst)
// plus how recent that catalyst is. When there's genuinely no article in the
// (wider) news window, we tell the model to attribute the move to ongoing
// momentum — never to invent a cause, and never the word "generic".
func renderFactBlock(_ anchor: GameAnchor?, role: String) -> String {
    guard let a = anchor else {
        return "\(role): none this period — skip this sentence."
    }
    let owners = a.owners.map { $0.name }.joined(separator: ", ")
    let catalyst: String
    if let art = a.article?.article {
        let excerpt = String(art.description.prefix(160))
        let recency = articleRecencyPhrase(art)
        let recencyTag = recency.isEmpty ? "" : " [\(recency)]"
        catalyst = "Catalyst (summarize in your own words, don't quote)\(recencyTag) — \(art.title)" + (excerpt.isEmpty ? "" : ": \(excerpt)")
    } else {
        catalyst = "Catalyst — no notable news in the last several days; attribute the move to ongoing momentum or positioning rather than inventing a specific event."
    }
    return """
    \(role): \(a.ticker), held by \(owners).
      \(catalyst)
    """
}

// Appended to the prompt on a retry after the model misattributed a ticker.
// The on-device model's recurring failure is inverting the relationship
// ("Brian's holdings helped MRVL") and dumping a player's whole roster.
let GAME_RETRY_NUDGE = """


    IMPORTANT — your previous attempt broke a rule. A stock may be credited ONLY to the player(s) listed as holding it in the FACTS. The STOCK moved, and that move helped or hurt its HOLDER — never write it the other way around. Never list a player's other holdings. Name only the holder shown for each stock.
    """

func joinNames(_ parts: [String]) -> String {
    switch parts.count {
    case 0: return ""
    case 1: return parts[0]
    case 2: return "\(parts[0]) and \(parts[1])"
    default: return parts.dropLast().joined(separator: ", ") + ", and " + (parts.last ?? "")
    }
}

// Render a fact anchor's owners as "Kevin {{user:kevin}}" (+ joined) so the
// deterministic fallback carries the same live-pct placeholders the templated
// model prose would, and the fast tier renders them identically.
func ownersPhrase(_ owners: [(name: String, portfolioPct: Double)]) -> String {
    let parts = owners.map { o -> String in
        if let id = PLAYER_NAME_BY_ID_EXACT[o.name] { return "\(o.name) {{user:\(id)}}" }
        return o.name
    }
    return joinNames(parts)
}

// Bulletproof fallback used when the model can't produce a clean, correctly
// attributed blurb after a retry. Built entirely in Swift from the same anchors
// the prompt used, so it can never misattribute a ticker. Returns a templated
// string (with {{TICKER}} / {{user:id}} placeholders, no literal numbers); the
// caller renders it through renderGameDigestTemplate for live pcts.
func deterministicGameTemplate(_ facts: GameDigestFacts) -> String? {
    var sentences: [String] = []
    if let m = facts.topMover, !m.owners.isEmpty {
        sentences.append("\(m.ticker) {{\(m.ticker)}} led the gainers, lifting \(ownersPhrase(m.owners)).")
    }
    if let dr = facts.topDrag, !dr.owners.isEmpty {
        sentences.append("\(dr.ticker) {{\(dr.ticker)}} was the biggest drag, weighing on \(ownersPhrase(dr.owners)).")
    }
    if let f = facts.forwardCatalyst, !f.owners.isEmpty {
        sentences.append("\(f.ticker) {{\(f.ticker)}} is worth watching next for \(ownersPhrase(f.owners)).")
    }
    return sentences.isEmpty ? nil : sentences.joined(separator: " ")
}

func buildGameSummaryPrompt(window: WindowKey, standings: [UserStanding], articles: [TaggedArticle], gameAge: Int, data: PriceDataLite) -> String {
    let scope: String
    switch window {
    case .d1:  scope = "today"
    case .w1:  scope = "this past week"
    case .m1:  scope = gameAge < 30  ? "since the game's start on February 5, 2026 (\(gameAge) days ago)" : "this past month"
    case .m3:  scope = gameAge < 90  ? "since the game's start on February 5, 2026 (\(gameAge) days ago)" : "this past quarter"
    case .y1:  scope = gameAge < 365 ? "since the game's start on February 5, 2026 (\(gameAge) days ago)" : "this past year"
    case .all: scope = "since the game's start on February 5, 2026 (\(gameAge) days ago)"
    }
    // Swift picks the gainer / drag / forward-looking anchors deterministically
    // from prices + the article archive; the model just narrates them.
    let facts = computeGameDigestFacts(
        data: data,
        window: window,
        standings: standings,
        articles: articles
    )
    let moverBlock = renderFactBlock(facts.topMover, role: "Top gainer of \(scope)")
    let dragBlock  = renderFactBlock(facts.topDrag,  role: "Biggest drag of \(scope)")
    let aheadBlock = renderFactBlock(facts.forwardCatalyst, role: "Worth watching next")

    return """
    Write the short "what's driving the leaderboard" blurb for a \(PLAYERS.count)-player paper-stock game — each player started with $100,000 on February 5, 2026; today is day \(gameAge). The players just hold stocks; they don't write or report the news.

    Work only from the FACTS below — don't invent events, dates, or figures, and don't pull in a player's other holdings. Each fact names a stock, the catalyst behind its move, and the player(s) who hold that stock. The stock moved, and that move helped or hurt its holder — never write it the other way around (a player's holdings don't "help a stock").

    EXAMPLE
    Facts:
      Top gainer of this past week: ZZA, held by Morgan.
        Catalyst — ZZA won a large new supply contract.
      Biggest drag of this past week: ZZB, held by Riley.
        Catalyst — ZZB fell after an analyst downgrade.
      Worth watching next: ZZC, held by Morgan.
        Catalyst — ZZC reports earnings next week.
    Blurb:
      ZZA's new supply contract made it the week's top gainer, lifting Morgan. An analyst downgrade made ZZB the biggest drag, hurting Riley. Watch ZZC next for Morgan, with earnings due soon.

    Now write the blurb for these FACTS:
    \(moverBlock)
    \(dragBlock)
    \(aheadBlock)

    Write three short, flowing sentences as one paragraph: the top gainer and who it helped, the biggest drag and who it hurt, and what's worth watching next. Keep it tight and natural — summarize each catalyst in your own words in a clause or two; never quote or paste the article text.

    - Name stocks by ticker symbol (e.g. TSLA, AAPL) and players by first name, exactly as written in the FACTS, and credit each stock's move only to the player(s) the fact says hold it. Don't name any other ticker or player — not a player's other holdings, and not a company a catalyst article only mentions in passing. The example names (Morgan, Riley, ZZA, ZZB, ZZC) must not appear in your blurb.
    - If a stock fell despite good-sounding news (or rose despite bad news), just say so — don't twist the headline to match the move.
    - A catalyst tagged "reported yesterday" or "reported N days ago" is news the stock is STILL reacting to — frame it that way (e.g. "still riding", "continues to react to") instead of implying it broke today. Only a catalyst tagged "reported today" is fresh.
    - Don't include any percentages or numbers. Skip any line marked "skip this sentence".
    - Output only the three sentences — no notes about yourself, being an AI/model, or how this was produced.
    """
}

// MARK: - Templating (Phase 3)
//
// The morning daily run prompts Apple Intelligence to format every percentage
// as "TOKEN [±X.XX%]" where TOKEN is a ticker or a player first name. After
// generation, we walk the prose and replace each match with a placeholder
// (`{{TICKER}}` or `{{user:USERID}}`). Both the templated and rendered forms
// are saved so the fast tier can re-render quickly without an AI call.

let TEMPLATE_TOKEN_PATTERN = #"\b([A-Z][A-Za-z]{0,9})\s+\[([+-]?\d+(?:\.\d+)?)%\]"#
let TEMPLATE_PLACEHOLDER_PATTERN = #"\{\{((?:user:)?[A-Za-z]+)\}\}"#

// Map of "first name as the AI writes it" → user id. Lowercased name keys so
// case-insensitive lookup works without per-call lowercasing.
let PLAYER_NAME_TO_ID: [String: String] = {
    var m: [String: String] = [:]
    for p in PLAYERS { m[p.name.lowercased()] = p.id }
    return m
}()

let KNOWN_TICKERS: Set<String> = Set(DEFAULT_TICKERS)

// Exact-case name → user id (e.g. "Kevin" → "kevin"). Used by the placeholder
// injector to find the player's name as-written in the AI prose.
let PLAYER_NAME_BY_ID_EXACT: [String: String] = {
    var m: [String: String] = [:]
    for p in PLAYERS { m[p.name] = p.id }
    return m
}()

// Detector for unwanted numeric content in AI prose (used by post-AI logging).
// Any percentage that survives in the AI's output is now considered a
// hallucination, since the new prompts forbid numbers entirely.
let UNBRACKETED_PCT_PATTERN = #"(?<!\[)[+-]?\d+(?:\.\d+)?%(?!\])"#

func proseContainsHallucinatedPcts(_ prose: String) -> Bool {
    guard let regex = try? NSRegularExpression(pattern: UNBRACKETED_PCT_PATTERN) else { return false }
    let ns = prose as NSString
    return regex.firstMatch(in: prose, range: NSRange(location: 0, length: ns.length)) != nil
}

// Replacement for extractGameDigestTemplate. Walks the AI prose looking for
// known ticker symbols and player first names. For each first occurrence:
//   - If immediately followed by a legacy `[+X.XX%]` bracket (model
//     happened to use the old format), REPLACE the bracket with `{{TOKEN}}`.
//   - Otherwise, APPEND ` {{TOKEN}}` after the token mention.
//   - If already followed by `{{...}}`, skip (already injected).
//
// The fast tier's renderGameDigestTemplate then substitutes each `{{...}}`
// with a live `[+X.XX%]` bracket every 15 minutes. Net effect: the rendered
// prose always shows the latest pct alongside each entity, and the AI is
// never asked to write numbers itself (so it can't hallucinate them).
func injectDigestPlaceholders(_ prose: String, tickers: Set<String>, userByName: [String: String]) -> String {
    var result = prose
    let bracketRegex = try? NSRegularExpression(pattern: #"^\s*\[[+-]?\d+(?:\.\d+)?%\]"#)
    let placeholderRegex = try? NSRegularExpression(pattern: #"^\s*\{\{[^}]+\}\}"#)

    var entries: [(token: String, placeholder: String)] = []
    for t in tickers { entries.append((t, "{{\(t)}}")) }
    for (name, uid) in userByName { entries.append((name, "{{user:\(uid)}}")) }

    for (token, placeholder) in entries {
        let pattern = "\\b\(NSRegularExpression.escapedPattern(for: token))\\b"
        guard let regex = try? NSRegularExpression(pattern: pattern) else { continue }
        let ns = result as NSString
        guard let match = regex.firstMatch(in: result, range: NSRange(location: 0, length: ns.length)) else { continue }
        let tokenEnd = match.range.location + match.range.length
        let suffix = ns.substring(from: tokenEnd)
        let suffixNS = suffix as NSString
        let suffixRange = NSRange(location: 0, length: suffixNS.length)

        // Already followed by a placeholder — skip
        if let pr = placeholderRegex,
           pr.firstMatch(in: suffix, range: suffixRange) != nil {
            continue
        }

        // Followed by a legacy `[+X.XX%]` — replace the bracket with our placeholder
        if let br = bracketRegex,
           let bm = br.firstMatch(in: suffix, range: suffixRange) {
            let bracketLen = bm.range.length
            result = ns.substring(to: tokenEnd) + " " + placeholder + ns.substring(from: tokenEnd + bracketLen)
            continue
        }

        // Default: append placeholder after the token
        result = ns.substring(to: tokenEnd) + " " + placeholder + ns.substring(from: tokenEnd)
    }
    return result
}

// Returns the templated string. Tokens that we don't recognize as either a
// ticker or a player name are left untouched — they'll just be static prose
// at render time.
func extractGameDigestTemplate(_ prose: String) -> String {
    guard let regex = try? NSRegularExpression(pattern: TEMPLATE_TOKEN_PATTERN) else { return prose }
    let ns = prose as NSString
    let matches = regex.matches(in: prose, range: NSRange(location: 0, length: ns.length))
    var result = prose
    // Reverse iteration so range offsets from the original string remain valid
    // for the not-yet-replaced (earlier) matches.
    for m in matches.reversed() {
        let tokenRange = m.range(at: 1)
        let token = ns.substring(with: tokenRange)
        let placeholder: String?
        if KNOWN_TICKERS.contains(token) {
            placeholder = "{{\(token)}}"
        } else if let uid = PLAYER_NAME_TO_ID[token.lowercased()] {
            placeholder = "{{user:\(uid)}}"
        } else {
            placeholder = nil
        }
        guard let p = placeholder else { continue }
        let fullRange = m.range
        let nsResult = result as NSString
        let prefix = nsResult.substring(with: NSRange(location: 0, length: fullRange.location))
        let suffix = nsResult.substring(from: fullRange.location + fullRange.length)
        result = prefix + token + " " + p + suffix
    }
    return result
}

// Substitute placeholders in a templated game digest with live pcts read from
// prices.json. `window` controls which range each placeholder represents
// (the game digest's window is the implicit lookback).
func renderGameDigestTemplate(_ template: String, window: WindowKey, data: PriceDataLite) -> String {
    guard let regex = try? NSRegularExpression(pattern: TEMPLATE_PLACEHOLDER_PATTERN) else { return template }
    let ns = template as NSString
    let matches = regex.matches(in: template, range: NSRange(location: 0, length: ns.length))
    var result = template
    for m in matches.reversed() {
        let tokenRange = m.range(at: 1)
        let token = ns.substring(with: tokenRange)
        let pct: Double?
        if token.hasPrefix("user:") {
            let uid = String(token.dropFirst("user:".count))
            pct = liveUserPct(userId: uid, window: window, data: data)
        } else {
            pct = liveTickerPct(ticker: token, window: window, data: data)
        }
        guard let value = pct else { continue }
        let formatted = String(format: "[%+.2f%%]", value * 100)
        let fullRange = m.range
        let nsResult = result as NSString
        let prefix = nsResult.substring(with: NSRange(location: 0, length: fullRange.location))
        let suffix = nsResult.substring(from: fullRange.location + fullRange.length)
        result = prefix + formatted + suffix
    }
    return result
}

func liveTickerPct(ticker: String, window: WindowKey, data: PriceDataLite) -> Double? {
    guard let series = data.tickers[ticker] else { return nil }
    let r = rangeCloses(series: series, data: data, window: window)
    return r.start == 0 ? nil : (r.end - r.start) / r.start
}

func liveUserPct(userId: String, window: WindowKey, data: PriceDataLite) -> Double? {
    guard let player = PLAYERS.first(where: { $0.id == userId }) else { return nil }
    return computeUserMovers(player: player, data: data, window: window).pct
}

struct GameOutcome {
    let windows: [String: WindowDigest]
}

// Game-level summaries route through the same central aiRespond as every other
// prose summary now — PCC via fm serve, on-device fallback (see the prose-engine
// section near aiRespond). processGameSummary only runs on the daily / game
// scopes (the 15-min fast tier does no AI), so this stays ~once a day.
func processGameSummary(data: PriceDataLite, gameAge: Int, windows: [WindowKey] = WindowKey.allCases) async -> GameOutcome {
    log("• Game-wide summary: start (\(windows.map { $0.rawValue }.joined(separator: ", ")))")
    var perWindow: [String: WindowDigest] = [:]
    let nowISO = isoFormatter.string(from: Date())

    // Use the max archive depth across any ticker as the "days of data" since
    // the game-wide rollup spans every ticker.
    let allTickers = Array(Set(PLAYERS.flatMap { $0.tickers }))
    let daysAvail = allTickers.map { daysOfDataAvailable($0) }.max() ?? 0

    let entries: [(String, WindowDigest)] = await withTaskGroup(
        of: (String, WindowDigest).self
    ) { group -> [(String, WindowDigest)] in
        for w in windows {
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
                let prompt = buildGameSummaryPrompt(window: w, standings: standings, articles: articles, gameAge: gameAge, data: data)

                // Generate, then verify ownership. The game digest cites
                // multiple players + tickers, and the on-device model recurs to
                // a wrong (player, ticker) pairing ("Brian's holdings helped
                // MRVL" when MRVL is Kevin's). detectOwnershipViolations catches
                // it; if found, retry once with a stricter nudge. If it STILL
                // misattributes, we don't ship it — we fall back to a
                // deterministic Swift-built blurb from the same anchors, which
                // can't get ownership wrong. Never ship a misattribution.
                var digestText: String? = nil
                for attempt in 0..<2 {
                    do {
                        let raw = try await aiRespond(attempt == 0 ? prompt : prompt + GAME_RETRY_NUDGE)
                        let cleaned = cleanDigestProse(raw)
                        let violations = detectOwnershipViolations(in: cleaned)
                        if violations.isEmpty {
                            digestText = cleaned
                            break
                        }
                        logOwnershipViolations(violations, context: "game \(w.rawValue) attempt \(attempt + 1)")
                    } catch {
                        logErr("processGameSummary error \(w.rawValue): \(error.localizedDescription)")
                        break
                    }
                }

                let facts = computeGameDigestFacts(data: data, window: w, standings: standings, articles: articles)
                var templateText: String? = nil
                var usedFallback = false

                if digestText == nil {
                    // Model errored or couldn't keep ownership straight after a
                    // retry — emit the deterministic blurb instead of nothing /
                    // garbage. Carries the same {{TICKER}}/{{user:id}} placeholders
                    // so the fast tier renders live pcts identically.
                    if let tmpl = deterministicGameTemplate(facts) {
                        digestText = renderGameDigestTemplate(tmpl, window: w, data: data)
                        templateText = TEMPLATED_GAME_WINDOWS.contains(w) ? tmpl : nil
                        usedFallback = true
                    }
                } else if let d = digestText, TEMPLATED_GAME_WINDOWS.contains(w) {
                    // Model prose is clean: inject placeholders so the fast tier
                    // can re-render live pcts every 15 min (the model writes no
                    // numbers itself, so it can't hallucinate them).
                    if proseContainsHallucinatedPcts(d) {
                        logErr("processGameSummary \(w.rawValue): hallucinated pct in prose — \(d.prefix(200))")
                    }
                    let t = injectDigestPlaceholders(
                        d,
                        tickers: KNOWN_TICKERS,
                        userByName: PLAYER_NAME_BY_ID_EXACT
                    )
                    if t.contains("{{") {
                        templateText = t
                    } else {
                        logErr("processGameSummary \(w.rawValue): no entity mentions found in prose — fast tier won't refresh this window.")
                    }
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
                log("  Game \(w.rawValue) → \(digestText != nil ? (usedFallback ? "✓ deterministic-fallback" : "✓") : "—")\(templateText != nil ? " [template]" : "") (\(articles.count) articles, \(standings.count) players)")
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
                    sources: Array(sources),
                    digestTemplate: templateText
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

// Load an existing digests.json. Returns nil on first run (file missing) or
// on a decode failure — both cases just mean "no prior content to merge."
func loadExistingDigests(at url: URL) -> OutputJSON? {
    guard let data = try? Data(contentsOf: url) else { return nil }
    let decoder = JSONDecoder()
    do {
        return try decoder.decode(OutputJSON.self, from: data)
    } catch {
        logErr("Could not decode existing \(url.lastPathComponent) — starting from scratch (\(error.localizedDescription))")
        return nil
    }
}

// Merge writer. `existing` is the prior contents of digests.json. Anything the
// caller didn't regenerate this run is preserved from `existing`. Holdings or
// portfolios whose key isn't in the current roster (e.g. SPY after Lee's swap)
// are dropped.
func writeOutputJSON(
    _ outcomes: [TickerOutcome],
    portfolios: [PortfolioOutcome],
    game: GameOutcome?,
    funds: [FundOutcome],
    existing: OutputJSON?,
    to outputURL: URL
) throws {
    let validTickers = Set(DEFAULT_TICKERS)
    let validUserIds = Set(PLAYERS.map { $0.id })
    // Fund IDs visible across the file (active + archived-within-window) so
    // the merge step preserves archived entries' prose. Funds not in the
    // current funds.json at all (e.g. file truncated) get dropped.
    let knownFundIds = Set(loadFundsFromDisk().map { $0.id })

    // Holdings: start with existing (filtered to current roster), overlay
    // any per-window updates from this run.
    var holdings: [String: [String: WindowDigest]] = [:]
    if let ex = existing {
        for (t, w) in ex.holdings where validTickers.contains(t) {
            holdings[t] = w
        }
    }
    for o in outcomes where !o.windows.isEmpty {
        var merged = holdings[o.ticker] ?? [:]
        for (k, v) in o.windows {
            merged[k] = v
        }
        holdings[o.ticker] = merged
    }

    // Portfolios: same merge pattern.
    var portfolioBlock: [String: [String: WindowDigest]] = [:]
    if let ex = existing, let pf = ex.portfolios {
        for (uid, w) in pf where validUserIds.contains(uid) {
            portfolioBlock[uid] = w
        }
    }
    for p in portfolios where !p.windows.isEmpty {
        var merged = portfolioBlock[p.userId] ?? [:]
        for (k, v) in p.windows {
            merged[k] = v
        }
        portfolioBlock[p.userId] = merged
    }

    // Game: overlay per-window.
    var gameBlock: [String: WindowDigest] = [:]
    if let ex = existing, let g = ex.game {
        gameBlock = g
    }
    if let g = game {
        for (k, v) in g.windows {
            gameBlock[k] = v
        }
    }

    // Funds: merge pattern mirrors portfolios. Funds removed from
    // funds.json entirely get dropped here; soft-deleted funds still in
    // the file keep their entries (the UI hides them anyway).
    var fundsBlock: [String: [String: WindowDigest]] = [:]
    if let ex = existing, let fb = ex.funds {
        for (fid, w) in fb where knownFundIds.contains(fid) {
            fundsBlock[fid] = w
        }
    }
    for f in funds where !f.windows.isEmpty {
        var merged = fundsBlock[f.id] ?? [:]
        for (k, v) in f.windows {
            merged[k] = v
        }
        fundsBlock[f.id] = merged
    }

    let out = OutputJSON(
        generatedAt: isoFormatter.string(from: Date()),
        aiEngine: "AppleIntelligence",
        holdings: holdings,
        portfolios: portfolioBlock.isEmpty ? nil : portfolioBlock,
        game: gameBlock.isEmpty ? nil : gameBlock,
        funds: fundsBlock.isEmpty ? nil : fundsBlock
    )
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    encoder.dateEncodingStrategy = .iso8601
    let data = try encoder.encode(out)
    let parent = outputURL.deletingLastPathComponent()
    try FileManager.default.createDirectory(at: parent, withIntermediateDirectories: true)
    try data.write(to: outputURL)
    log("✓ wrote \(outputURL.path)  (\(holdings.count) tickers, \(portfolioBlock.count) portfolios, \(gameBlock.count) game windows, \(fundsBlock.count) funds)")
}

// MARK: - Fast tier (template re-render)
//
// Reads the existing digests.json, recomputes live pcts from prices.json, and
// substitutes them into every templated window (game + per-portfolio +
// per-holding). No AI calls; no RSS fetching; intended to run after every
// 15-min price refresh. The renderer (renderGameDigestTemplate — name is
// historical) is generic over `{{TICKER}}` and `{{user:UID}}` placeholders,
// so the same call site works for all three blocks.
func runFastTier(args: Args) async {
    guard let pricesURL = pricesURLFor(outputPath: args.outputPath),
          let priceData = loadPriceData(at: pricesURL) else {
        logErr("Fast tier: prices.json unavailable — leaving digests.json untouched.")
        return
    }
    guard var existing = loadExistingDigests(at: args.outputPath) else {
        logErr("Fast tier: no existing digests.json to render against — leaving untouched.")
        return
    }
    let nowISO = isoFormatter.string(from: Date())
    var gameRendered = 0
    var portfolioRendered = 0
    var holdingsRendered = 0
    var fundsRendered = 0

    // Game windows
    var gameBlock = existing.game ?? [:]
    for w in TEMPLATED_GAME_WINDOWS {
        let key = w.rawValue
        guard var wd = gameBlock[key], let template = wd.digestTemplate else { continue }
        wd.digest = renderGameDigestTemplate(template, window: w, data: priceData)
        wd.generatedAt = nowISO
        gameBlock[key] = wd
        gameRendered += 1
    }
    existing.game = gameBlock.isEmpty ? nil : gameBlock

    // Per-portfolio windows
    if var portfoliosBlock = existing.portfolios {
        for (uid, windows) in portfoliosBlock {
            var updated = windows
            for w in TEMPLATED_PORTFOLIO_WINDOWS {
                let key = w.rawValue
                guard var wd = updated[key], let template = wd.digestTemplate else { continue }
                wd.digest = renderGameDigestTemplate(template, window: w, data: priceData)
                wd.generatedAt = nowISO
                updated[key] = wd
                portfolioRendered += 1
            }
            portfoliosBlock[uid] = updated
        }
        existing.portfolios = portfoliosBlock.isEmpty ? nil : portfoliosBlock
    }

    // Per-holding (per-ticker) windows
    var holdingsBlock = existing.holdings
    for (ticker, windows) in holdingsBlock {
        var updated = windows
        for w in TEMPLATED_HOLDING_WINDOWS {
            let key = w.rawValue
            guard var wd = updated[key], let template = wd.digestTemplate else { continue }
            wd.digest = renderGameDigestTemplate(template, window: w, data: priceData)
            wd.generatedAt = nowISO
            updated[key] = wd
            holdingsRendered += 1
        }
        holdingsBlock[ticker] = updated
    }
    existing.holdings = holdingsBlock

    // Per-fund windows — same pattern. Funds keep their archived prose
    // (fast tier doesn't archive/restore; it just re-renders templates
    // for whatever's in the file).
    if var fundsBlock = existing.funds {
        for (fid, windows) in fundsBlock {
            var updated = windows
            for w in TEMPLATED_FUND_WINDOWS {
                let key = w.rawValue
                guard var wd = updated[key], let template = wd.digestTemplate else { continue }
                wd.digest = renderGameDigestTemplate(template, window: w, data: priceData)
                wd.generatedAt = nowISO
                updated[key] = wd
                fundsRendered += 1
            }
            fundsBlock[fid] = updated
        }
        existing.funds = fundsBlock.isEmpty ? nil : fundsBlock
    }

    existing.generatedAt = nowISO
    if args.dryRun {
        log("DRY RUN — would re-render \(gameRendered) game + \(portfolioRendered) portfolio + \(holdingsRendered) holding + \(fundsRendered) fund window(s).")
        return
    }
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    do {
        let data = try encoder.encode(existing)
        try data.write(to: args.outputPath)
        log("✓ fast tier rendered \(gameRendered) game + \(portfolioRendered) portfolio + \(holdingsRendered) holding + \(fundsRendered) fund window(s).")
    } catch {
        logErr("Fast tier: failed to write \(args.outputPath.path): \(error.localizedDescription)")
    }
}

func pricesURLFor(outputPath: URL) -> URL? {
    let publicDir = outputPath.deletingLastPathComponent()
    return publicDir.appendingPathComponent("data/prices.json")
}

// MARK: - Stale long-window sweep
//
// Long-window summaries (1M / 3M / 1Y / ALL) traditionally only refreshed on
// the Saturday weekly tier — meaning at worst they sit a full week before
// the AI is re-run against new news. The finalize pass picks the K oldest
// long-window (entity, window) pairs and regenerates them against the
// existing article archive (no RSS), spreading the weekly-tier work across
// the weekdays.
//
// Scope: holdings (per-ticker) + portfolios (per-player). Game windows are
// already regenerated in full by the finalize scope, so they aren't here.
// K comes from the DIGEST_STALE_MAX env var (defaults to 0 = sweep disabled).

let STALE_LONG_WINDOWS: [WindowKey] = [.m1, .m3, .y1, .all]

struct StaleCandidate {
    enum Kind {
        case holding(String)        // ticker
        case portfolio(String)      // user id
    }
    let kind: Kind
    let window: WindowKey
    let generatedAt: String         // "" = missing entirely (sorts first)
}

func staleMaxFromEnv() -> Int {
    guard let s = ProcessInfo.processInfo.environment["DIGEST_STALE_MAX"],
          let n = Int(s), n > 0 else { return 0 }
    return n
}

func collectStaleCandidates(from existing: OutputJSON) -> [StaleCandidate] {
    var candidates: [StaleCandidate] = []
    let validTickers = Set(DEFAULT_TICKERS)
    for t in DEFAULT_TICKERS where validTickers.contains(t) {
        let windows = existing.holdings[t] ?? [:]
        for w in STALE_LONG_WINDOWS {
            let generatedAt = windows[w.rawValue]?.generatedAt ?? ""
            candidates.append(StaleCandidate(kind: .holding(t), window: w, generatedAt: generatedAt))
        }
    }
    let portfolios = existing.portfolios ?? [:]
    for player in PLAYERS {
        let windows = portfolios[player.id] ?? [:]
        for w in STALE_LONG_WINDOWS {
            let generatedAt = windows[w.rawValue]?.generatedAt ?? ""
            candidates.append(StaleCandidate(kind: .portfolio(player.id), window: w, generatedAt: generatedAt))
        }
    }
    return candidates
}

func runStaleSweep(
    args: Args,
    maxItems: Int,
    priceData: PriceDataLite?,
    existing: OutputJSON
) async -> (outcomes: [TickerOutcome], portfolios: [PortfolioOutcome]) {
    guard maxItems > 0 else { return ([], []) }
    var candidates = collectStaleCandidates(from: existing)
    // Oldest-first ordering — empty string ("never generated") sorts before
    // any ISO timestamp so missing entries get priority over stale ones.
    candidates.sort { $0.generatedAt < $1.generatedAt }
    let picked = Array(candidates.prefix(maxItems))
    if picked.isEmpty {
        log("Stale sweep: no candidates found")
        return ([], [])
    }
    log("Stale sweep: refreshing \(picked.count) of \(candidates.count) long-window candidate(s)")

    // Bucket per entity so multiple-stale-windows-for-same-entity collapse
    // into one processTicker / processPortfolio call (which fans out per
    // window via withTaskGroup internally).
    var holdingsBuckets: [String: [WindowKey]] = [:]
    var portfolioBuckets: [String: [WindowKey]] = [:]
    for c in picked {
        switch c.kind {
        case .holding(let t):     holdingsBuckets[t, default: []].append(c.window)
        case .portfolio(let uid): portfolioBuckets[uid, default: []].append(c.window)
        }
    }

    var sweepArgs = args
    sweepArgs.digestsOnly = true   // archive-only; sweep never refetches RSS
    sweepArgs.tickers = []         // each processTicker call passes the specific ticker

    var newOutcomes: [TickerOutcome] = []
    let gameAge = gameAgeInDays()
    for (t, windows) in holdingsBuckets {
        log("  Stale sweep [holding]: \(t) → \(windows.map { $0.rawValue }.joined(separator: ", "))")
        let o = await processTicker(t, args: sweepArgs, windows: windows, priceData: priceData)
        newOutcomes.append(o)
    }

    var newPortfolios: [PortfolioOutcome] = []
    if let pd = priceData {
        for (uid, windows) in portfolioBuckets {
            guard let player = PLAYERS.first(where: { $0.id == uid }) else { continue }
            log("  Stale sweep [portfolio]: \(player.name) → \(windows.map { $0.rawValue }.joined(separator: ", "))")
            let p = await processPortfolio(player, data: pd, gameAge: gameAge, windows: windows)
            newPortfolios.append(p)
        }
    } else if !portfolioBuckets.isEmpty {
        logErr("Stale sweep: prices.json unavailable — skipping \(portfolioBuckets.count) portfolio candidate(s)")
    }
    return (newOutcomes, newPortfolios)
}

// MARK: - Roster-change detection + invalidation
//
// The roster lives in config/roster.json (loaded near the top of this
// file). Edits land via GitHub push and the Mac mini's 15-min `git pull`.
// When the roster changes (new player, new ticker for an existing player,
// player removed, etc.) the existing per-portfolio + game digests in
// public/digests.json become stale — they reference the OLD roster.
//
// On every non-fast digest run we compare the current roster against a
// cached fingerprint at `~/StockDigests/.roster-fingerprint.json`. If
// anything changed, we drop the affected portfolio entries and ALL game
// entries from digests.json. The next run's normal pipeline regenerates
// them using the new roster, with no other manual intervention. Per-ticker
// archives + summaries are left alone — they're keyed by ticker, not user,
// so they survive a roster shuffle cleanly.

let ROSTER_FINGERPRINT_FILE = ARCHIVE_DIR.appendingPathComponent(".roster-fingerprint.json")

struct RosterFingerprint: Codable {
    var lastSeen: String
    // userId → sorted ticker list. Sorted so ["AAPL","TSLA"] and
    // ["TSLA","AAPL"] fingerprint identically (order of tickers in
    // roster.json is presentation; we only care about set equality).
    var users: [String: [String]]
}

func currentRosterFingerprint() -> RosterFingerprint {
    var users: [String: [String]] = [:]
    for p in PLAYERS {
        users[p.id] = p.tickers.sorted()
    }
    return RosterFingerprint(
        lastSeen: isoFormatter.string(from: Date()),
        users: users
    )
}

func loadCachedRosterFingerprint() -> RosterFingerprint? {
    guard let data = try? Data(contentsOf: ROSTER_FINGERPRINT_FILE) else { return nil }
    return try? JSONDecoder().decode(RosterFingerprint.self, from: data)
}

func saveRosterFingerprint(_ fp: RosterFingerprint) {
    ensureArchiveDir()
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    if let data = try? encoder.encode(fp) {
        try? data.write(to: ROSTER_FINGERPRINT_FILE)
    }
}

// Returns the set of user IDs whose portfolio digests should be invalidated.
// Empty set = no roster change.
func diffRoster(current: RosterFingerprint, cached: RosterFingerprint) -> Set<String> {
    var affected: Set<String> = []
    let currentIds = Set(current.users.keys)
    let cachedIds = Set(cached.users.keys)
    // Added / removed users — both directions
    affected.formUnion(currentIds.symmetricDifference(cachedIds))
    // Same user id but ticker set changed
    for id in currentIds.intersection(cachedIds) where current.users[id] != cached.users[id] {
        affected.insert(id)
    }
    return affected
}

// Drop the portfolio entries for affected users + ALL game entries from
// digests.json so the next daily / finalize pass regenerates them against
// the current roster. Per-ticker holdings are LEFT alone — they're keyed
// by ticker, not user, so they survive cleanly.
func invalidateAffectedDigests(affectedUserIds: Set<String>, at outputURL: URL) {
    guard !affectedUserIds.isEmpty else { return }
    guard var existing = loadExistingDigests(at: outputURL) else { return }
    var droppedPortfolios = 0
    if var portfolios = existing.portfolios {
        for uid in affectedUserIds {
            if portfolios.removeValue(forKey: uid) != nil { droppedPortfolios += 1 }
        }
        existing.portfolios = portfolios.isEmpty ? nil : portfolios
    }
    let droppedGame = (existing.game?.count ?? 0) > 0
    existing.game = nil
    existing.generatedAt = isoFormatter.string(from: Date())
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    if let data = try? encoder.encode(existing) {
        try? data.write(to: outputURL)
        log("Roster change detected — invalidated \(droppedPortfolios) portfolio entry(ies) [\(affectedUserIds.sorted().joined(separator: ", "))]\(droppedGame ? " and all game entries" : "")")
    }
}

func handleRosterChange(at outputURL: URL) {
    let current = currentRosterFingerprint()
    guard let cached = loadCachedRosterFingerprint() else {
        // First run after deploy — record the fingerprint without
        // invalidating, since the existing digests may already match.
        saveRosterFingerprint(current)
        return
    }
    let affected = diffRoster(current: current, cached: cached)
    if !affected.isEmpty {
        invalidateAffectedDigests(affectedUserIds: affected, at: outputURL)
    }
    saveRosterFingerprint(current)
}

// MARK: - Entry point

func runMain() async {
    var args = parseArgs()
    verboseEnabled = args.verbose

    // --chunk N/M slicing. Explicit --tickers wins; otherwise carve
    // DEFAULT_TICKERS into M contiguous groups and run only the Nth.
    // When this fires, args.tickers becomes non-empty → the subset-skip
    // rule below skips portfolios+game for this run (those are owned by
    // the finalize pass that runs after all chunks complete).
    if args.tickers.isEmpty, let idx = args.chunkIndex, let total = args.chunkTotal {
        let all = DEFAULT_TICKERS
        let chunkSize = (all.count + total - 1) / total       // ceil div
        let start = min(idx * chunkSize, all.count)
        let end = min(start + chunkSize, all.count)
        args.tickers = Array(all[start..<end])
        log("Chunk \(idx + 1)/\(total): \(args.tickers.count) ticker(s) — \(args.tickers.joined(separator: ", "))")
    }

    if args.check {
        let model = SystemLanguageModel.default
        switch model.availability {
        case .available:
            print("✅ Apple Intelligence on-device model available")
        case .unavailable(let reason):
            print("❌ Apple Intelligence unavailable: \(reason)")
            print("   Enable in System Settings → Apple Intelligence & Siri.")
            exit(1)
        }
        let pccAvailable: Bool
        switch PrivateCloudComputeLanguageModel().availability {
        case .available:
            print("✅ Private Cloud Compute reports available (larger context + deeper reasoning)")
            pccAvailable = true
        case .unavailable(let reason):
            print("⚠️  Private Cloud Compute unavailable: \(reason) — will use the on-device model")
            pccAvailable = false
        }
        // resolve() sends a real probe request — availability != usability, since
        // an unentitled CLI process can report available yet fail every call.
        let engine = await AIEngine.resolve()
        print("→ Selected engine: \(engine.kind.rawValue) (override with DIGEST_ENGINE=on-device|pcc)")
        let engineEnv = (ProcessInfo.processInfo.environment["DIGEST_ENGINE"] ?? "auto").lowercased()
        if engineEnv == "on-device" || engineEnv == "ondevice" {
            print("   (on-device forced via DIGEST_ENGINE=on-device; PCC probe skipped.)")
        } else if pccAvailable && engine.kind == .onDevice {
            print("   (PCC reported available but its generation probe failed — likely entitlement-gated; using on-device.)")
        }
        return
    }

    // Fast tier short-circuits before the AI availability check — it never
    // invokes Apple Intelligence, just regex substitution. Roster-change
    // handling is also skipped here because fast tier never writes per-
    // portfolio or game digests, so a roster shuffle is irrelevant to it.
    if args.scope == .fast {
        log("Stock News Digest — scope=fast (template re-render only)")
        await runFastTier(args: args)
        return
    }

    // Detect roster.json edits since the last run. If anything changed
    // (player added/removed, player's tickers changed), drop the stale
    // per-portfolio + game entries from digests.json so the next pass
    // regenerates them against the current roster. No-op when the
    // fingerprint matches the cached one (the common case).
    handleRosterChange(at: args.outputPath)

    if case .unavailable(let reason) = SystemLanguageModel.default.availability {
        logErr("Apple Intelligence unavailable (\(reason)) — skipping digest run. Previous digests.json keeps serving.")
        exit(0)        // soft skip
    }

    // Pick the engine once, before any per-ticker / per-window fan-out. This
    // sends one real PCC probe request (see AIEngine.resolve) and commits to
    // PCC only if it generates, else uses on-device for the whole run.
    AI_ENGINE = await AIEngine.resolve()

    // One-time PCC cache backfill — self-contained, doesn't touch digests.json.
    if args.scope == .backfill {
        await runBackfill()
        return
    }

    let tickers = args.tickers.isEmpty ? DEFAULT_TICKERS : args.tickers
    log("Stock News Digest — \(tickers.count) ticker(s), scope=\(args.scope.rawValue)")
    log("Engine: Apple Intelligence — \(AI_ENGINE.kind.rawValue); prose summary engine: \(SUMMARY_ENGINE)")
    if args.dryRun { log("DRY RUN — nothing will be written") }

    // Scope dictates which windows each entity regenerates. The other windows
    // stay frozen on disk and are merged in by writeOutputJSON.
    let holdingsWindows: [WindowKey]
    let portfolioWindows: [WindowKey]
    let gameWindows: [WindowKey]
    let skipFetch: Bool
    switch args.scope {
    case .daily:
        holdingsWindows = HOLDING_WINDOWS_DAILY
        portfolioWindows = PORTFOLIO_WINDOWS_DAILY
        gameWindows = WindowKey.allCases    // game refreshes in full; 1D/1W/1M emit templates
        skipFetch = args.digestsOnly        // honor the legacy flag
    case .weekly:
        holdingsWindows = HOLDING_WINDOWS_WEEKLY
        portfolioWindows = PORTFOLIO_WINDOWS_WEEKLY
        gameWindows = []                    // game is owned by daily + fast tiers
        skipFetch = true                    // weekly never refetches RSS
    case .game:
        // Game-only: re-runs every game-window (1D/1W/1M/3M/1Y/ALL) with the
        // existing article archive — no RSS fetch, no per-stock or per-portfolio
        // work. Used as a manual "redo the leaderboard digests" trigger from
        // the scheduler so prompt-tuning changes can be validated without
        // sitting through the full 8-minute daily run.
        holdingsWindows = []
        portfolioWindows = []
        gameWindows = WindowKey.allCases
        skipFetch = true
    case .finalize:
        // Finalize pass — runs after all chunked daily passes have populated
        // the per-ticker archive. Regenerates per-portfolio (1D + 1W) and
        // game-wide (all windows) digests against the now-complete archive.
        // No RSS, no per-ticker work.
        holdingsWindows = []
        portfolioWindows = PORTFOLIO_WINDOWS_DAILY
        gameWindows = WindowKey.allCases
        skipFetch = true
    case .fast, .backfill:
        // Unreachable — both handled by early returns above.
        return
    }

    var argsForWindows = args
    if skipFetch { argsForWindows.digestsOnly = true }

    // Load prices.json up front. Originally this lived below the per-ticker
    // loop because only the portfolio + game phases needed it; now the
    // per-ticker prompts also bracket live pcts (so the fast tier can swap
    // them every 15 min), so prices need to be in hand before the AI runs.
    // The prices file lives next to the output digests.json by convention
    // (publicDir = outputPath's parent → publicDir/data/prices.json).
    let runAllTickers = args.tickers.isEmpty
    var priceData: PriceDataLite? = nil
    if let url = pricesURLFor(outputPath: args.outputPath) {
        priceData = loadPriceData(at: url)
        if priceData == nil {
            logErr("Could not load prices.json at \(url.path) — per-ticker pct brackets, portfolios, and game summary will be skipped or run pct-less.")
        }
    }

    // Each phase (tickers / portfolios / funds) fans its items out with
    // mapConcurrent; phases still run in order (tickers cache the daily
    // summaries that portfolios/game read). macOS 27 runs concurrent
    // respond() calls in parallel, so this is a real speedup over the old
    // serial for-loops — AIGate caps total in-flight inference (default 4) so
    // the cross-item fan-out plus each item's per-window withTaskGroup can't
    // overload the model queue / memory. DIGEST_AI_CONCURRENCY=1 restores the
    // old strictly-serial behavior. Order is preserved so output diffs stay
    // stable.
    var outcomes: [TickerOutcome] = []
    if !holdingsWindows.isEmpty {
        // Immutable copies for the @Sendable fan-out closure (both are settled
        // vars by now; capturing them as `var` is a Swift 6 concurrency error).
        let tickerArgs = argsForWindows
        let tickerPrices = priceData
        outcomes = await mapConcurrent(tickers, limit: AIGate.limit) { t in
            await processTicker(t, args: tickerArgs, windows: holdingsWindows, priceData: tickerPrices)
        }
    } else {
        log("Skipping per-ticker digests for scope=\(args.scope.rawValue).")
    }

    if args.fetchOnly {
        log("--fetch-only complete; skipped digest output.")
        return
    }

    // Phase 2: per-user portfolio rollups. Skip when running on a subset of
    // tickers (any user whose roster isn't fully covered would generate
    // misleading prose) or when prices.json isn't readable. The full
    // all-tickers run hits this path daily.
    var portfolios: [PortfolioOutcome] = []
    if !portfolioWindows.isEmpty, runAllTickers, let pd = priceData {
        let gameAge = gameAgeInDays()
        portfolios = await mapConcurrent(PLAYERS, limit: AIGate.limit) { player in
            await processPortfolio(player, data: pd, gameAge: gameAge, windows: portfolioWindows)
        }
    } else if portfolioWindows.isEmpty {
        log("Skipping portfolio rollups for scope=\(args.scope.rawValue).")
    } else if !runAllTickers {
        log("Skipping portfolio rollups (subset run).")
    } else {
        log("Skipping portfolio rollups (prices.json unavailable).")
    }

    // Phase 3: game-wide leaderboard analysis. Reads public/data/prices.json
    // for live standings, combines with the article archive to explain *why*
    // the leaderboard looks like it does. Same subset-skip rule as above.
    var game: GameOutcome? = nil
    if !gameWindows.isEmpty, runAllTickers, let pd = priceData {
        let gameAge = gameAgeInDays()
        game = await processGameSummary(data: pd, gameAge: gameAge, windows: gameWindows)
    } else if gameWindows.isEmpty {
        log("Skipping game-wide summary for scope=\(args.scope.rawValue).")
    } else if !runAllTickers {
        log("Skipping game-wide summary (subset run).")
    }

    // Phase 4: per-fund short briefings. Only runs in the all-tickers slot
    // (daily / finalize), same as portfolios + game. Skipped for chunks
    // since funds aggregate across tickers, not per-ticker.
    var fundOutcomes: [FundOutcome] = []
    if !portfolioWindows.isEmpty, runAllTickers, let pd = priceData, !ACTIVE_FUNDS.isEmpty {
        let gameAge = gameAgeInDays()
        log("Phase 4: generating digests for \(ACTIVE_FUNDS.count) active fund(s).")
        fundOutcomes = await mapConcurrent(ACTIVE_FUNDS, limit: AIGate.limit) { fund in
            await processFund(fund, data: pd, gameAge: gameAge, windows: FUND_WINDOWS_DAILY)
        }
    } else if ACTIVE_FUNDS.isEmpty {
        log("Skipping fund digests (no active funds in config/funds.json).")
    } else if portfolioWindows.isEmpty {
        log("Skipping fund digests for scope=\(args.scope.rawValue).")
    } else if !runAllTickers {
        log("Skipping fund digests (subset run).")
    }

    // Stale long-window sweep — finalize-only. Picks the K oldest 1M/3M/1Y/ALL
    // summaries across holdings + portfolios and regenerates them, so the
    // weekly tier doesn't have to do everything in one Saturday batch. K comes
    // from DIGEST_STALE_MAX; 0 (or unset) disables.
    if args.scope == .finalize {
        let staleMax = staleMaxFromEnv()
        if staleMax > 0, let existingForSweep = loadExistingDigests(at: args.outputPath) {
            let (extraOutcomes, extraPortfolios) = await runStaleSweep(
                args: args, maxItems: staleMax,
                priceData: priceData, existing: existingForSweep,
            )
            outcomes.append(contentsOf: extraOutcomes)
            portfolios.append(contentsOf: extraPortfolios)
        }
    }

    if args.dryRun {
        log("DRY RUN complete; no files written.")
        return
    }

    let existing = loadExistingDigests(at: args.outputPath)
    do {
        try writeOutputJSON(outcomes, portfolios: portfolios, game: game, funds: fundOutcomes, existing: existing, to: args.outputPath)
    } catch {
        logErr("Failed to write output JSON: \(error.localizedDescription)")
        exit(1)
    }

    // After a daily / finalize run, immediately render the templates so the
    // on-disk digest.json reflects the current standings rather than the ones
    // at generation time. This keeps the gap between "AI wrote it" and "user
    // sees it" near zero on the morning run. Same coverage as runFastTier
    // (game + portfolios + holdings). Chunked runs hit this too because they
    // use scope=.daily — each chunk's run re-renders all existing templates.
    if (args.scope == .daily || args.scope == .finalize),
       let url = pricesURLFor(outputPath: args.outputPath),
       let pd = loadPriceData(at: url) {
        guard var refreshed = loadExistingDigests(at: args.outputPath) else { return }
        let nowISO = isoFormatter.string(from: Date())

        var gameBlock = refreshed.game ?? [:]
        for w in TEMPLATED_GAME_WINDOWS {
            let key = w.rawValue
            guard var wd = gameBlock[key], let tmpl = wd.digestTemplate else { continue }
            wd.digest = renderGameDigestTemplate(tmpl, window: w, data: pd)
            wd.generatedAt = nowISO
            gameBlock[key] = wd
        }
        refreshed.game = gameBlock.isEmpty ? nil : gameBlock

        if var portfoliosBlock = refreshed.portfolios {
            for (uid, windows) in portfoliosBlock {
                var updated = windows
                for w in TEMPLATED_PORTFOLIO_WINDOWS {
                    let key = w.rawValue
                    guard var wd = updated[key], let tmpl = wd.digestTemplate else { continue }
                    wd.digest = renderGameDigestTemplate(tmpl, window: w, data: pd)
                    wd.generatedAt = nowISO
                    updated[key] = wd
                }
                portfoliosBlock[uid] = updated
            }
            refreshed.portfolios = portfoliosBlock.isEmpty ? nil : portfoliosBlock
        }

        var holdingsBlock = refreshed.holdings
        for (ticker, windows) in holdingsBlock {
            var updated = windows
            for w in TEMPLATED_HOLDING_WINDOWS {
                let key = w.rawValue
                guard var wd = updated[key], let tmpl = wd.digestTemplate else { continue }
                wd.digest = renderGameDigestTemplate(tmpl, window: w, data: pd)
                wd.generatedAt = nowISO
                updated[key] = wd
            }
            holdingsBlock[ticker] = updated
        }
        refreshed.holdings = holdingsBlock

        // Per-fund template render — keeps live pcts current in the fund
        // briefings as soon as the daily run finishes, instead of waiting
        // for the next 15-min fast-tier tick.
        if var fundsBlock = refreshed.funds {
            for (fid, windows) in fundsBlock {
                var updated = windows
                for w in TEMPLATED_FUND_WINDOWS {
                    let key = w.rawValue
                    guard var wd = updated[key], let tmpl = wd.digestTemplate else { continue }
                    wd.digest = renderGameDigestTemplate(tmpl, window: w, data: pd)
                    wd.generatedAt = nowISO
                    updated[key] = wd
                }
                fundsBlock[fid] = updated
            }
            refreshed.funds = fundsBlock.isEmpty ? nil : fundsBlock
        }

        refreshed.generatedAt = nowISO
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        if let d = try? encoder.encode(refreshed) {
            try? d.write(to: args.outputPath)
        }
    }
}

// Bridge async to top-level script.
let semaphore = DispatchSemaphore(value: 0)
Task {
    await runMain()
    semaphore.signal()
}
semaphore.wait()
