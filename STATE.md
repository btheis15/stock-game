# STATE.md — Stock Game canonical technical state

> **Reading this?** This is the one-shot context dump for a new Claude (or
> human) session. Pair it with `OVERVIEW.md` for the narrative version and
> `CLAUDE.md` for AI-session conventions. Keep this file up-to-date whenever
> the repo's behavior changes.

## 0. Identity

| | |
|---|---|
| Repo | https://github.com/btheis15/stock-game |
| Live | https://stock-game-gamma.vercel.app |
| Vercel project | `btheis15s-projects/stock-game` |
| Owner / GH user | `btheis15` |
| Primary working dir | `~/Repos/stock-game` on each machine (NOT iCloud Desktop — iCloud sync corrupts `.git/refs/` and `.next/` with `" 2"` duplicate files, breaking every cron fire). The folder at `~/Desktop/Stock Game App/` keeps absolute symlinks to the canonical docs for iCloud discovery. |
| Inception (t=0) | **2026-02-05** (close-of-day; portfolios bought at this close) |
| Per-portfolio start | $100,000 USD, divided evenly across each player's picks |
| Mac mini timezone | Central Time (CT) — scheduler defaults assume CT for ET market hours |

## 1. Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router) |
| Lang | TypeScript 5 (strict) |
| UI | React 19 + Tailwind CSS v4 |
| Charts | Visx (`@visx/scale`, `@visx/shape`, `@visx/gradient`, `@visx/responsive`, `@visx/curve`) + `d3-array` |
| Animation | CSS-first iOS motion layer (commit `ef17cd9`): route transitions in `app/template.tsx` (tab cross-fade + drill-in push / back-out pop, all CSS keyframes), the reusable `<Sheet>` bottom-sheet primitive (`components/Sheet.tsx`), a `.press` tap-shrink utility, motion tokens, and a global `prefers-reduced-motion` guard — all in `app/globals.css`. Framer Motion is still used (sparingly) but ONLY by `BreakdownDonut` (slice-pop spring), `PortfolioComposition` (view crossfade), and `PortfolioThesis` (accordion); `WhatsNew` moved off it to a CSS grid-rows transition. CSS keyframes also drive the live pulse + holding flash. Motion is transforms/opacity only (GPU-friendly), within the per-frame budget. |
| Gestures | `@use-gesture/react` (currently unused after the touch-action fix; pointer events handle the chart) |
| Date | `date-fns` |
| Data source | Yahoo Finance (unofficial, via `yahoo-finance2` v3) |
| Package manager | npm; **must use `--legacy-peer-deps`** because Visx peers don't list React 19 |
| Hosting | Vercel (server-rendered `force-dynamic` pages + API routes; data JSONs served at request time from origin/main via the GitHub Contents API — see §8. Data commits do NOT trigger deploys: `vercel.json` `ignoreCommand` skips builds for data-only pushes) |
| PWA | Web manifest + iOS apple-web-app meta + custom install hint |

## 2. Players (`lib/picks.ts` — source of truth)

| | Color | Tickers | Per-pick $ |
|---|---|---|---|
| **Brian** | `#00C805` (green) | ASTS AMZN UBER SERV AAPL QCOM ISRG CRSP HON EXOD | $10,000 |
| **Kevin** | `#5AC8FA` (blue) | TSLA NVDA AVGO MRVL CRDO PLTR ORCL ZS VST VRT | $10,000 |
| **Rick** | `#FF9F0A` (orange) | COHR CRWV GFS GOOGL NBIS QBTS NVDA RKLB S TSLA | $10,000 |
| **Lee** | `#BF5AF2` (purple) | PEP GM TAP VZ UL DKS WMT PFE HD AAPL | $10,000 |
| **Gene** | `#FF375F` (pink) | ASML CRSP OKLO GLUE VVOS HUT AMRZ SMR RKLB ZBRA | $10,000 |

**Legacy Auto** was a sixth "player" (yellow, F GM STLA TM HMC). It's now a
comparison **fund** (`config/funds.json`, id `legacy-auto`, 5 holdings at
weight 0.2 each = mathematically identical to the old equal-split player) so
it competes as an opt-in overlay rather than a default leaderboard entry. Its
tickers F / STLA / TM / HMC are no longer owned by any player but stay
browsable on the Stocks tab + `/stock/[ticker]` via `activeFundTickers()`
(GM is still Lee's).

**Combined Players** is a synthetic, roster-derived fund (`lib/combined.ts`, id `combined-players`, color `#94A3B8` slate, `synthetic: true`). It pools every player's picks into one equal-weight $100k book: imagine all N players' picks dumped together, then $100k spread evenly across every pick *slot* (5 players × 10 picks = 50 slots at $2,000 each). A ticker more than one player chose occupies one slot per pick, so it carries proportionally more weight — AAPL (Brian + Lee), NVDA / TSLA (Kevin + Rick), CRSP (Brian + Gene), RKLB (Rick + Gene) each land at 2/50 = 4% vs 2% for a single-pick name. It's expressed as a normal `Fund` whose holdings dedupe to unique tickers each weighted `times-picked / total-picks`, so `fundSeries` / `buildFundHoldingRows` value it exactly like a user-created fund. It is NOT in `config/funds.json` — `combinedPlayersFund()` rebuilds it from the roster on each request, so a pick change reshapes it automatically. `synthetic: true` keeps it out of the Manage-Funds sheet (nothing to edit/archive). It's injected into the Compare page as a default-OFF fund chip / chart line / leaderboard row, has its own `/fund/combined-players` drill-down, and is offered as a comparison overlay on the portfolio + fund pages. The Compare page bottom also renders a **Combined breakdown** — the same `<PortfolioComposition>` donut the individual accounts use (Sector / Industry / Market cap tabs), built from the combined fund's holdings — plus an **About the combined portfolio** narrative card (see §6).

Per-holding $ is computed: `STARTING_PORTFOLIO_DOLLARS / user.tickers.length`. Players don't share share counts even when they hold the same ticker (NVDA / TSLA: Kevin + Rick; AAPL: Brian + Lee; CRSP: Brian + Gene; RKLB: Rick + Gene — same prices, independent positions, computed via `sharesFor(userId, series)`).

`ALL_TICKERS` is the dedup set across all players (44 unique today: ASTS, AMZN, UBER, SERV, AAPL, QCOM, ISRG, CRSP, HON, EXOD, TSLA, NVDA, AVGO, MRVL, CRDO, PLTR, ORCL, ZS, VST, VRT, COHR, CRWV, GFS, GOOGL, NBIS, QBTS, RKLB, S, PEP, GM, TAP, VZ, UL, DKS, WMT, PFE, HD, ASML, OKLO, GLUE, VVOS, HUT, AMRZ, SMR, ZBRA). Fund-only tickers (F, STLA, TM, HMC) are NOT in `ALL_TICKERS` — they ride the price pipeline via `allFundTickers()` and are added to stock-page params via `activeFundTickers()`.

**Baseline (S&P 500).** `lib/picks.ts` also exports `BASELINE = { id: "sp500", name: "S&P 500", color: "#9CA3AF", ticker: "SPY" }` — a read-only market benchmark rendered alongside the human players on the Compare leaderboard + chart. It competes head-to-head ($100k of SPY at the Feb-5 close + dividend cash, same math as a human portfolio with one holding), so if SPY's range pct lands 3rd, the leaderboard shows it 3rd. Explicitly NOT a User: it's not in `USER_LIST` / `TICKER_OWNERS` / `ALL_TICKERS`, has no `/portfolio` page, no `/stock/SPY` page, and no digest entries. SPY rides the price-fetch pipeline as a special-cased extra ticker in `fetch-prices.ts` (`tickersToFetch = [...ALL_TICKERS, ...spinoffChildren, BASELINE.ticker]`) so daily / intraday / weekly bars all land in `prices.json` next to the players, but stays absent from the digest pipeline (Swift's `DEFAULT_TICKERS` is derived at startup from `config/roster.json`'s `users[].tickers` — the baseline's SPY is intentionally excluded; the hardcoded `EMBEDDED_DEFAULT_TICKERS` list is only a fallback for a missing/unparseable roster.json, logged loudly, so the old digest-roster drift risk is gone in normal operation). Helpers `baselinePortfolioSeries`, `intradayBaselineSeries`, `weeklyBaselineSeries` in `lib/portfolio.ts` produce the curves the Compare view consumes; all three return null/empty if SPY isn't in the snapshot yet (graceful fallback — the row + line just don't render until the next cron tick fetches it).

## 3. Data layout

Three committed canonical artifacts:

1. `public/data/prices.json` — daily/intraday/weekly prices, dividends. Generated by `scripts/fetch-prices.ts` every ~15 min during market hours.
2. `public/digests.json` — AI-generated news digests in three slots:
   - `holdings: { [ticker]: { [window]: WindowDigest } }` — per-ticker, six windows (1D/1W/1M/3M/1Y/ALL). Renders on `/stock/[ticker]`.
   - `portfolios: { [userId]: { [window]: WindowDigest } }` — per-user rollups across that user's holdings. Renders on `/portfolio/[user]`.
   - `game: { [window]: WindowDigest }` — game-wide leaderboard analysis explaining *why* the standings look like they do, citing player names + actual portfolio percentages from `prices.json`. Renders on `/`.
   All three are generated by `scripts/digest.swift` from a shared article archive.
3. `public/data/fundamentals.json` — per-ticker company profile + key statistics + quarterly/annual financial statements + earnings history (estimate vs actual). Generated by `scripts/fetch-fundamentals.ts` once a day (piggybacks the daily digest cron). Feeds the About / Financials / Earnings sections on `/stock/[ticker]`. Every field is optional — Yahoo coverage varies; the UI hides missing values gracefully.

```ts
// lib/types.ts
PriceData {
  startDate: "2026-02-05"
  generatedAt: ISO  // when this snapshot was written
  intradayDate?: "YYYY-MM-DD"     // ET-shifted "today" for the intraday block
  intradayInterval?: "15m"
  tickers: { [ticker]: TickerSeries }
  tradingDates: ["2026-02-05", ...] // sorted unique close dates
}

TickerSeries {
  ticker, name
  startClose: number              // close on START_DATE (immutable after first fetch)
  closes: { date, close }[]       // daily, sorted ascending
  dividends?: { date, amount }[]  // per-share cash dividends since START_DATE
  intraday?: { t (ISO UTC), close }[]  // today's 15-min bars, extended session (7:00 AM – 6:00 PM ET, incl. pre-market + after-hours)
  weekly?:   { t (ISO UTC), close }[]  // 1-hour bars over past ~8 days, regular session only (used by 1W view)
}
```

Notes:
- `startClose` is set on first fetch and **never overwritten** — incremental refetches preserve it. If you re-pick after Feb 5, you'd need `--full` and a code change.
- `closes[i].close` is **unadjusted close** (not adjusted-close) — matches what Robinhood-style charts show. **Exception:** tickers in `REVERSE_SPLITS` (`lib/events.ts`) have every fetched close divided by `priceUnitDivisor` once the split is effective, to undo Yahoo's retroactive split re-scaling and keep the series in inception-day share units (so the frozen `startClose` and the fixed share count stay consistent). HON is normalized this way from its 2026-06-29 1-for-2 reverse split forward.
- `intraday[].t` and `weekly[].t` are full ISO UTC (`2026-05-05T19:30:00.000Z`); `closes[].date` is `YYYY-MM-DD`. The chart distinguishes by `date.length > 10`.
- `weekly` bars come at hour boundaries (`:30:00.000Z` for US-market alignment). Yahoo also returns a "live current-quote" bar with the actual second-of-now timestamp when fetched mid-hour — the render-time `isHourBoundaryBar` filter in `lib/portfolio.ts` drops these so all 1W plot points are at consistent hourly intervals.
- Spin-offs + reverse splits go in `lib/events.ts`. A spin-off child is fetched as if it had a START_DATE of its `effectiveDate` (no backtracked history — value is purely additive from listing day forward). Children are surfaced as first-class holdings/stocks via `SPINOFF_CHILD_TICKERS` + the derived-ownership augmentation in `TICKER_OWNERS`, **without** being added to any user's `tickers` array (that would change `perHoldingDollars` = $100k/N and dilute the user's other picks). Currently populated: **HON → HONA** (Honeywell Aerospace, ratio 0.5, effective 2026-06-29) plus the bundled **HON 1-for-2 reverse split** (`REVERSE_SPLITS`, same date).
- **Display-side spin-off callouts** (`components/SpinoffNote.tsx`, added 2026-07-21): the parent's own price/return legitimately drops by ~the value that moved to the child (that's real, per the bullet above), but shown in isolation — a bare holding-row pct, a stock-list return-since-inception, or an InsightsCard mover — it reads as an unexplained loss (HON's since-inception return is ~-50% on its own). `spinoffNoteFor(ticker)` (`lib/events.ts`) looks up either side of a spin-off; `spinoffRowSuffix` appends a short " · split off HONA Jun 29" / " · new from HON spin-off" tag to list-row subtitles in `PortfolioView`, `StocksListView`, and `InsightsCard`'s mover rows, and `SpinoffBanner` renders a full explanatory callout on `/stock/[ticker]` (both HON and HONA) right before the owner PositionCards, where the isolated "Total return" number is most likely to be misread.

### `public/digests.json`

```ts
// lib/digests.ts
DigestsJson {
  generatedAt: ISO        // when the digest run wrote this file
  aiEngine: "AppleIntelligence"
  holdings: { [ticker]: { [window]: WindowDigest } }
  portfolios?: { [userId]: { [window]: WindowDigest } }   // Phase 2 — per-user rollups
  game?: { [window]: WindowDigest }                        // Phase 3 — leaderboard analysis
}

WindowDigest {
  digest: string | null              // 3-sentence prose, null when insufficient data
  articleCount: number
  dateRange: { from, to } | null     // YYYY-MM-DD bounds of the contributing articles
  avgRelevanceScore: number | null   // 1–10, used to render the signal-quality dot
  generatedAt: ISO
  aiEngine: "AppleIntelligence" | null
  dataMaturity: "full" | "partial" | "insufficient"
  daysOfData: number                 // distinct archive days available for this ticker
  daysRequired: number               // 1/7/30/90/365/1 for d1/w1/m1/m3/y1/all
  sources: { title, link, source, date, score }[] | null   // ≤6 surfaced in the panel
  digestTemplate?: string | null     // present only on game 1D / 1W / 1M; see "Tiered refresh" below
}

window keys: "1D" | "1W" | "1M" | "3M" | "1Y" | "ALL"
```

The web app maps the chart-tab `Range` ("1YR") to the digest window `"1Y"` via `rangeToDigestWindow()`. The `ALL` window is always mature (`daysRequired: 1`) and frames its prose around the 5-year game arc since 2026-02-05; 1M/3M/1Y stay `insufficient` until enough archive history accumulates.

The article archive that feeds digests lives outside the repo at `~/StockDigests/articles/{TICKER}/{YYYY-MM-DD}.json` on the Mac mini — Mac-only state, like a cache. Logs at `~/StockDigests/digest.log` and `digest-error.log`.

#### Tiered refresh (digest pipeline)

`scripts/digest.swift` has four scopes; each scope is responsible for a disjoint slice of `digests.json`:

| Scope | Fires from | RSS fetch | AI calls | Updates |
|---|---|---|---|---|
| `fast` | `cron-update.sh` every 15 min, after the price fetch | no | none | game `1D / 1W / 1M` — re-renders each `digestTemplate` with live pcts from the freshly-written `prices.json` |
| `daily` | `digest-update.sh` Mon–Fri at the scheduled time | yes (subject to `DIGEST_MODE=digests-only`) | many | holdings `1D + 1W`, portfolios `1D + 1W`, game ALL windows (1D/1W/1M emitted with `digestTemplate`) |
| `weekly` | `digest-update.sh` on Saturday at the scheduled time | no | many | holdings `1M / 3M / 1Y / ALL`, portfolios `1M / 3M / 1Y / ALL` |
| `game` | Manual — the "Re-run Game Briefings Only" button in the scheduler, or `DIGEST_SCOPE=game bash scripts/digest-update.sh` from a shell | no | 6 | game ALL windows only (1D/1W/1M with `digestTemplate`). Used for mid-day prompt-tuning re-runs without sitting through the full daily pipeline. ~30 s. |

Anything a given scope doesn't touch is preserved from the prior `digests.json` — `writeOutputJSON` reads the existing file and overlays only the windows it just regenerated. Holdings or portfolios whose key isn't in the current roster (e.g. SPY after the Lee swap) are pruned at merge time.

**Templated game prose (Phase 3).** The daily run instructs Apple Intelligence to format every percentage as `TOKEN [±X.XX%]`, where TOKEN is a ticker symbol or player first name. After generation, `extractGameDigestTemplate` replaces those `TOKEN [±X.XX%]` occurrences with `{{TICKER}}` or `{{user:USERID}}` placeholders and stores the result in `WindowDigest.digestTemplate` (alongside the rendered `digest`). The next 15-min `fast` tier reads each game template, computes the live pct for each placeholder via `rangeCloses` / `computeUserMovers`, and writes the substituted prose back to `digest`. Sub-second; no AI involved. If the model ever drifts from the bracket format the extractor logs a warning and that window's prose just stays frozen until the next daily run — no crash.

**Facts-first game prompt (Phase 4).** Earlier versions of the game-summary prompt asked the model to pick its own top mover, drag, and forward catalyst from a raw article list and write prose — which produced hallucinations like "40% increase in April" that weren't in any input. The current prompt is templated around three labeled FACT blocks pre-computed deterministically by `computeGameDigestFacts(data, window, standings, articles)`:

- **FACT 1** — `topMover`: ticker with the largest positive window pct, plus its best-relevance article and every owner's portfolio pct.
- **FACT 2** — `topDrag`: ticker with the largest negative window pct, same shape.
- **FACT 3** — `forwardCatalyst`: highest-relevance article whose title/description mentions a future-event keyword (`upcoming`, `scheduled`, `outlook`, `FDA decision`, `earnings call`, …), filtered to a ticker not already used in sentences 1-2.

Each `GameAnchor` carries `ticker`, `tickerPct`, owners with their portfolio pcts, and one article. The prompt renders each anchor as a FACT block and tells the model: *"Do NOT introduce ANY information not present in the FACT block — no extra percentages, no dates, no growth figures. Every number must come from a FACT block."* When a slot has no data the FACT is marked `[skip]` and the model omits that sentence rather than fabricating.

**Ownership QA backstop.** `detectOwnershipViolations(prose)` runs on every generated digest (portfolio + game) sentence-by-sentence. For each (player, ticker) co-occurrence it checks whether the player is in `TICKER_OWNERS[ticker]`; if not, and no legitimate owner is named in the same sentence, it's a violation. **For the game-wide digest this is now enforcing, not advisory:** `processGameSummary` generates, runs the detector, and on any violation retries once with `GAME_RETRY_NUDGE` (a stricter "the STOCK helped the HOLDER, never the reverse; never list a player's other holdings" reminder). If the retry still misattributes, it does NOT ship the prose — it falls back to `deterministicGameTemplate(facts)`, a Swift-built blurb assembled from the same anchors that can't get ownership wrong (carries the same `{{TICKER}}`/`{{user:id}}` placeholders so the fast tier still renders live pcts). This killed the recurring "Brian's holdings helped Kevin's MRVL"-style mash, which slipped through when the detector only logged. Two prompt changes cut how often the retry/fallback is even needed: the dump-prone full-roster "who owns what" block was removed (the model used to paste a player's entire ticker list from it), and a one-shot example now shows the correct stock→holder direction. The per-portfolio/per-holding paths still log-only via `logOwnershipViolations` (single-owner by construction, so misattribution there is rare).

**Per-window article caps (Phase 1 — prevents context-window errors).** Every window now caps the raw-article input via `ARTICLES_PER_WINDOW_CAP = [.d1: 15, .w1: 15, .m1: 20, .m3: 25, .y1: 24, .all: 25]`, sorted by `relevanceScore` desc. Combined with `DESC_TRUNCATE = 300`, the worst-case raw-article prompt stays under ~2.5 K tokens — safely inside Apple Intelligence's on-device + PCC routing limits no matter how newsy a period is. Before this cap, `.d1` and `.w1` returned ALL archived articles; newsy weeks for popular tickers (AMZN, AAPL with 100+ Yahoo articles per week) hit `Exceeded model context window size` errors.

**News lookback ≠ price window for short windows (added 2026-06-19).** `WindowKey.newsLookback(gameAge:)` returns **5 days for 1D, 10 for 1W** (long windows fall through to `effectiveLookback`); all three article loaders (`articlesForWindow`, `gameNewsArticles`, `portfolioArticlesForWindow`) use it. A 1-day lookback missed catalysts from a few days ago that still drive the price (a Thursday report a stock rides into Friday), making digests claim "no notable news" on a conspicuously-elevated stock. Each headline/fact now carries an `articleRecencyPhrase` tag ("reported today / yesterday / N days ago") and the game + 1D per-stock prompts tell the model to frame an older catalyst as "still riding/reacting to it" rather than as fresh news. The `ARTICLES_PER_WINDOW_CAP` still bounds prompt size after the wider pull.

**Hierarchical chain-of-summaries (Phase 2 — long-window quality + scalability).** For windows ≥ 1W the digest pipeline now consumes pre-summarized, cached intermediate layers instead of raw articles. Four-layer chain stored outside the repo at `~/StockDigests/`:

| Layer | Path | Generated from | When written |
|---|---|---|---|
| 0 — raw articles | `articles/{T}/{YYYY-MM-DD}.json` (existing) | Yahoo RSS + 2-stage filter | Every daily-tier fetch |
| 1 — daily summary | `summaries/{T}/daily/{YYYY-MM-DD}.json` | Layer 0 for that ticker + date | Daily tier auto-writes today's; chain lazy-writes others |
| 2 — weekly summary | `summaries/{T}/weekly/{YYYY-MM-DD}.json` (Mon of week) | 7 daily summaries | First time a 1M+ window needs the week |
| 3 — monthly summary | `summaries/{T}/monthly/{YYYY-MM}.json` | 4 weekly summaries | First time a 1Y / ALL window needs the month |

Each summary file is `{ ticker, key, summary, generatedAt, sourceCount, aiEngine }`. **Completed periods don't change**, so once written, every level reads from disk cache forever. Window-digest inputs map cleanly to one layer each:

- 1D → raw articles (still — small input, fine-grained detail desired)
- 1W → 7 daily summaries
- 1M → 4 weekly summaries + the current partial week's daily summaries
- 3M → 13 weekly summaries
- 1Y → 12 monthly summaries
- ALL → every monthly summary since 2026-02-05

**Cached-or-generate helpers** (`getOrGenerateDailySummary`, `getOrGenerateWeeklySummary`, `getOrGenerateMonthlySummary`) check disk cache first; on miss, generate by calling the layer below and chaining down. This is the "lazy backfill" behavior — the first 1M digest ever generated for a ticker triggers a chain that writes the 4 weekly summaries it needs, which in turn write the ~28 daily summaries those weeks need, all cached for next time.

**Cadence at steady state:**
- Daily tier (Mon–Fri): always generates today's daily summary first (~2 s × 45 tickers ≈ 2 min); then 1D digest from raw articles; then 1W digest from cached daily summaries. ~25-30 min total.
- Weekly tier (Sat): generates last week's weekly summary + any uncovered prior weeklies for 1M coverage; on the first Saturday of each month, also writes the prior month's monthly summary. ~10-15 min steady-state.

**Backfill cost** (one-time, the very first Saturday after Phase 2 ships): ~2-3 hours while the chain populates ~3 months of cache per ticker. After that single backfill the cache is built and every subsequent run is fast.

**Quality benefit for long windows:** 1Y and ALL go from "summarize top 24-30 raw articles from the period" to "synthesize 12 monthly summaries each built from 4 weekly summaries each built from 7 daily summaries each built from that day's articles." Every storyline of every week survives through the chain instead of being dropped at the article-count cap.

**Fallback:** if the chain returns no data (first-ever run for a new ticker, missing archive days, etc.), the dispatcher falls back to the legacy raw-article path with the Phase 1 caps, so windows always generate something.

## 4. Portfolio math (`lib/portfolio.ts`)

Every per-user portfolio value at date D is:

```
sum_over(t in user.tickers) [
  shares(user, t) * lastKnownClose(t, D)
  + dividends_received_since_start(t, shares(user, t), D)
]
+ for each spin-off where parent in user.tickers and effectiveDate <= D:
    parent_shares * ratio * lastKnownClose(child, D)
    + dividends_received(child, ..., D)
```

Where `shares(user, t) = perHoldingDollars(user) / tickerSeries.startClose`.

Functions exported:

| Function | Purpose |
|---|---|
| `lastKnownClose(series, date)` | Daily close at-or-before `date`, falling back to `startClose`. |
| `sharesFor(userId, series)` | Constant share count for a user's holding. |
| `dividendsReceived(series, shares, asOf)` | Σ of cash dividends paid on/before `asOf`. |
| `portfolioSeries(data, userId)` | Daily PortfolioPoint[] from `tradingDates`. |
| `intradayPortfolioSeries(data, userId)` | Today's intraday portfolio curve + previous-day-close baseline. |
| `intradayTickerSeries(series, intradayDate)` | Same shape, single ticker. |
| `weeklyPortfolioSeries(data, userId)` | Past 5-trading-day hourly portfolio curve (1W view). Returns `null` if no ticker has weekly data — caller falls back to filtered daily closes. Filters out Yahoo's live partial bar via `isHourBoundaryBar` so all points sit at clean hourly intervals. Trims to last 5 distinct trading days. |
| `weeklyTickerSeries(series)` | Single-ticker weekly hourly series; same filtering + trimming. |
| `analyzeRange(data, range)` | Per-user range-pct + per-ticker movers + global top gainers/losers. Now handles `1D` via prev-day close → latest intraday bar. |
| `rangeCloses(series, data, range)` | Single ticker's start/end close for a range. 1D = (prev-day close, latest intraday); other ranges = `lastKnownClose` at the range bounds. |
| `buildHoldingRows(userId, data)` | Holdings table rows for `PortfolioView`. Includes `rangeStats: Record<Range, {pct, dollars, endClose}>` per holding so the list reflects the active range, plus `name` (= `TickerSeries.name` from the snapshot) so the row shows the company name. |
| `buildFundHoldingRows(fund, data)` | Same `HoldingRow` shape for a fund's drill-down (`FundView`); shares from fund weights. Also carries `name` from the snapshot — fund-only tickers (not in `TICKER_NAMES`) rely on the Yahoo name `fetch-prices` now stores in `TickerSeries.name`. |
| `filterRange(points, range)` | Slice daily points to last N days; for 1D returns full set (caller substitutes intraday). |
| `rangeBounds(tradingDates, range)` | Start/end date strings of a range. 1D = (last-2 trading day, last trading day). |
| `sessionBoundsForDate(intradayDateUTC)` | UTC `[start, end]` for the extended US session (7:00 AM – 6:00 PM ET) on that date (DST heuristic). |
| `isMarketLive(intraday)` | True iff most-recent bar < 30 min old; naturally handles weekends/holidays. |
| `getMarketSessionState(now?)` | `"premarket" \| "open" \| "afterhours" \| "closed"` (DST-aware via IANA `America/New_York`; **holiday-aware** via `lib/market-calendar.ts` — full-closure holidays report `"closed"` all day, early-close half days use the 1:00 PM ET close). Drives theme + badge. |
| `isUsMarketOpen(now?)` | Backward-compat wrapper = `getMarketSessionState() === "open"`. |
| `marketHolidayName(now?)` / `marketEarlyCloseName(now?)` (in `lib/market-calendar.ts`) | Computed NYSE calendar. Return the holiday name on a full-closure day / the occasion name on a scheduled 1:00 PM ET half day, else `null`. Observance-aware (Sat→Fri, Sun→Mon), Good Friday via Easter, Juneteenth, day-after-Thanksgiving / Christmas Eve / July-3 early closes. Drives the `MarketStateBadge` callout. |
| `fmtUSD / fmtSignedUSD / fmtPct / fmtDateLong / fmtDateShort / fmtTimeOfDay` | Formatters. |

`STARTING_PORTFOLIO_DOLLARS = 100_000`.

## 5. App routes

```
/                          → Compare (home, server component)
/portfolio/{brian|kevin|rick|lee|gene}  → PortfolioView (per-player drill-down + comparison overlays)
/fund/{id}                 → FundView (per-fund drill-down: chart + overlays + holdings list)
/stock/{ticker}            → StockView (per-stock detail; one Position card per owner)
/stocks                    → StocksListView (all picks + active-fund holdings, filterable)
/tee-times                 → TeeTimesView (deep-link landing → Inshalla CC on foreUP)
```

Routes that read `config/funds.json` (`/`, `/portfolio/[user]`, `/fund/[id]`, `/stocks`) are `dynamic = "force-dynamic"` so a freshly-saved fund appears without a redeploy. `/stock/[ticker]` stays `force-static` (its `generateStaticParams` includes active-fund tickers via `activeFundTickers()` so fund holdings like F / TM get pages too).

**PortfolioView + FundView share one overlay engine.** `components/comparisonOverlays.ts` exports `useComparisonOverlays(...)` (builds the scaled-to-subject chart series + the sorted legend) and the `CompSeries` / `CompEntity` / `LegendRow` types; `components/OverlayLegend.tsx` renders the click-through legend. Both drill-down pages plot the subject's $ line plus any toggled-on comparison (other players → `/portfolio/{id}`, S&P 500, funds → `/fund/{id}`), each scaled to start at the subject's range-start $ so divergence reads as relative performance.

## 6. Components

```
app/layout.tsx        Root: <html>, metadata, dynamic SITE_URL from VERCEL_PROJECT_PRODUCTION_URL,
                      OG card, viewport, loads PriceData server-side to render Footer with
                      "data through" timestamp, mounts <PullToRefresh /> + <InstallHint /> + <TabBar />
                      + <ThemeController /> (calendar-driven: flips <html> between dark,
                      `data-theme="twilight"` for pre-market/after-hours, and
                      `data-theme="light"` during regular hours).

app/template.tsx      Route-transition wrapper (a `template.tsx` re-mounts on every
                      navigation, unlike `layout.tsx`). Drives the iOS-style page motion,
                      CSS-only — NO JS animation library. Top-level tab switches (Compare "/",
                      Stocks "/stocks", Tee Times "/tee-times") cross-FADE (.pt-fade). Drilling
                      INTO a detail route (/stock/*, /portfolio/*, /fund/*) PUSHes (slide in
                      from the right, .pt-push); backing OUT POPs (slide in from the left,
                      .pt-pop). Direction is chosen by comparing a module-level previous-path
                      against the path regex `/^\/(stock|portfolio|fund)\//`. Keyframes use
                      `animation-fill-mode: backwards` so NO transform lingers at rest — that's
                      DELIBERATE: several pages render position:fixed modals inline and a
                      lingering transform would re-root them. Honors prefers-reduced-motion via
                      the global guard in globals.css.

components/
  ScrubChart.tsx      Pointer-driven scrub chart. Props:
                        series: ChartSeries[]               (1 for a detail view; several in Compare — players + baseline + fund overlays)
                        baseline?: number                   (dashed reference line)
                        xDomain?: [Date, Date]              (force full-day axis for 1D)
                        liveEndpoint?: boolean              (pulsing concentric ring on last point)
                        compactX?: boolean                  (1W: index-based x-axis, gap-collapse)
                        onScrub?: (state | null) => void
                      `touch-action: none` on the SVG so vertical drift doesn't kill the gesture.
                      Reports scrub via parent-stable refs (no useEffect loop).
                      Two x-scale modes:
                        • time (default): `scaleTime` over the data's date range. Used by 1D
                          (with xDomain forcing the full session) and by daily-close ranges
                          (1M/3M/1YR/ALL).
                        • compactX: `scaleLinear` over [0, dates.length-1] — every data point
                          gets one equal-width slot regardless of timestamp. Used by 1W so
                          overnight + weekend gaps collapse and the line stays continuous,
                          Robinhood-style.
                      X-axis tick labels render along the bottom strip (PAD_BOTTOM=28 reserves
                      the space). `computeXTicksTime` picks 3–5 evenly distributed positions
                      with span-aware formatting (hour / weekday / month-day / month / month-year).
                      `computeXTicksCompact` places one label per trading-day boundary using
                      weekday-short ("Fri", "Mon"). The first and last labels are clamped
                      inward by `LABEL_EDGE_PAD` (12px) so the text doesn't hug the screen
                      edges. The data line / area / scrub still fill edge-to-edge.
                      Theme-aware colors via CSS vars: `--chart-baseline` (dashed 0% line),
                      `--chart-scrub-line` (vertical scrub crosshair), `--chart-axis-label`
                      (tick text). All flip with `data-theme` on `<html>`.
  RangeTabs.tsx       1D / 1W / 1M / 3M / 1YR / ALL. 1D is the leftmost.
  TabBar.tsx          Bottom nav, fixed. Three tabs: Compare, Stocks, Tee Times. Each tab uses
                      flex-1 so they distribute evenly. Tee Times icon is a golf ball on a tee.
                      (Per-user tabs were removed when Rick + Lee landed; jump into a portfolio
                      via the Compare leaderboard.)
  HeaderBack.tsx      Sticky top bar with "< Compare" back button (router.back).
  PriceHeader.tsx     Big number + signed delta + % vs baseline; optional ticker label and scrub date.
  Footer.tsx          "Data through {date}" + "Snapshot generated {ts}". Pulled from PriceData.
  InstallHint.tsx     iOS-Safari-only top banner: "Add to Home Screen". localStorage dismiss.
  Sheet.tsx           Reusable iOS bottom-sheet primitive (the shared replacement for the
                      hand-copied modal shells). Portals to document.body so it's immune to
                      ancestor transforms (matters now that route transitions apply transforms
                      up the tree). CSS slide-up open (.sheet-panel / sheetIn keyframe); a
                      "closing" state slides it back down (.is-closing / sheetOut) then unmounts
                      on animationend. Partial CONTENT-HEIGHT detent by default; a `full` prop
                      gives full height (for forms; adds top safe-area padding). Grab handle,
                      optional custom-header slot, optional `footer` slot (pinned action bar
                      below the scroll area — Back/Next/Save rows for form sheets),
                      role=dialog + aria-modal, body-scroll lock, Escape-to-close. NO
                      drag-to-dismiss — close via backdrop tap / Done / Escape. Converted so
                      far: FilterSheet (components/FundsFilter.tsx), WhatsNew, CreateFundModal,
                      EditThesisModal (the latter two as `full` sheets with `footer`). STILL on
                      its own hand-rolled shell (not yet migrated): ManageFundsSheet.
  WhatsNew.tsx        "What's new" pill (top-right of the Compare header — bell icon + label;
                      turns green-tinted with an unread dot when there's an unseen update)
                      + slide-up sheet (now rendered via the shared <Sheet> primitive; no
                      longer a hand-copied modal shell). Lists major user-facing updates from
                      the last 30 days, sourced from `lib/changelog.ts` (`recentEntries()`).
                      Each card expands inline to a plain-language explanation of the feature
                      and how to use it — the accordion is now a CSS `grid-template-rows`
                      0fr↔1fr transition (moved OFF framer-motion). An unread dot (—gain green)
                      shows when the newest entry is more recent than the localStorage
                      `stockgame.whatsNewSeen` marker; opening the sheet marks all current
                      entries seen. Escape / backdrop / Done all dismiss; body scroll locks
                      while open (handled by <Sheet>). The bell + close get .press tap
                      feedback. Respects prefers-reduced-motion (now via the global guard).
  PullToRefresh.tsx   Two refresh paths in one client component:
                        (a) Pull at scrollY=0, drag past 70px, release → location.reload()
                        (b) Visibility change: if hidden > 60s and becomes visible → reload
                      Touches that start inside an <svg> or [data-no-ptr] element are ignored
                      so chart scrubbing isn't hijacked.
  MarketStateBadge.tsx  Four-state badge driven by `getMarketSessionState()`: "● Market open"
                        (green, pulsing), "● Pre-market" / "● After hours" (indigo, pulsing),
                        or "● Market closed" (zinc). Renders "Last updated HH:MM" inline
                        next to it (from `data.generatedAt`). On a full-closure holiday or a
                        scheduled 1:00 PM ET half day, also renders an amber callout line below
                        ("Markets closed today for Juneteenth …" / "Half day — markets close
                        early at 1:00 PM ET …"), driven by `marketHolidayName` /
                        `marketEarlyCloseName`. Polls every 60s. Only shown on the 1D view
                        (rendered alongside `isIntraday`).
  ThemeController.tsx   Client-only. Sets `<html data-theme="light">` during regular hours,
                        `data-theme="twilight"` during pre-market / after-hours, and clears the
                        attribute (dark default) overnight/weekends. Driven by
                        `getMarketSessionState()` — DST-aware calendar check, no snapshot data.
                        Re-evaluates every 60s so the page flips at session boundaries without
                        a manual reload.
  TeeTimesView.tsx      Tee Times tab. Three sections:

                        1. Deep-link landing for foreUP booking. Quick Book card (Today /
                           Tomorrow / day-after) + "View all available times" CTA + "Call pro
                           shop" tel: link. Every booking link is a deep link with
                           ?booking_class_id=2431&schedule_id=2251&date=MM-DD-YYYY so users
                           land directly on Daily Golf without the chooser. We do NOT scrape
                           foreUP's API or HTML — their TOS §3.2.v prohibits crawling and
                           their robots.txt disallows automated agents. URL crafting against
                           query params their SPA itself respects is normal browser behavior.

                        2. Daily Deals tap-through card. Single tap target → opens Sagacity
                           Golf's official Daily Deals widget for Inshalla
                           (https://inshalla.dailydeals.golf/widget/layout/2/times) in a new
                           tab. Earlier tried embedding the widget inline as an iframe (it's
                           an explicit partner-embed product — CORS=*, no X-Frame-Options,
                           the widget's footer literally markets "Add Daily Deals to your
                           website"), but the fixed-height iframe didn't size cleanly inside
                           our card chrome. Hand-off matches the rest of the page's pattern
                           and stays visually consistent. utm_source=stockgame-app stays in
                           the URL for analytics attribution.

                        3. Phone tap-through. `tel:+17154533130` → iOS dialer with the pro
                           shop number pre-filled. Number sourced from Inshalla's profile in
                           the foreUP booking page (public info; published on inshallacc.com).

                        4. Disclosure + bare foreUP shortcut.

                        If you ever get written permission from Inshalla's pro shop or foreUP
                        to display schedule data natively, the proxy + native-list pattern
                        is preserved in git history at commits 360e810..3326d72 and
                        documented in docs/embedding-third-party-booking.md §1–§7.

  GameSummaryPanel    The DigestPanel reused on `/`, fed by `useDigests().getGameDigest(range)`.
                      Sits between the leaderboard and InsightsCard. Three sentences
                      explaining who's leading and why, who's lagging, and what to watch —
                      grounded in actual portfolio percentages from prices.json (the digest
                      pipeline ports analyzeRange to Swift to compute standings, then the
                      LLM is given the standings + top-relevance articles as context).
  CompareView.tsx     Home view. Defaults to 1D. One line per player, ALL ranges normalized
                      to (value - baseline) / baseline so every line starts at y=0 and the
                      visual order matches the leaderboard ranking. baseline=0 dashed line
                      gives the 0% reference. Headline: "{leader} leads" or "It's a tie".
                      Range pct + signed gain-difference gap below. Leaderboard renders as
                      a sports-standings style stack of <UserRow>s (rank + color dot + name
                      + gap + value), scales to N players automatically. InsightsCard renders
                      for every range (1D included). The "Compare" eyebrow row carries a
                      <WhatsNew /> pill on its right edge (recent-updates sheet).
                      Three data-source paths in `ranged`:
                        • 1D → intraday[u.id].points (15-min bars, today's session)
                        • 1W → weekly[u.id] (hourly bars, past 5 trading days; compactX=true)
                        • else → filterRange(series[u.id], range) (daily closes)
                      An additional non-clickable S&P 500 row + line is appended to the chart
                      and leaderboard when SPY data is present in the snapshot (props
                      `baselineDaily` / `baselineIntraday` / `baselineWeekly`). It uses the
                      same data-source rules as the player paths (intraday / weekly-hourly /
                      filtered-daily). UserRow renders a plain <div> instead of <Link> when
                      `href` is null — that's the only structural difference from a player
                      row. If SPY's weekly bars are missing while player weeklies are present
                      the view falls back to daily closes for 1W so all lines share the same
                      x-axis treatment (compactX is only enabled when every line has weekly
                      data, baseline included).
                      The synthetic Combined Players fund rides through the same fund
                      machinery as user funds (default-OFF chip / chart line / leaderboard
                      row). Below InsightsCard the page renders <PortfolioComposition /> a
                      second time — fed the combined fund's composition (server-computed by
                      `buildCombinedComposition` in lib/portfolio-composition.ts) with
                      title="Combined breakdown" / aboutTitle="About the combined
                      portfolio" and the combined fund's slate accent.
  PortfolioView.tsx   Per-user. Defaults to 1D. PriceHeader + ScrubChart + RangeTabs +
                      DigestPanel (portfolio-rollup digest, between RangeTabs and Holdings)
                      + Holdings list.
                      Each holding row has id={ticker} so /portfolio/X#TICKER deep-links.
                      In 1D mode: chart is intraday $, baseline = previousClose, xDomain = session.
                      In 1W mode: chart is weekly hourly $; compactX=true collapses overnight
                      + weekend gaps; weekly series falls back to filtered daily closes if no
                      weekly data is present (older snapshots).
                      A gray S&P 500 comparison line is added to the chart whenever SPY data
                      is in the snapshot, SCALED to share the player's range-start dollar
                      value (scale = playerStart / baselineStart) so the two lines start at
                      the same anchor and divergence reads as relative performance. The
                      player's EXCESS return over the benchmark (playerPct − baselinePct) is
                      surfaced in PriceHeader as a "+X.XX% vs S&P 500" sub-row (via its new
                      optional `compareTo` prop) — same gray dot, green/red pct coloring.
                      Sign-first labeling: the pct describes the PLAYER's relative
                      performance, not the benchmark's absolute return; reading "vs S&P 500
                      +5.60%" instead of "+5.60% vs S&P 500" was the original (buggy) order
                      and made every player's row show SPY's own pct — fixed by inverting
                      the math + label order. Lookup of the scrubbed baseline $ uses
                      `scrub.index` against the raw baselineRanged series rather than
                      scrub.values (which would report the scaled chart value); the
                      displayed pct is identical either way (scaling cancels) but the
                      indirection is clearer this way.
                      Holding rows show pct + signed $ for the ACTIVE range (read from
                      `holding.rangeStats[range]`) and re-sort by that range's pct.
                      Below the Holdings list: <PortfolioComposition /> — the interactive
                      donut breakdown (Sector / Industry / Market cap tabs) + a
                      "Claude analysis" About-this-portfolio card. Server-computed
                      composition is passed in via `composition` prop (see
                      `lib/portfolio-composition.ts`).
  PortfolioComposition.tsx  Bottom-of-portfolio donut chart + "About this portfolio"
                      analysis card. Three views via pill toggle: Sector / Industry /
                      Market cap. Donut + slice list/detail come from the shared
                      <BreakdownDonut> module. Donut is raw SVG arc paths with framer-motion pop-out +
                      dim animation on slice select; center readout shows total $ + # of
                      positions, or the selected slice's $ + portfolio share. Below the
                      donut: a list of slices with mini-bars + portfolio %s; selecting a
                      slice swaps the list for a per-ticker breakdown (each row is a Link
                      to /stock/{ticker}). Bottom card is the "Claude analysis" panel —
                      static style chip + headline + 1 paragraph (with "Read full
                      analysis" expand for 2 more) + theme chips. Intentionally
                      number-free: no percentages, dollar amounts, or concentration
                      metrics — it's the editorial layer about WHAT each player is
                      investing in (themes, types of companies). The donut + breakdown
                      list above handle the live numerical side. Narrative lives in
                      `PER_USER_ANALYSIS` in lib/portfolio-composition.ts (hand-written
                      per UserId, edit there to change wording).
  StockView.tsx       Per-ticker. PriceHeader + ScrubChart + RangeTabs + DigestPanel + N
                      Position cards (one per owner) + Dividends list (per-share, market-level).
                      DigestPanel sits between RangeTabs and the Position cards and re-renders
                      with the active range — exactly the slot where Robinhood shows news on
                      the stock detail screen. Default range on this view is ALL (the other
                      views default to 1D), so the first thing the user sees is the
                      game-to-date briefing.
                      In 1D: same intraday treatment as PortfolioView.
                      In 1W: same weekly hourly + compactX treatment as PortfolioView.
                      Force-scrolls to top on mount (skips on hash) so tapping a holding
                      from a scrolled portfolio view doesn't land mid-page.
  StocksListView.tsx  All picks sorted by % return. Filter chips: All / Brian / Kevin / Rick / Lee / Gene.
                      Multi-color owner swatch when a ticker is held by 2+ users.
  DigestPanel.tsx     News-digest card composed on /stock/[ticker], /portfolio/[user], and the
                      Compare home view. Position varies per page (between RangeTabs and Position
                      cards on stock detail; between RangeTabs and Holdings on portfolio; ABOVE
                      the leaderboard on Compare — narrative cause before the consequences).
                      Robinhood-style collapsible: 3-line clamped prose by default with "Show
                      more"; expanded view reveals the full digest, a meta strip (range label ·
                      date range · article count · "Updated HH:MM"), and a Sources section
                      (up to 6 article titles linking to the originals). The
                      "⬡ Summarized by Apple Intelligence" attribution is inlined on the
                      header row (right side, next to the "DAILY BRIEFING" label) so it's
                      always visible without expanding the card.
                      Signal-quality dot at the left edge: green if avgRelevanceScore ≥ 8,
                      yellow if 6–7. Three render branches:
                        • digest=null OR no entry for ticker → renders nothing (zero noise)
                        • dataMaturity="insufficient" → dashed-border placeholder with
                          countdown ("Monthly digest available after ~29 more days")
                        • full / partial → the populated card; "Partial" caps badge appears
                          in the header for partial-maturity windows
                      Reads via `useDigests()` hook in `lib/digests.ts` — module-level cache
                      so /digests.json is fetched once per session even across stock-page
                      navigations.
                      Component is data-pure: takes `digest: WindowDigest | null` as a prop
                      directly, plus `loading` + `range`. StockView (via `getDigest`),
                      PortfolioView (via `getPortfolioDigest`), and CompareView (via
                      `getGameDigest`) all compose it.
  FundamentalsPanel.tsx
                      About / Financials / Earnings sections for /stock/[ticker]. Fed by
                      `public/data/fundamentals.json`. About card has a 2-col key-stats grid
                      (Market cap, P/E, Forward P/E, EPS, 52-week range, Beta, Div yield,
                      Sector, Industry, HQ, Employees, Exchange, Website) plus collapsible
                      company description. Financials chart is grouped bars (Revenue / Gross
                      profit / Net income) with a Net margin overlay line on its own
                      scaled y-range; Quarterly / Annual toggle; solid theme-aware zero
                      reference line on the y=0 axis when the domain spans both signs;
                      "Show numbers" button expands a per-period card stack with the exact
                      figures (net-margin can be 4-digit-% for unprofitable companies, not
                      readable from the chart). Earnings chart is per-quarter scatter:
                      lighter-bigger Estimate dot drawn first, brand-green Actual dot drawn
                      on top — when they overlap the lighter ring frames the actual; when
                      they stack vertically the surprise reads as the gap. No
                      Quarterly/Annual toggle on Earnings (annual rollup was ambiguous for
                      partial-year companies and the cadence is quarterly anyway). Y-domain
                      clamps to always include 0 so all-negative-EPS companies get a visible
                      breakeven line at the top. "Show numbers" mirror the Financials table
                      with Estimate / Actual / Surprise. Inner per-period cards use
                      `bg-zinc-800/40` so the theme-flip from globals.css renders readable
                      contrast in dark / light / twilight modes.
  InsightsCard.tsx    "What's driving it" — per-user cards showing top-3 / bottom-3 movers in
                      the active range. Cards re-sort by leaderboard rank for the active range.
                      Card header (user name + pct + place) links to /portfolio/{owner}.
                      Mover rows: TICKER + per-share price next to small name on the left;
                      pct% + per-share point delta (signed $, e.g. "+$11.60") on the right.
                      Each row links to /stock/{ticker}.
```

## 7. Chart UX details

- Visx `LinePath` + `AreaClosed` with `curveMonotoneX`.
- `ParentSize` provides responsive width.
- Pointer events (not touch events). On `pointerdown` we call `setPointerCapture` so the SVG owns the gesture even if the finger leaves the element.
- `touch-action: none` on the SVG. Prevents iOS Safari from stealing the gesture for page scroll mid-scrub. Page still scrolls normally above and below the chart.
- Scrub state lifted to parent via `onScrub` callback (refs avoid the React 19 update-loop bug).
- `liveEndpoint` draws two concentric circles at the most recent point; ring expands and fades (`livePulseRing` keyframe), fill brightness oscillates (`livePulseFill`).
- Compare (all ranges): `chartSeries.data` is normalized to fractional pct from the range's baseline so every line starts at 0% and the line order matches the leaderboard. Stats rehydrate the dollar value by indexing back into the raw `ranged[u.id]` points by `scrub.index`. baseline=0 is passed for the dashed reference line on every range.
- `xDomain` overrides Visx auto-domain; for 1D we pass `sessionBoundsForDate(intradayDate)` which returns `[07:00 ET, 18:00 ET]` as UTC dates (extended session, pre-market through after-hours), with a coarse DST heuristic (Mar–Nov = EDT).
- `compactX` switches to an index-based x-scale (one slot per data point) so the 1W view's overnight + weekend gaps disappear. Pointer-handler branches: in compactX mode the inverted x is rounded to the nearest data slot; in time mode the existing bisector logic runs. Tick computation also branches (`computeXTicksTime` vs `computeXTicksCompact`).
- X-axis tick labels: `--chart-axis-label` CSS var (rgba(255,255,255,0.4) dark / rgba(24,24,27,0.55) light). First and last labels are clamped inward by `LABEL_EDGE_PAD` (12px) so the text doesn't hug the screen edges. The data line / area / scrub still extend edge-to-edge.

## 8. Data refresh pipeline

```
[Mac mini]  scripts/stockgame_schedule.py (tkinter)
   │           Two threading.Timers run side-by-side:
   │             • Price refresh (configurable interval, default 15 min,
   │               default window 3:00 AM–7:00 PM CT = pre-market through
   │               after-hours in ET) → cron-update.sh
   │             • Daily digest (once per weekday at the configured time,
   │               default 7:00 AM CT before regular market open)
   │               → digest-update.sh
   │           "Weekdays only" checkbox (default on) skips Sat/Sun for both
   │           timers — leave the UI on Schedule Run through the weekend.
   │           caffeinate prevents the Mac from sleeping while open.
   ▼
[shell]    scripts/cron-update.sh    (defensive — see below)
   ├─ pause-file gate                 → exits 0 if scripts/.pause exists
   ├─ branch guard                    → exits 0 unless current branch is main
   ├─ git fetch + git pull --rebase   → reconciles with anything the laptop pushed
   │     --autostash protects WIP        (post-rebase SHA captured for diff)
   ├─ conditional npm install         → fired ONLY if package-lock.json or
   │                                     package.json changed in the rebase, or
   │                                     node_modules is missing
   ├─ npm run fetch-prices            → updates public/data/prices.json
   │     - incremental: only refetches trailing 5 days per ticker
   │     - --full: re-fetches everything from START_DATE
   │     - also pulls today's 15-min intraday bars + past 8 days of 1h
   │       hourly bars (for the 1W view) + dividend events
   │     - resilience: daily fetch retries 2× (2s/8s backoff); a ticker that
   │       still fails is CARRIED-FORWARD (previous series kept, intraday/
   │       weekly dropped) instead of aborting; the run aborts only if >25%
   │       of the roster fails (Yahoo-outage signal). validatePriceData()
   │       refuses to write a snapshot that loses history, changes any
   │       startClose, or drops a roster ticker — a bad run leaves the
   │       last-good file untouched, so cron commits nothing.
   ├─ JSON-parse gate on prices.json  → refuses to stage a partially-written
   │                                     file (crash mid-write, disk full)
   ├─ if public/data/prices.json changed:
   │     git add public/data/prices.json   (stages ONLY the data file —
   │                                         unrelated WIP never auto-commits)
   │     git commit -m "data: ISO_TS"
   │     git push                            → triggers .githooks/pre-push
   │                                          (data-only path → skips build)
   │                                          → triggers GitHub webhook
   │                                          → triggers .github/workflows/build.yml
   │
   └─ NO direct vercel deploy        → relies on the GitHub→Vercel webhook to
                                       redeploy. If the webhook ever breaks
                                       again, re-add `vercel deploy --prod
                                       --yes` to the end of cron-update.sh
                                       (one-line restoration).

[GitHub]   webhook notifies Vercel on every push — but `vercel.json`
           `ignoreCommand` (scripts/vercel-ignore-build.sh) SKIPS the build
           when only public/data/*, public/digests.json, config/funds.json,
           or config/thesis.json changed since the last deployed SHA
           (VERCEL_GIT_PREVIOUS_SHA, fetched explicitly since it falls
           outside the shallow clone; fails open to building). Data commits
           therefore do NOT redeploy — the app doesn't need them to.
[CI]       .github/workflows/build.yml runs `npm run build` on PRs and
           pushes to main. Required status check for branch protection.

[Vercel]   serving (no rebuild needed for data)
   │           pages are force-dynamic; lib/data.ts / lib/fundamentals-data.ts /
   │           lib/digests-data.ts (behind /api/digests) read the latest commit
   │           on origin/main via the GitHub Contents API (raw media type) at
   │           request time — 60s TTL in-process cache, stale-on-error, then
   │           filesystem-snapshot fallback (dev / build / GitHub outage).
   │           Requires GITHUB_TOKEN / GITHUB_OWNER / GITHUB_REPO on Vercel
   │           (already set for the funds CRUD). lib/remote-json.ts is the
   │           shared loader.
   │           Cache-Control: no-cache, no-store, max-age=0, must-revalidate (set in next.config.ts)
   ▼
[iPhone]   PWA refreshes on next tap
   - no-store on every document + data route, so each cold open fetches fresh
     HTML (defeats iOS webclips serving a stale cached snapshot without
     revalidating). /_next/static/* JS+CSS keep immutable caching.
   - PullToRefresh does router.refresh() in place (spinner via useTransition);
     resume after >60s hidden refreshes silently; >12h hidden does one hard
     reload to pick up new bundles; a 3-min poll refreshes while visible
     during market hours. Client digests refetch via /api/digests on a 5-min
     TTL (lib/digests.ts).
```

End-to-end refresh latency: data is live ≈ **60–90 s** after the mini's push
(no build in the path — push ~2 s + ≤60 s loader TTL). Code deploys still
take the old ~50 s build path.

### Daily digest pipeline (separate from the price cron)

```
[Mac mini, 7am CT daily via launchd]
   │
   ▼
[swift] scripts/digest.swift
   ├─ Apple Intelligence availability check (SystemLanguageModel.default.availability)
   │     unavailable → exit 0 silently; previous digests.json keeps serving
   ├─ engine: prose summaries → PCC via `fm serve` (pccServeRespond, model=pcc),
   │     on-device fallback; relevance scorer stays on-device. AIEngine.resolve()
   │     picks the on-device fallback — see "AI engine selection" below
   ├─ for each ticker (fanned out via mapConcurrent; prose ≤DIGEST_PCC_CONCURRENCY
   │     via PCCGate, on-device ≤DIGEST_AI_CONCURRENCY via AIGate):
   │     1. fetch RSS from finance.yahoo.com (per-ticker URL)
   │     2. Stage 1 keyword filter (pure Swift, instant)
   │            hard-reject: "arrested", "charity", "obituary", "sports", …
   │            hard-accept: "earnings", "merger", "ceo", "fda", "analyst", …
   │     3. Stage 2 Apple Intelligence relevance scoring (1–10, threshold ≥6)
   │            fresh LanguageModelSession per article; JSON-asking prompt
   │     4. dedupe by `link` against archive
   │     5. write archive: ~/StockDigests/articles/{TICKER}/{YYYY-MM-DD}.json
   │     6. for each window (1D / 1W / 1M / 3M / 1Y / ALL):
   │            sample top-N by relevance, generate 3-sentence prose digest
   │            (fresh session per window; window-specific prompt framing)
   ├─ for each player (brian / kevin / rick / lee / gene; also fanned out via
   │     mapConcurrent), for each window:
   │     7. read public/data/prices.json — compute the player's per-ticker
   │        movers via computeUserMovers (shares × price delta) ranked by
   │        $ contribution; pick the top 3 + bottom 3 drags as the
   │        "relevant tickers" for this window
   │     8. pull articles from the archive ONLY for those relevant tickers,
   │        capped at 2 per ticker (≤12 total) — replaces the old "top-N
   │        by relevance across all the player's tickers" pool which
   │        misattributed dominance to whichever holding had the loudest
   │        press regardless of actual P&L impact
   │     9. inject a STANDINGS block at the top of the prompt listing top
   │        movers + drags with $ contribution, % delta, and end price.
   │        Articles are tagged [TICKER/owners] inline. The 3-sentence
   │        contract is: (1) name the holding that drove the portfolio +
   │        cite $ from STANDINGS, (2) name the news catalyst from the
   │        archive, (3) name the biggest drag + risk to watch
   │
   ├─ for each window (Phase 3), generate game-wide leaderboard analysis:
   │     10. reuse the same prices.json port + computeStandings (which
   │         now delegates to computeUserMovers internally)
   │     11. format a STANDINGS block + pull top 15 articles from the
   │         archive (each tagged [TICKER/owners])
   │     12. generate 3-sentence prose grounded in the live percentages,
   │         naming players + tickers + catalysts. Prompt ends with an
   │         explicit "PLAYERS section is the only source of truth"
   │         guard so the model never invents ownership
   │
   └─ write public/digests.json
        - holdings: 45 tickers × 6 windows
        - portfolios: 4 users × 6 windows
        - game: 6 windows
        - ~600 KB total
```

The launchd plist (to be installed at `~/Library/LaunchAgents/com.stockgame.digest.plist`) runs `digest.swift` then chains to `cron-update.sh` so the same git-pull/commit/push machinery picks up `digests.json` and triggers the GitHub→Vercel webhook. No separate sync script needed.

End-to-end runtime: ~12 minutes for 45 tickers from cold archive (scaled from earlier 29-ticker / ~8 min benchmark; HON 13s test: fetch + 2-stage filter + 3 mature digests).

`scripts/digest.swift` flags:

| Flag | Effect |
|---|---|
| (no args) | full pipeline, all 45 tickers, default `~/Repos/stock-game/public/digests.json` |
| `HON AAPL ...` | restrict to listed tickers |
| `--check` | probe on-device + Private Cloud Compute availability/usability, print the selected engine, and exit |
| `--dry-run` | fetch + filter + score; write nothing |
| `--verbose` | log per-article filter decisions |
| `--fetch-only` | fetch + archive, skip digest generation |
| `--digests-only` | regenerate digests from archive without re-fetching |
| `--output PATH` | override the JSON destination |
| `--scope fast\|daily\|weekly\|game\|finalize\|backfill` | which slice of the pipeline runs (see §8.6 in CLAUDE.md) |

**`--scope backfill`** is a one-time PCC cache rebuild: it regenerates the `~/StockDigests` summary chain (daily→weekly→monthly→brief) on PCC, sequentially (concurrency ~1), with strict PCC (failed call skips the write rather than poisoning the cache), a hard-stop after `BACKFILL_ABORT_AFTER` (default 5) PCC failures, and per-ticker resume markers under `~/StockDigests/.backfill-done` (`BACKFILL_RESET=1` clears them; `BACKFILL_TICKERS=AAPL,MSFT` scopes it). It writes only the cache, never `digests.json`, and is sized to stay within PCC limits + not starve the MLR moderation sharing the same `fm serve`.

`scripts/digest-update.sh` honors a `DIGEST_MODE` env var: `full` (default — RSS fetch + Stage-2 scoring + digests) or `digests-only` (skip the slow article-fetch path, regenerate from the existing archive in ~8 min). The scheduler UI sets this via the "Skip article fetch" checkbox.

### AI engine selection (PCC vs on-device) — macOS 27

> **⚠ INTERIM (2026-07-13): on-device DISABLED — `DIGEST_ONDEVICE=off`.**
> macOS 27 Beta 3 (installed 2026-07-07) regressed on-device FoundationModels:
> any on-device generation (`LanguageModelSession` / `SystemLanguageModel`)
> SIGTRAPs on an uncatchable `_assertionFailure` inside the framework, killing
> every daily briefing run since 7/08 (identical crash stacks in fm-service and
> the interpreted digest.swift). PCC via the Terminal-hosted `fm serve` still
> works, so: `digest-update.sh` exports `DIGEST_ONDEVICE=off` by default and
> preflights `fm serve` (curl `$FM_SERVE_BASE/v1/models`; if down, launches
> `fm serve --port 8799` in Terminal via osascript and polls up to 60s; if
> still down it logs loudly and continues — the swift side then throws per
> call and skips that prose instead of crashing). Under `off`, digest.swift
> never constructs/probes ANY in-process model: `AIEngine.resolve()` returns a
> `pccServeOnly` state (log line: `on-device disabled (DIGEST_ONDEVICE=off) —
> PCC via fm serve only`), `aiRespond` is PCC-serve-only and THROWS on failure
> (no on-device fallback), `aiRespondStructured` throws immediately, the
> `--check` probes and the startup `SystemLanguageModel.default.availability`
> guard are skipped, and **the relevance scorer temporarily runs on PCC** via
> its text+`parseScoreJSON` path (`preferPCCServe: true`) — higher PCC quota
> usage, and MLR moderation shares the same `fm serve`; a failed scoring call
> fails open (article kept, unscored). `DIGEST_ONDEVICE=auto` (in-code
> default) = exact pre-Beta3 behavior described below. **Revert once an Apple
> beta fixes on-device generation:** remove the export + preflight block in
> `digest-update.sh` and this note.

`digest.swift` runs entirely on Apple Intelligence. macOS 27's FoundationModels
exposes two models, both reached over Apple's privacy-preserving path (neither
is a third-party cloud, so the "Apple Intelligence is the only engine"
invariant holds):

- **On-device** (`SystemLanguageModel.default`) — the pre-27 model, ~4k-token
  context. This is the reason the pipeline summarizes hierarchically (facts →
  daily → weekly → monthly) and caps per-window article counts.
- **Private Cloud Compute** (`PrivateCloudComputeLanguageModel`, new in 27) —
  larger context window + deeper reasoning. Preferred when usable.

**How PCC is reached (updated 2026-06-18).** There are two ways to reach PCC,
and only one works from the Mac mini's CLI:
- **In-process** (`PrivateCloudComputeLanguageModel`) — entitlement-gated; a
  bare `swift digest.swift` run hits `ModelManagerError 1046` on every
  generation. `AIEngine.resolve()` still probes this once at startup and, since
  it fails from the CLI, resolves to **on-device** — which is now the *fallback*
  engine, not the primary.
- **`fm serve`** (the path the pipeline actually uses) — Apple's
  OpenAI-compatible local HTTP endpoint, hosted in a foreground Terminal/Login-
  Item GUI context (see `APPLE_PCC.md`), which reaches PCC on our behalf.

**All prose summaries run on PCC via `fm serve`.** The central helper
`aiRespond(_:reasoning:preferPCCServe:)` calls `pccServeRespond` — a `POST` to
`FM_SERVE_URL` (default `http://127.0.0.1:8799/v1/chat/completions`) with
`model=pcc` and the tier's temperature — and only falls back to the in-process
on-device model if `fm serve` is unreachable or PCC errors mid-run. So facts
extraction, daily/weekly/monthly summaries, company briefs, and per-stock /
portfolio / fund / game window digests all run on the larger PCC model (this is
what fixed the vague, "generic"-padded on-device summaries). All AI stays inside
Apple — `fm serve` is Apple's own binary talking to Apple's PCC; no third-party
API, no per-use cost. `SUMMARY_ENGINE=on-device` (or the legacy
`GAME_SUMMARY_ENGINE`) forces the whole prose pipeline back on-device.

**The relevance scorer stays on-device.** `scoreArticleAI` is a high-volume,
temperature-0 per-article filter (hundreds of calls per run), not a summary, so
it runs on-device for speed + determinism; its rare text-fallback passes
`preferPCCServe: false`. It calls `aiRespondStructured` with a `GenerationSchema`
(built once as `RELEVANCE_SCHEMA` from `DynamicGenerationSchema`) and reads typed
`score` / `reason` via `GeneratedContent.value(_:forProperty:)` — structured
output stays in-process (no JSON-schema `response_format` over `fm serve`). The
runtime `DynamicGenerationSchema` API is used deliberately — the `@Generable`
*macro* does **not** work under the interpreted `swift digest.swift` (its
`FoundationModelsMacros` compiler plugin ships only with Xcode). If schema
construction or the structured call fails, the scorer falls back to the original
prompt-for-JSON + `parseScoreJSON` path, so it can never regress.

**Generation options.** `temperatureFor(_:)` sets **0.0** for `.standard`
(deterministic classification/extraction) and **0.4** for `.deep` (prose) —
passed to PCC over `fm serve` and applied identically on the on-device fallback.

`DIGEST_ENGINE` still overrides the in-process probe (`auto` default / `on-device`
/ `pcc`), but since prose now goes through `fm serve`, the knob that matters
day-to-day is `SUMMARY_ENGINE`. The `aiEngine` field stored in `digests.json`
stays `"AppleIntelligence"` regardless (PCC *is* Apple Intelligence; the frontend
keys attribution off that exact string); the engine actually used per call is
logged to `/tmp/stock-game.log`. **Operational dependency:** `fm serve` must be
running (Login Item on the mini, else started manually in Terminal); if it's
down the pipeline fails open to on-device, so a digest always ships.

**AI concurrency (macOS 27).** The three per-item phases — tickers, portfolios,
funds (plus the game pass) — fan out via `mapConcurrent` instead of serial `for`
loops (phases still run in order; tickers cache the daily summaries that
portfolios/game read, and output order is preserved). Each prose call self-gates
by engine: **PCC calls go through `actor PCCGate`, on-device calls through
`actor AIGate`.** PCC runs in the cloud, not on the mini's 8 GB of RAM, so its
cap is wider — `DIGEST_PCC_CONCURRENCY` (default **8**) vs `DIGEST_AI_CONCURRENCY`
(default **4**, the memory-bound on-device limit; `1` = serial). A failed PCC
call hands its slot back *before* the on-device fallback acquires an AIGate slot,
so the two gates are never held at once and can't deadlock. The structured
scorer uses AIGate (on-device).

The price refresh pipeline (`cron-update.sh`) and the digest pipeline (`digest-update.sh`) are allowed to run **concurrently**. They stage different files (`public/data/prices.json` vs `public/digests.json`), so they never conflict in the working tree. **Only `cron-update.sh` pushes to `origin/main`** — `digest-update.sh` just commits locally and lets the next 15-min refresh push it along with whatever fresh prices were captured. This eliminates the push race entirely (one publisher, no contention). Trade-off: a manual `Run Briefing Now` on a day when the refresh isn't firing (paused / weekend with weekdays-only on) leaves the digest commit unpushed until the next refresh; `git push` from the repo dir resolves it. The Python scheduler reflects the concurrency with two independent locks (`refresh_lock` + `digest_lock`); a long digest run never blocks the 15-min stock refresh.

### Pause / resume the cron without closing the UI

```bash
touch scripts/.pause   # halts; cron-update.sh exits 0 immediately on next run
rm scripts/.pause      # resumes
```

### Branch protection (configured in GitHub UI per `docs/branch-protection.md`)

- Branch protection rule on `main`:
  - Require PR before merging
  - Require status check `build` to pass
  - Require branches up-to-date before merging
  - Bypass list: `btheis15` (so the Mac mini's data-only auto-pushes still go through)
- Day-to-day from the laptop: feature branch → PR → CI build green → merge → webhook deploys.
- Day-to-day on the Mac mini: the script rebases, pushes data commits, pre-push hook detects "data-only" and skips the local build for speed.

### .githooks/pre-push

Activated per clone with `git config core.hooksPath .githooks`. Two jobs:

1. **Auto-rebase onto `origin/main`** if local has fallen behind (Mac mini's
   data commits land all day; this prevents non-fast-forward push rejections
   on the laptop without the user having to remember `git pull` first). Uses
   `git pull --rebase --autostash origin main`. Skipped silently on network
   failure so offline pushes still proceed normally.
2. **`npm run build`** for any push that touches files outside
   `public/data/`. Data-only pushes (the recurring schedule) skip the build
   so refreshes stay fast.

Bypass either with `git push --no-verify` (rare; only for emergency force pushes).

## 9. Setup checklist (any new Mac)

```
1. Xcode CLT:                  xcode-select --install
2. Node (skip brew if needed): brew install node   OR  https://nodejs.org/en/download
3. Python 3 + tkinter:         python3 -c "import tkinter; tkinter.Tk()"   (preinstalled on macOS)
4. Repo:                       cd "~/Desktop/Stock Game App/stock-game" && git pull
5. Deps:                       npm install --legacy-peer-deps
6. Activate the pre-push hook: git config core.hooksPath .githooks
7. Test pipeline:              npm run refresh
8. Scheduler (Mac mini only):  npm run stockgame
```

Vercel CLI is NOT required on the Mac mini anymore — the webhook redeploys
on push. Only install + auth `vercel` if you intend to run `vercel deploy`
manually from this machine (e.g., as a fallback if the webhook breaks).

The Mac mini's iCloud-Desktop sync may show files as `.icloud` placeholders — force-download the directory before doing anything.

IPv6 timeouts on M1 with the Netgear extender path are a known workaround:
```
sudo networksetup -setv6off "Thunderbolt Ethernet"   # or whatever's active
```
Doesn't affect the app — IPv4 is fine for everything we touch.

## 10. npm scripts (`package.json`)

| Script | What |
|---|---|
| `npm run dev` | Local Next.js dev server (`http://localhost:3000`). |
| `npm run build` | Production build (verifies type + SSG works). |
| `npm run start` | Serve the production build. |
| `npm run fetch-prices` | Incremental refresh of `public/data/prices.json`. |
| `npm run fetch-prices -- --full` | Full re-fetch from START_DATE. |
| `npm run refresh` | `bash scripts/cron-update.sh` — fetch + commit + push + deploy. |
| `npm run check-theme` | `bash scripts/check-theme-coverage.sh` — fails if any dark-surface utility used in markup lacks a light+twilight override in `globals.css`. Runs in CI + pre-push. |
| `npm run stockgame` | Launch the tkinter scheduler UI on the Mac mini. |

## 11. Known invariants / gotchas

- **`startClose` is sacred.** Do not recompute on incremental fetches. Share counts depend on it.
- **Visx peer-dep mismatch.** React 19, but visx peers `^16 || ^17 || ^18`. `.npmrc` has `legacy-peer-deps=true` so Vercel installs cleanly.
- **`touchAction: none` on the chart SVG.** Required for clean scrub. If you ever change this, vertical scroll-finger-drift will release the gesture mid-swipe. Unchanged by the motion layer — the chart scrub is still pointer-driven with a 16ms-per-frame budget and NO React/JS-driven per-frame animation.
- **Motion layer is CSS-only, transforms/opacity, and must degrade.** The iOS motion (route transitions in `app/template.tsx`, the `<Sheet>` slide, `.press`) is implemented as CSS keyframes/transitions in `globals.css` (tokens: `--ease-ios`, `--ease-out-ios`, `--dur-press:140ms`, `--dur-fade:220ms`, `--dur-slide:320ms`) — no JS animation library was added for it. A GLOBAL `@media (prefers-reduced-motion: reduce)` guard in `globals.css` neutralizes transitions/animations/smooth-scroll (the repo had NO reduced-motion handling before this); any NEW motion must inherit or restate that degrade. Route keyframes use `animation-fill-mode: backwards` ON PURPOSE so no transform lingers at rest — a lingering transform re-roots the inline position:fixed modal (ManageFundsSheet; the other modals now portal to body via `<Sheet>`). `.press` uses transition longhands (incl. color) so it doesn't clobber Tailwind's `transition-colors`. `.press` tap feedback is wired to TabBar links, HeaderBack, FilterToolbar buttons, and the WhatsNew bell/close.
- **Don't use modal SHEETS for NAVIGATION.** Drilling into a detail page is a real route change (now animated as a push/pop) — NOT a sheet. Sheets/modals (`<Sheet>` + the remaining hand-rolled ManageFundsSheet shell) are for forms, filters, info, and destructive actions only. Tab navigation is a route change too (now a cross-fade), not a slide-up.
- **Motion doctrine (superseded + still-true).** The old "the app is mostly static; only the live pulse / holding flash / pull-to-refresh / scrub crosshair animate; tab nav is a plain route change with no slide; don't animate card mount/unmount" rule is SUPERSEDED for navigation + overlays only: the app now has deliberate, purposeful iOS-style transitions (tab fade, drill push/pop) and animated sheets. Animation is now for liveness, feedback, AND purposeful iOS-style transitions — all done in CSS within the perf budget. Still true: card mount/unmount itself is not animated, and the chart scrub stays JS-per-frame-free.
- **`<Sheet>` has NO drag-to-dismiss.** Close is backdrop tap / Done / Escape. Shared-element / cross-route morph (View Transitions API) was intentionally SKIPPED for older-device compatibility — do not claim it exists. framer-motion was NOT removed from the app (BreakdownDonut / PortfolioComposition / PortfolioThesis still use it); only WhatsNew moved off it.
- **Cache headers.** `next.config.ts` sets `no-cache, no-store, max-age=0, must-revalidate` on every user-facing document route + the data JSON snapshots. `no-store` (not just `must-revalidate`) is deliberate: iOS home-screen webclips serve a stale cached HTML snapshot on cold launch without revalidating, which strands shipped CSS/markup fixes on the OLD content-hashed bundle. The header config enumerates only document/data routes, so `/_next/static/*` keeps its `immutable` caching. First upgrade off the old header still needs one manual refresh per device; deploys after that land automatically.
- **`metadataBase`** in `app/layout.tsx` resolves dynamically from `VERCEL_PROJECT_PRODUCTION_URL` → `VERCEL_URL` → localhost fallback. Don't hardcode the vercel.app domain.
- **Site URL is `stock-game-gamma.vercel.app`.** Vercel assigned this; we don't control it. README + OG metadata don't depend on it (dynamic).
- **iCloud + git is forbidden — repo lives at `~/Repos/stock-game`.** iCloud silently writes `<file> 2` duplicates inside `.git/`, `node_modules/`, `.next/`, etc., which poisons `git fetch` (`fatal: bad object refs/remotes/origin/main 2`) and silently aborts every cron fire. Both Mac mini and laptop clone to `~/Repos/stock-game`; the iCloud Desktop folder keeps absolute symlinks to the canonical docs only. See CLAUDE.md §13.2 for full setup.
- **Theme system.** `globals.css` keeps the dark palette as the default `:root` with two alternates: `:root[data-theme="light"]` (Robinhood-light) and `:root[data-theme="twilight"]` (deep-indigo pre-market/after-hours). `<ThemeController>` mounts in the layout and switches `<html data-theme>` based on `getMarketSessionState()` (re-evaluated every 60s); a QA override `?theme=light|twilight|dark` (persisted to localStorage; `?theme=auto` clears) pins the theme for testing. **Fully token-driven since 2026-07-21**: semantic `--surface-*`/`--ink-*`/`--border-*` variables are assigned per theme and exposed as utilities (`bg-card`, `text-ink-muted`, `border-hairline`, …) via `@theme inline`; the old per-utility `!important` override blocks are gone. Markup NEVER uses raw zinc/black/white color utilities (any variant) and never puts opacity modifiers on semantic tokens (`bg-card/50` — mint a token in all three theme blocks and add its utility to the theme-transition group). `npm run check-theme` (denylist mode) enforces both rules in CI + pre-push; exceptions live in its justified `ALLOWLIST` (inverted white pills, modal scrim). **P3/wide-gamut (2026-07-21):** `--gain`/`--loss` and player accents (`color_p3` in roster.json, `colorP3` via lib/picks.ts) upgrade on Display-P3 screens via `@supports`; DOM uses `var(--gain)`/`var(--loss)`, SVG attrs use `lib/color.ts` `useP3()`+`accentFor()`; detail pages publish `--accent` on their root. See CLAUDE.md §5.6.
- **DST heuristic** in `sessionBoundsForDate` is coarse (Mar–Nov = EDT). Wrong on the few transition days; harmless for the visual axis.
- **Today's intraday bars cover the extended session.** `scripts/fetch-prices.ts` requests `includePrePost: true` from Yahoo and keeps bars in `7:00 AM ≤ t < 6:00 PM ET` via `extendedSessionBoundsET()` so the 1D chart shows pre-market (7:00 – 9:30 AM ET) and after-hours (4:00 – 6:00 PM ET) moves alongside the regular session. The `ThemeController` applies `data-theme="twilight"` during those windows; `MarketStateBadge` displays "Pre-market" / "Market open" / "After hours" / "Market closed".
- **Weekly hourly bars are also regular-session-only.** `fetchWeeklyHourly()` pulls 1h bars for the past 8 days, then `filterToRegularSession()` drops pre-market, after-hours, and weekend bars (DST-aware ET hour-of-day check). At render time `lib/portfolio.ts` further drops Yahoo's "live partial" bars (any bar whose timestamp doesn't end with `:00.000Z`) so 1W plot points all sit at clean hourly intervals.
- **`isMarketLive`** = bar < 30 min old. Doesn't know about market holidays; relies on Yahoo not returning fresh bars on those days.
- **No client-side polling.** All "live" feel comes from PullToRefresh's resume-reload + the scheduler's 15-min cadence. The chart's blink is purely visual; data is static between reloads.
- **`scripts/.pause`** is the only soft-stop. The cron checks for it first thing. Use it to halt the schedule without closing the tkinter UI.
- **Branch guard in `cron-update.sh`** means if anyone accidentally checks out a feature branch on the Mac mini, the recurring refresh exits 0 silently. To resume, `git checkout main` on the Mac mini.
- **Pre-push hook is per-clone.** New clones must run `git config core.hooksPath .githooks` once or pushes will skip the local build check.
- **`git pull --rebase --autostash`** in the cron stages any local WIP transparently. If the Mac mini ever has uncommitted edits, they survive the rebase and reappear; they're never auto-committed because we explicitly stage only `public/data/prices.json`.
- **CI requires `npm run build` to pass on every PR.** Branch-protection-enforced. The cron's data-only pushes bypass via the pre-push hook detecting "no code changed" — they don't bypass CI itself, but `build.yml` runs anyway and passes since the build doesn't depend on data values, only the data file's existence.
- **`digest.swift` macros not available in script mode.** The `@Generable` / `@Guide` macros from FoundationModels require a SwiftPM package with the macro plugin loaded; they don't compile when run as `swift file.swift` (single-file script mode). The script works around this by calling `session.respond(to:)` with a JSON-asking prompt and parsing the response with `JSONSerialization`. If the script ever moves to a SwiftPM target, switching to `@Generable` is a clean upgrade.
- **Apple Intelligence script-mode async bridge.** Top-level `await` isn't legal in single-file Swift scripts. `digest.swift` wraps `runMain()` in a `Task { ... }` and uses a `DispatchSemaphore` to block until completion. Don't refactor to `@main` — that requires `-parse-as-library` which doesn't pair with single-file scripts.
- **Digest-pipeline failure is non-blocking.** If `LanguageModelSession` is unavailable or the script throws, the run exits 0 silently — the previous `digests.json` keeps serving. The web app treats a missing-or-empty digest entry as "render nothing" so it never errors visibly.

## 12. Accounts / auth state

| | Where it lives |
|---|---|
| GitHub auth | `gh` keyring on whichever Mac (was approved as `btheis15` on the original setup machine; new Macs need `gh auth login`) |
| Vercel CLI auth | `~/Library/Application Support/com.vercel.cli/auth.json` (per-Mac; requires `vercel login` once) |
| Vercel ↔ GitHub integration | One-time install of the Vercel GitHub App at `https://github.com/apps/vercel/installations/select_target` granting access to `btheis15/stock-game`. Already done; survives forever unless revoked. |
| Vercel project link | `.vercel/project.json` in the repo (synced via iCloud + via `vercel link`). |

## 13. v-next backlog (reasonable next steps)

- ~~Real corporate-action handling for HON spin-off when announced~~ **DONE** — HON → HONA spin-off + the bundled HON 1-for-2 reverse split are live in `lib/events.ts` (effective 2026-06-29). Optional follow-ups: include spin-off children in `scripts/digest.swift`'s config-derived `DEFAULT_TICKERS` (it reads `config/roster.json` `users[].tickers`, which excludes HONA) so they get per-stock AI briefings, and to `fetch-fundamentals` coverage (it's currently keyed off `ALL_TICKERS`, which excludes spin-off children).
- Per-stock 1D chart (currently uses single-ticker intraday but with the same axis; could add a "5D" / "1M" intraday).
- Better DST detection (use a real library or a lookup of US DST transition dates).
- Per-user dividend totals on the portfolio drill-down ("Dividends received: $X").
- Show realized vs. unrealized splits if we ever add a "sell" event.
- Push notifications when ranks change (would need a service worker + a live backend; not worth it for 4 friends).
- Theming: dark + light themes ship; light is automatically active while the market is open via `ThemeController`. Manual override toggle could be added.

## 14. File-by-file map

```
app/                           Next.js routes
  layout.tsx                   Root layout, metadata, OG, mounts global UI + <ThemeController>
  page.tsx                     "/" → loads PriceData, computes daily + intraday series + analyses + participant breakdown, injects the synthetic Combined Players fund, renders <CompareView>
  template.tsx                 Per-navigation route-transition wrapper. CSS-only tab cross-fade + drill-in push / back-out pop (.pt-fade / .pt-push / .pt-pop); direction from previous-path vs /^\/(stock|portfolio|fund)\//.
  globals.css                  Tailwind import + CSS vars + light-theme utility overrides + motion tokens (--ease-ios / --ease-out-ios / --dur-press / --dur-fade / --dur-slide) + all keyframes (live pulse, holding flash, route .pt-* + sheet sheetIn/sheetOut) + .press tap-shrink utility + global @media (prefers-reduced-motion: reduce) guard
  portfolio/[user]/page.tsx    Dynamic per user; dispatches to <PortfolioView> (Combined Players offered as an overlay)
  fund/[id]/page.tsx           Per-fund drill-down; resolves the synthetic combined-players id directly, others from config/funds.json
  stock/[ticker]/page.tsx      SSG for ALL_TICKERS; dispatches to <StockView>
  stocks/page.tsx              Renders <StocksListView> with all TickerSeries
  tee-times/page.tsx           Renders <TeeTimesView> (deep-link landing for foreUP)

components/                    Client components (mostly)
  ScrubChart.tsx               (315 LOC) The chart. Owns scrub state, accepts xDomain + liveEndpoint.
  CompareView.tsx              Compare page logic. 1D normalizes lines.
  PortfolioView.tsx            Per-user page logic. Anchor-deep-link supported.
  PortfolioComposition.tsx     Donut breakdown (Sector / Industry / Market cap) + Claude-analysis
                               About card. Title/aboutTitle props are configurable; rendered on
                               /portfolio/[user] for a player AND on "/" for the Combined Players fund.
  BreakdownDonut.tsx           Shared donut + SliceList + SliceDetail used by PortfolioComposition.
  StockView.tsx                Per-ticker page logic. N Position cards.
  StocksListView.tsx           Filterable ticker list.
  DigestPanel.tsx              Per-stock news-digest card (Robinhood-style).
  InsightsCard.tsx             "What's driving it" per-user breakdown, ranked.
  SpinoffNote.tsx              spinoffRowSuffix() list-row tag + <SpinoffBanner> stock-page
                                callout, so a spin-off parent/child's price move doesn't read
                                as an unexplained gain/loss. See STATE.md prices.json notes.
  TeeTimesView.tsx             Inshalla CC tee-time hand-off: quick-pick day chips deep-link into foreUP (new tab), plus Call-pro-shop + Daily Deals links. No iframe.
  ThemeController.tsx          Toggles light/dark theme based on isMarketLive.
  Sheet.tsx                    Reusable iOS bottom-sheet primitive (portal, CSS slide-up/down, content-height or `full` detent, optional pinned `footer` action bar, no drag-to-dismiss). Used by FilterSheet (FundsFilter.tsx), WhatsNew, CreateFundModal + EditThesisModal (`full` + `footer`); ManageFundsSheet still on its own shell.
  WhatsNew.tsx                 Bell + "What's new" recent-updates sheet via <Sheet> (last-30-days changelog; accordion is a CSS grid-rows transition, moved off framer-motion).
  RangeTabs / TabBar / HeaderBack / PriceHeader / Footer / InstallHint / PullToRefresh / MarketStateBadge

lib/                           Pure logic, no React
  picks.ts                     Players, tickers, colors, ticker → owners[] map.
  combined.ts                  Builds the synthetic Combined Players fund from the roster
                               (combinedPlayersFund(): unique tickers weighted times-picked /
                               total-picks). COMBINED_FUND_ID / _NAME / _COLOR + totalPickSlots().
  changelog.ts                 Hand-curated, plain-language "What's new" entries (the source
                               of truth for WhatsNew.tsx). Add an entry per MAJOR user-facing
                               feature; `recentEntries()` filters to RECENT_WINDOW_DAYS (30).
  events.ts                    Corporate actions: SPINOFFS (HON→HONA) + REVERSE_SPLITS (HON 1-for-2) + priceUnitDivisor.
  types.ts                     All TS interfaces.
  portfolio.ts                 (337 LOC) All math + formatters.
  portfolio-composition.ts     Server-side aggregator: holdings + fundamentals →
                               sector / industry / market-cap slices + hand-written
                               (per UserId) "About this portfolio" narrative. The
                               narrative is intentionally number-free and stable; edit
                               PER_USER_ANALYSIS to change a player's blurb. Consumed
                               by PortfolioComposition.tsx on /portfolio/[user]. Also
                               exports buildCombinedComposition(holdings, fundamentals) →
                               same sector/industry/market-cap slices for the pooled
                               Combined Players fund + a game-wide "About the combined
                               portfolio" narrative (writeCombinedAnalysis), rendered on "/".
  fundamentals.ts              Client-safe formatters for fundamentals data.
  fundamentals-data.ts         Server-only loader for public/data/fundamentals.json.
  data.ts                      Server-side loader of public/data/prices.json.
  digests.ts                   Digest types + `useDigests()` client hook (module-level
                               cache → /digests.json fetched once per session).

scripts/
  fetch-prices.ts              Yahoo Finance fetcher. Incremental + today's 15-min intraday + past-week 1h hourly + dividends + spin-off children.
                               TickerSeries.name = TICKER_NAMES[ticker] ?? chart-meta longName/shortName ?? ticker,
                               so fund-only tickers (absent from TICKER_NAMES) still get a real company name. Rebuilt
                               every fetch, so a name fix lands on the next cron tick without a --full run.
  digest.swift                 Apple Intelligence news-digest pipeline. Single file,
                               no third-party deps. Run via `swift digest.swift [...]`.
                               Loads `public/data/prices.json` BEFORE Phase 2 so the
                               per-user portfolio prompt's STANDINGS block (top 3 movers +
                               drags by $ contribution) grounds the prose in real P&L,
                               not raw article frequency. Same prices feed Phase 3's
                               game-wide summary. Articles are tagged inline with their
                               owners (`[NVDA/kevin,rick]`) so the LLM has an ownership
                               reminder at the point of reading each headline.
  cron-update.sh               One-shot: fetch + commit + push + vercel deploy.
  digest-update.sh             One-shot wrapper around digest.swift: rebase + run
                               digest.swift + commit + push. Mirrors cron-update.sh's
                               defensive pattern (pause-file, branch guard, autostash).
  stockgame_schedule.py        tkinter scheduler. threading.Timer + caffeinate.
  check-theme-coverage.sh      Fails if any dark-surface utility used in components/ + app/
                               lacks a light+twilight override in globals.css. Guards the
                               recurring light-mode contrast bug. Run via `npm run check-theme`;
                               wired into CI (build.yml theme-coverage job) + the pre-push hook.
  make-icons.py                Regenerate PWA icons (icon-192/512, apple-touch, favicon).
  make-og.py                   Regenerate the 1200x630 OG card.

public/
  data/prices.json             The canonical price snapshot (committed).
  digests.json                 Per-ticker AI news digests, 6 windows × 45 tickers (committed).
  manifest.webmanifest         PWA manifest.
  icon-*.png, apple-touch-icon.png, favicon.png, og.png

next.config.ts                 Cache-Control: no-store on all document + data routes (anti-stale-PWA); /_next/static stays immutable.
.npmrc                         legacy-peer-deps=true.
.gitignore                     Excludes .claude/, __pycache__/, .next/, .vercel/, node_modules/.
README.md                      Public-facing intro + Vercel deploy badge.
STATE.md                       This file.
OVERVIEW.md                    Human-friendly walkthrough.
CLAUDE.md                      AI-session conventions; instructs future Claude to keep STATE.md updated.
```

## 15. Maintenance discipline

**Whenever you change repo behavior in a way that affects any of:**
- The data model
- The per-component contract
- The pipeline
- The setup steps
- A new player / ticker / spin-off

**…update STATE.md in the same commit.** This file is the contract for future-Claude pickup. Drift makes it useless.
