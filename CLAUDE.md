# CLAUDE.md — comprehensive operating manual for AI sessions

> Future Claude (or any AI agent), read this first when picking up the Stock
> Game project. This document is intentionally **long, dense, and redundant**
> — built to be a single-read context dump that lets you debug, extend, and
> ship changes without guessing. Pair with `STATE.md` (machine-friendly
> reference tables) and `OVERVIEW.md` (user-narrative).

---

## §1. Read order

1. **This file.** Read the whole thing once on session start. Skim each
   section header even if you skip the body — section names are the index.
2. **STATE.md** — canonical state, tables, structural reference.
3. **OVERVIEW.md** — for matching the user's mental model.
4. **DESIGN.md** — portable design system (the UI/UX patterns, the
   distribution architecture, formatter library). Useful both for
   maintaining this app's visual consistency *and* for porting the same
   patterns to a different project.
5. **README.md** — public intro only; mostly cosmetic.
6. The actual code in `lib/`, `components/`, `app/`, and `scripts/`.

---

## §2. Core invariant: keep the docs current

Whenever you change repo behavior in a way that touches:

- The data model (`lib/types.ts`, `public/data/prices.json` shape)
- A pipeline step (`scripts/fetch-prices.ts`, `scripts/cron-update.sh`,
  `.githooks/`, `.github/workflows/`, `next.config.ts` cache headers,
  the Vercel build behavior)
- Any component's external contract (props, what it renders, how it's used)
- The player roster (`lib/picks.ts`)
- The setup steps (`npm install` flags, brew/CLI requirements, env vars)
- Any new file or directory that future-Claude should know about

…**update `STATE.md` (and `OVERVIEW.md` if user-visible) in the same commit
as the code change.** Drift between docs and reality is the only failure
mode that makes these files actively harmful. Treat them like the public API
of the repo.

When in doubt, update both. They're cheap to edit. Your future self thanks
you.

---

## §3. Mental model of the whole system

```
                        SOURCE OF TRUTH = main branch on GitHub

  [Mac mini]                                              [Laptop]
  ──────────                                              ────────
  scheduler UI (tkinter)                                  feature branches
  threading.Timer fires                                   PR → CI build → merge
        ↓                                                 (no direct push to main
  scripts/cron-update.sh                                   from laptop)
   ├─ rebase onto origin/main          ←─── git pull          ↑
   ├─ conditional npm install                                 │
   ├─ npm run fetch-prices              writes prices.json   │
   ├─ git commit -m "data: ..."                               │
   └─ git push                          ─── webhook ──→  [Vercel] rebuild → CDN
                                                                ↓
                                                              [iPhone PWA]
                                                              fresh on every open
                                                              (cache: must-revalidate)
```

Three principles fall out of this:

1. **All app state is committed to `main`.** Code, content, and the data
   snapshot all share the same git history. There is no separate database,
   no live API, no edge config. If it's not in `main`, it doesn't exist.
2. **`main` is the deploy trigger.** GitHub→Vercel webhook redeploys on
   every push to `main`. The Mac mini doesn't run Vercel CLI — it just
   pushes data commits and the webhook handles deploy.
3. **The Mac mini and laptop never collide.** The cron does
   `git pull --rebase --autostash origin main` before fetching prices, so
   any laptop merges land cleanly on the mini before the next data push.

---

## §4. Type-flow: how data threads through the codebase

This is the spine. If you understand how `PriceData` becomes pixels, you
understand the codebase.

```
                  yahoo-finance2 (network)
                         │
                         ▼
               scripts/fetch-prices.ts
                  per-ticker fetch
                  ├─ daily closes (interval: 1d)
                  ├─ dividend events
                  └─ today's intraday (interval: 15m)
                         │
                         ▼
               public/data/prices.json   ←── PriceData type
                         │
                         │  (committed; loaded at build time)
                         ▼
                lib/data.ts: loadPriceData()
                         │
                         ▼
                  app/*/page.tsx (server components)
                         │
                         ├─ portfolioSeries(data, userId)         → PortfolioPoint[]
                         ├─ intradayPortfolioSeries(data, userId) → { points, previousClose }
                         ├─ analyzeRange(data, range)             → RangeAnalysis
                         └─ buildHoldingRows(userId, data)        → HoldingRow[]
                                  │
                                  ▼
                          components/*View.tsx (client)
                                  │
                                  ├─ filterRange(points, range)   slice for non-1D
                                  ├─ scrub state (useState)        ScrubState | null
                                  └─ derived stats (useMemo)        ranked, formatted
                                  │
                                  ▼
                          components/ScrubChart.tsx (client)
                                  │
                                  ├─ scaleTime  (xDomain | data extent)
                                  ├─ scaleLinear (data extent + baseline)
                                  ├─ pointer events → scrub index
                                  ├─ LinePath + AreaClosed (visx)
                                  └─ liveEndpoint pulse, baseline dashed line
                                  │
                                  ▼
                                pixels
```

Key types (full defs in `lib/types.ts`):

```ts
PriceData      = { startDate, generatedAt, intradayDate?, intradayInterval?, tickers, tradingDates }
TickerSeries   = { ticker, name, startClose, closes[], dividends?[], intraday?[] }
DailyClose     = { date: "YYYY-MM-DD", close: number }
IntradayBar    = { t: ISO_UTC, close: number }
DividendEvent  = { date: "YYYY-MM-DD", amount: number }
PortfolioPoint = { date: string, value: number }   // date can be daily OR ISO depending on source
HoldingRow     = { ticker, shares, startClose, currentClose, costBasis, currentValue, pl, plPct }
RangeMover     = { ticker, pct, dollars, ownerId }
RangeAnalysis  = { range, startDate, endDate, perUser, topGainers[], topLosers[] }
ScrubState     = { index: number, date: string, values: { id, value }[] } | null
ChartSeries    = { id: string, color: string, data: { date, value }[] }
```

Every render starts with a `PriceData` blob loaded once on the server. Math
is done at request time (cached at build because pages are SSG). Client
components receive prepared series and only do range-filtering and scrub.

---

## §5. End-to-end traces for each view

### §5.1. Compare (`/`)

**Server side** (`app/page.tsx`):
1. `loadPriceData()` → reads `public/data/prices.json` from disk.
2. For each player in `USER_LIST`, call `portfolioSeries(data, u.id)` →
   array of daily PortfolioPoints (one per trading date).
3. For each player, call `intradayPortfolioSeries(data, u.id)` → returns
   `{ points, previousClose }`. Points are today's intraday curve;
   previousClose is the close of the most recent trading day strictly
   *before* today's intraday date.
4. For each non-1D range, call `analyzeRange(data, r)` → per-user range pct
   + per-ticker movers. Build `analyses: Record<Range, RangeAnalysis>`.
5. Render `<CompareView series={...} intraday={...} analyses={...} intradayDate={...} />`.

**Client side** (`components/CompareView.tsx`):
1. `useState<Range>("ALL")` for range tab.
2. `useState<ScrubState | null>(null)` for chart scrub state.
3. `isIntraday = range === "1D"`. Determines all special-case behavior.
4. `live = isIntraday && lastPointIsLive(intraday[firstUser].points)` →
   true if the most recent intraday timestamp is < 30 min ago. Drives the
   pulsing endpoint and the LIVE/MARKET CLOSED badge.
5. `ranged: Record<UserId, PortfolioPoint[]>` — for 1D, the intraday points;
   for other ranges, `filterRange(series[u.id], range)`.
6. `stats` (useMemo): for each player, compute current value, baseline,
   pct. For 1D, baseline = previousClose. Otherwise, baseline = first
   point in `ranged`. Sort descending by pct. **Crucial scrub detail:**
   in 1D mode, `chartSeries.data` plots normalized pct values so all
   four lines start at y=0. But the chart's `onScrub` reports values
   from the chart data — which would be pct fractions, not dollars. So
   `stats` rehydrates by indexing `intraday[u.id].points[scrub.index]` to
   get the raw $ value for the leaderboard. Don't break this — pct on
   chart, $ in stats.
7. `chartSeries: ChartSeries[]` — for 1D, normalized to `(value - baseline) / baseline`;
   for other ranges, raw $ values.
8. `xDomain: [Date, Date] | undefined` — for 1D, `sessionBoundsForDate(intradayDate)`
   forces the axis to span the full trading session even when only part is filled.
9. Render header (`{leader.user.name} leads` or `It's a tie`), gap pct +
   gap $, optional `<MarketStateBadge>`, `<ScrubChart>`, `<RangeTabs>`,
   2x2 leaderboard cards (`<UserCard>` with 1st/2nd/3rd/4th badges and
   ranked-by-pct ordering), `<InsightsCard>` (hidden in 1D), Game rules.

### §5.2. Portfolio drill-down (`/portfolio/[user]`)

**Server side** (`app/portfolio/[user]/page.tsx`):
1. `generateStaticParams()` returns `{user: 'brian'|'kevin'|'rick'|'lee'}`
   for SSG.
2. Validate the param is a valid UserId, else 404.
3. Compute `series`, `intraday`, `holdings` (via `buildHoldingRows`).
4. Render `<HeaderBack title="Compare" />` + `<PortfolioView ... />`.

**Client side** (`components/PortfolioView.tsx`):
1. Same range/scrub/isIntraday/live machinery as Compare.
2. **Single line**: `chartSeries = [{ id: userId, color, data: ranged }]`.
   No normalization needed (only one line).
3. `baseline` for the chart's dashed reference line = either
   `intraday.previousClose` (1D) or `ranged[0].value` (other ranges).
4. Holdings list below the chart, sorted by `plPct` desc. Each row has
   `id={ticker}` so deep-links like `/portfolio/kevin#MRVL` jump-scroll
   and trigger the green flash animation.

### §5.3. Stock detail (`/stock/[ticker]`)

**Server side** (`app/stock/[ticker]/page.tsx`):
1. `generateStaticParams()` returns `{ticker}` for every entry in
   `ALL_TICKERS` (currently 25).
2. Look up `data.tickers[upper]`, 404 if missing.
3. Render `<HeaderBack />` (no title — natural "back" target depends on
   how you arrived) + `<StockView series intradayDate />`.

**Client side** (`components/StockView.tsx`):
1. `owners = TICKER_OWNERS[ticker]` — array of UserIds (1+ players).
   Accent color = first owner's color.
2. `closesAsPoints` = daily closes mapped to `{date, value}`. For 1D,
   build an `intraday` block via `intradayTickerSeries(series, intradayDate)`.
3. `live = isMarketLive(series.intraday)` directly on the raw bars.
4. Chart series, baseline, xDomain logic mirrors PortfolioView.
5. Below chart: ONE `<PositionCard>` per owner. NVDA shows two cards
   (Kevin's + Rick's), each with their own shares / cost basis /
   dividends-received / current value / total return. Same numbers when
   they have the same allocation, different numbers if not.
6. Below positions: `<DividendsList>` if `series.dividends?.length > 0`.
   Per-share amounts only — converting to per-position cash is each
   PositionCard's job.

### §5.4. Stocks list (`/stocks`)

**Server**: load PriceData, pass `series: TickerSeries[]` (in `ALL_TICKERS`
order) to `<StocksListView>`.

**Client**: filter chips (All / Brian / Kevin / Rick / Lee), sorted by
total %-return-since-Feb-5 desc. Multi-color owner swatch when 2+ players
own a ticker. Each row links to `/stock/{ticker}`.

---

## §6. The chart — `components/ScrubChart.tsx`

The single most subtle component. ~315 LOC. Read this section before
modifying it.

**Props:**

```ts
{
  series: ChartSeries[]                // one or more lines
  baseline?: number                    // dashed reference line at this y-value
  height?: number                      // default 260
  onScrub?: (s: ScrubState | null) => void
  xDomain?: [Date, Date]               // override auto-domain (for 1D full-day axis)
  liveEndpoint?: boolean               // pulsing concentric ring at last point
}
```

**Internal flow:**
1. `<ParentSize>` reports container width.
2. `dates`: from `series[longest].data`, parsed as Dates. Date strings can
   be `YYYY-MM-DD` (daily) or full ISO (intraday) — distinguish by
   `s.date.length > 10`.
3. `xScale`: `scaleTime` from `xDomain` if provided, else `[dates[0], dates[last]]`.
4. `yScale`: `scaleLinear` over the data's y range (with `baseline`
   included if set, then ±8% pad).
5. Pointer events on the SVG:
   - `pointerdown` → `setPointerCapture` so the SVG owns the gesture even
     after the finger leaves its bounds. Also calls `handlePointer`.
   - `pointermove` → if pointer is captured (touch) or mouse is moving,
     `handlePointer`.
   - `pointerup`/`cancel`/`leave` → `reportScrub(null)`.
6. `handlePointer(clientX)`: invert via `xScale`, bisect against `dates`
   (using d3-array's `bisector`), pick nearest neighbor index, call
   `reportScrub(idx)`.
7. `reportScrub(idx)`:
   - Sets local `scrubIdx` state for cursor rendering.
   - Synchronously calls `onScrub` callback via stable `seriesRef` /
     `onScrubRef` refs (avoids the useEffect dep-array loop bug).
   - Builds `ScrubState = { index, date, values }`. Values come from
     `series[i].data[idx].value` — so if the data is normalized pct,
     the reported value is normalized pct.

**Render:**
1. `<defs>` linear gradients per series (more transparent if multi-line).
2. Dashed `<Line>` at `yScale(baseline)` if baseline is set.
3. `<AreaClosed>` per series (gradient fill).
4. `<LinePath>` per series (curve = `monotoneX`).
5. If `liveEndpoint && !scrubbing`, two concentric `<circle>`s at the
   most recent point, animated by `livePulseRing` and `livePulseFill`
   keyframes in `globals.css`. **Note:** `r` is animated via CSS, not
   `style`, so it works inside `<svg>`.
6. If scrubbing, vertical line + filled circle + glow circle at the
   scrubbed point on each line.

**Critical behavior:**
- `style={{ touchAction: "none" }}` — without this, vertical-finger-drift
  during a horizontal scrub causes iOS Safari to steal the gesture for
  page scroll, releasing pointer capture and firing `pointercancel`. The
  scrub feels like it "lets go." Don't change this.
- Chart fills the parent's full width (no internal padding) — gives
  Robinhood-style edge-to-edge feel.
- Date strings of length > 10 (full ISO) are parsed as-is; otherwise
  appended `T00:00:00Z` to anchor at UTC midnight.

---

## §7. The 1D special case (most subtle logic in the app)

1D differs from every other range in 5 ways simultaneously. If a bug
report involves the 1D view, work through all 5:

1. **Data source**: comes from `series.intraday[]` (15-min bars), not
   `series.closes[]`. Helpers: `intradayPortfolioSeries`, `intradayTickerSeries`.
2. **Baseline**: previous day's close, not "first point in range." Computed
   by walking `closes[]` for the most recent date strictly before the
   intraday date.
3. **X-axis**: forced to full session bounds via `xDomain` prop —
   `sessionBoundsForDate(intradayDate)` returns `[09:30 ET, 16:00 ET]` as
   UTC dates. The line covers only the elapsed portion.
4. **Compare-view normalization**: `chartSeries.data` plots
   `(value - baseline) / baseline` so all four players' lines start at 0%.
   Stats use raw $ via `intraday[u.id].points[scrub.index].value`.
5. **Live state**: `isMarketLive(series.intraday)` checks if the most
   recent bar is < 30 min old. Drives `liveEndpoint` (pulsing ring) and
   the `<MarketStateBadge>` (LIVE vs MARKET CLOSED).

**Common 1D pitfalls:**
- Don't pass `xDomain` outside 1D — it'll force a too-wide axis on
  daily ranges.
- Don't enable `liveEndpoint` outside 1D — the "last point" of an ALL
  range chart is just yesterday's close, no pulse needed.
- Don't show `<InsightsCard>` in 1D — the per-user top-performers list
  is computed from daily ranges and doesn't reflect intraday movers.
  CompareView already gates this.
- Beware of timezones in `sessionBoundsForDate`. Heuristic: month 2-10
  → EDT (UTC-4), else EST (UTC-5). Wrong on the 4 DST transition days
  per year; harmless for axis rendering.

---

## §8. The data refresh pipeline — deep dive

### §8.1. `scripts/fetch-prices.ts` (Yahoo Finance fetcher)

Run modes:
- `npm run fetch-prices` — incremental: refetches only the trailing 5
  trading days per ticker, merges with existing data. Cheap (~3s).
- `npm run fetch-prices -- --full` — refetches from `START_DATE` for
  every ticker. Use after picks change.

For each ticker:
1. Build a `FetchPlan` describing what to refetch (full or trailing).
2. Call `yahooFinance.chart(ticker, { period1, period2, interval: "1d", events: "div" })`
   to get daily closes + dividend events.
3. Merge fresh closes into `prevSeries.closes` by date (Yahoo restates
   late-day closes occasionally; merging handles this).
4. **Preserve `startClose`.** Set on first fetch, never overwritten.
   Share counts depend on it.
5. For each ticker, separately fetch today's intraday bars
   (`interval: "15m"`, period bracket: now-26h to now+1m).
6. Filter intraday bars to today's date (ET-shifted) and store in
   `series.intraday`.
7. Write the whole `PriceData` blob to `public/data/prices.json`.

### §8.2. `scripts/cron-update.sh` (the Mac mini's recurring driver)

Defensive ordering:
1. **Pause check**: if `scripts/.pause` exists → exit 0.
2. **Branch guard**: if current branch ≠ `main` → exit 0. Prevents
   accidental data commits to feature branches if someone left the Mac
   mini on the wrong branch.
3. **Rebase**: `git fetch origin main`, `git pull --rebase --autostash`.
   Captures pre/post SHAs to detect what changed.
4. **Conditional `npm install`**: only if `node_modules` is missing or
   if `package.json`/`package-lock.json` changed during the rebase.
   Saves ~10s on most runs.
5. **Fetch**: `npm run fetch-prices` (incremental).
6. **Stage only `public/data/prices.json`** explicitly. WIP in other
   files survives untouched.
7. **Commit + push** if and only if prices.json changed.
8. **No `vercel deploy`.** Webhook handles redeploy. Comment in the
   script tells future-Claude to re-add the line if the webhook ever
   breaks.

### §8.3. `.githooks/pre-push`

- Walks the pushed refs, computes the diff range against
  `remote_sha..local_sha` (or merge-base for new branches).
- If any file outside `public/data/` changed → run `npm run build`
  before the push.
- If only `public/data/*` changed → skip the build. Mac mini's data
  pushes never block on a 14s build.
- New clones must run `git config core.hooksPath .githooks` once.

### §8.4. `.github/workflows/build.yml`

- Triggers on PRs and pushes to `main`.
- Sets up Node 24, runs `npm install --legacy-peer-deps`, then
  `npm run build`.
- This is the required status check for branch protection on `main`.

### §8.5. `scripts/stockgame_schedule.py` (tkinter scheduler UI)

- The app *is* the scheduler. `threading.Timer` fires `cron-update.sh`
  on the chosen wall-clock time.
- Uses `caffeinate -i -w <pid>` so the Mac doesn't sleep while open.
- Interval options: `5/10/15/30 min` and `1-24 hr` (default 15 min).
- Window options: enforces a daily start/end time (default 8:30 AM –
  3:00 PM CT = US market hours in ET).
- Buttons: Schedule Run / Run Now / Stop / Open Log.
- Status labels: "Next refresh: ..." and "Last run: ✓..." or "✗...".

### §8.6. The webhook + deploy

- GitHub→Vercel integration (one-time UI install at
  `https://github.com/apps/vercel/installations/select_target`) listens
  for pushes to `main`.
- On push, Vercel pulls the repo, runs `npm install --legacy-peer-deps`
  (per `.npmrc`), runs `next build`, deploys static output to its CDN.
- The Vercel project is aliased to `stock-game-gamma.vercel.app`.
- Cache-Control headers (`next.config.ts`) tell every client to
  revalidate HTML and `prices.json` on each request — so the iPhone
  PWA picks up the new build the next time the user opens the app.
- End-to-end latency: ~3s fetch + 14s build + ~30s propagate ≈ **50s**.

---

## §9. Debugging playbook

Symptom → checks → fixes. Walk top to bottom; the early checks are
cheaper.

### §9.1. "I don't see the latest data on my phone."

| Check | How | If yes, then |
|---|---|---|
| Footer shows recent timestamp? | Look at bottom of any page | Cron is running; the issue is on your phone (next row) |
| Footer shows old timestamp? | Same | Cron isn't pushing — see §9.2 |
| Vercel deployed since push? | `vercel ls --yes` from any logged-in machine | If yes, your phone has stale cache (next row) |
| Phone PWA cached? | Long-press home icon → Delete, reopen URL in Safari, re-add | Should clear it |
| iMessage preview shows old card? | Apple cache, not ours | Ignore, or share with `?v=2` to bust |

### §9.2. "Cron isn't pushing data."

| Check | Where | Fix |
|---|---|---|
| Pause file exists? | `ls scripts/.pause` on Mac mini | `rm scripts/.pause` |
| Wrong branch? | `git branch --show-current` on Mac mini | `git checkout main` |
| Rebase conflict? | `cat /tmp/stock-game.log` tail | Resolve manually: `git rebase --abort; git stash; git pull` |
| Yahoo API failure? | Same log | Often transient; retry. If persistent, check Yahoo Finance status |
| Push permission denied? | Same log | `gh auth login` to refresh credentials |

### §9.3. "Build fails on Vercel."

| Check | How |
|---|---|
| `.npmrc` present in repo? | `cat .npmrc` should show `legacy-peer-deps=true` |
| `package-lock.json` in sync? | Local: `npm install --legacy-peer-deps`, commit any changes |
| TypeScript error? | Run `npm run build` locally — same errors |
| Visx peer-dep warning escalating to error? | Confirm `.npmrc` is at repo root, not in `~/` |
| Page-level error during SSG? | Check the page's server component — `generateStaticParams`, type guards on params |

### §9.4. "Chart is stuck / unresponsive on touch."

| Check | Why |
|---|---|
| `touch-action: none` on the chart SVG? | If anything but `none`, vertical drift kills the gesture |
| Pointer-event listeners attached? | Look for `onPointerDown` etc. on the SVG element |
| `setPointerCapture` called? | Inside `onPointerDown`. Capture means events keep flowing even when the finger leaves the SVG |
| `useEffect` infinite loop? | If the chart is in a render loop, `series` prop is changing identity each render. Memoize on the parent or use `seriesRef` pattern |
| `PullToRefresh` hijacking? | It already excludes touches on `<svg>`, but verify the chart's root is an `<svg>` |

### §9.5. "1D shows a flat line / no data."

| Check | Why |
|---|---|
| `prices.json` has `intraday: [...]` per ticker? | Verify with `jq '.tickers.NVDA.intraday | length'` |
| `intradayDate` field set? | At top level of PriceData |
| Today is a weekend / holiday? | Yahoo doesn't return new bars; `isMarketLive` will be false; chart shows yesterday's session |
| Just after market open / before any bar? | Wait for the first 15-min bar; or `npm run refresh` to force a fetch |

### §9.6. "Numbers look wrong (% / dollar / share count)."

| Check | Where |
|---|---|
| `startClose` correct? | `jq '.tickers.NVDA.startClose'` should be the Feb 5 close |
| Shares = $10k / startClose for $10k allocations? | `sharesFor(userId, series)` |
| Per-pick allocation right? | `perHoldingDollars(userId)` = $100k / count(picks) |
| Dividend cash included? | `dividendsReceived(series, shares, asOf)` — should be cumulative through asOf |
| 1D scrub shows wrong $? | Look at the "stats rehydrate from intraday[u.id].points by index" comment in CompareView — broken if you remove that |

### §9.7. "Site URL / OG card / metadata shows wrong domain."

| Check | Where |
|---|---|
| `metadataBase` resolves correctly? | `app/layout.tsx` `siteUrl()` function. Reads `VERCEL_PROJECT_PRODUCTION_URL` → `VERCEL_URL` → localhost. |
| OG image exists? | `public/og.png`. Regenerate with `python3 scripts/make-og.py`. |
| OG metadata in HTML? | View source on deployed page; look for `<meta property="og:image" ...>` |
| iMessage shows stale card? | Apple cache; not ours to fix; share with `?v=2` if you must bust |

---

## §10. Change patterns — exactly what to touch for common edits

### §10.1. Add a new player

```
1. lib/picks.ts:
   - Add new entry to USERS<UserId>: { id, name, color, colorRgb, tickers }
   - Update UserId type union.
   - USER_LIST and TICKER_OWNERS auto-update via the IIFE at the bottom.
   - If picks include any new tickers, add them to TICKER_NAMES.

2. scripts/fetch-prices.ts:
   - No code change. Run: npm run fetch-prices -- --full
   - This fetches the new tickers' history and rewrites prices.json.

3. components: NO CHANGES NEEDED. The compare grid auto-stretches to N
   players (currently a 2x2 grid; if N exceeds 4, refactor UserCard
   layout in CompareView from grid-cols-2 to grid-cols-{N|2}).

4. STATE.md: update the Players table.
   OVERVIEW.md: update the players table.

5. Test: npm run build. Verify all 4 (now N) /portfolio routes are SSG'd.

6. Commit, push, verify on staging.
```

### §10.2. Add a new ticker for an existing player

```
1. lib/picks.ts:
   - Push the ticker into USERS[playerId].tickers.
   - Add to TICKER_NAMES if not present.
   - Per-pick $ allocation auto-recomputes (= $100k / new tickers.length).
     ⚠ This DROPS every existing holding's per-pick dollars proportionally.
     If you don't want that — if you want the player to literally add a
     new pick mid-game with fresh capital — that's a different mechanic
     not yet supported (would need a real ledger). Confirm with user.

2. npm run fetch-prices -- --full to grab the new ticker's history.

3. STATE.md / OVERVIEW.md: update the picks table.
```

### §10.3. Add a chart range (e.g., "5D")

```
1. lib/types.ts: Range type ← add "5D".
2. lib/portfolio.ts:
   - RANGE_DAYS: { "5D": 5, ... }
   - filterRange already handles numeric days.
   - rangeBounds same.
3. components/RangeTabs.tsx: RANGES array ← add "5D" in desired position.
4. CompareView pre-compute: app/page.tsx ALL_RANGES ← add "5D" so analysis
   is precomputed at build time.
5. No special handling needed unless you want intraday-style behavior.
6. STATE.md: nothing structural changed, just the new range.
```

### §10.4. Add a spin-off (when HON announces theirs)

```
1. lib/events.ts: push to SPINOFFS:
   {
     parentTicker: "HON",
     childTicker: "NEWCO",
     childName: "Honeywell Aerospace",
     effectiveDate: "2026-XX-XX",
     sharesPerParentShare: 0.25,   // distribution ratio
   }

2. lib/picks.ts: add NEWCO to TICKER_NAMES. Don't add to any user's
   tickers — the spin-off engine handles ownership via the parent.

3. npm run fetch-prices -- --full (grabs NEWCO's history starting at its
   effectiveDate; startClose for NEWCO is set to its first close).

4. portfolioSeries auto-includes the child position from effectiveDate
   forward. No view changes needed.

5. STATE.md / OVERVIEW.md: note the new event in the players' picks if
   you want it visible.
```

### §10.5. Change a player's color

```
1. lib/picks.ts: USERS[playerId].color and .colorRgb (kept in sync for
   any rgba() usage even though the codebase mostly uses hex).
2. python3 scripts/make-og.py and scripts/make-icons.py to regenerate
   the OG card and PWA icons.
3. STATE.md: update the Players table.
4. Verify: npm run dev, check the four user lines on Compare and the
   per-user accent on portfolio drill-downs.
```

### §10.6. Change refresh cadence default

```
The user picks the cadence at runtime in the scheduler UI. Don't
hardcode it. If they say "default to 5 min instead of 15 min":

scripts/stockgame_schedule.py: self.interval_var = tk.StringVar(value="5 min")
```

### §10.7. Add a metric to the home page

```
1. app/page.tsx: compute it server-side using lib/portfolio helpers.
   Add to props passed to <CompareView>.
2. components/CompareView.tsx: render it. Style match existing cards.
3. STATE.md §6: update CompareView's responsibilities row.
```

### §10.8. Move "live" determination to a different cutoff

E.g., 60 min instead of 30 min:

```
1. lib/portfolio.ts: LIVE_MAX_LAG_MS = 30 * 60 * 1000;
2. components/CompareView.tsx + PortfolioView.tsx: also have a local
   LIVE_LAG_MS constant. Keep them in sync (or refactor to share —
   minor cleanup; fine to leave for now).
```

---

## §11. Verification checklist before shipping any change

This repo has no automated unit tests. Manual verification:

1. `npm run build` — must complete with no errors. Type errors and SSG
   failures surface here.
2. `npm run dev`, open `localhost:3000` in browser at mobile width:
   - Click each tab (1D / 1W / 1M / 3M / 1YR / ALL). All render without
     console errors.
   - Tap a leaderboard card → land on player's portfolio. Back button
     visible. Hash deep-link from the InsightsCard works.
   - Scrub the chart with the cursor. Header values update; release
     drops scrub.
   - Switch to 1D, verify either pulsing endpoint (if market live) or
     "MARKET CLOSED" badge.
3. If you changed `prices.json` shape or `lib/portfolio.ts`:
   `npm run fetch-prices -- --full` and confirm it parses cleanly into
   all the views (open them in dev).
4. If you changed the scheduler: `npm run stockgame` opens the tkinter
   UI; click "Run Now" and confirm the script completes successfully
   (status label flips to ✓).
5. If you touched the cron: `bash scripts/cron-update.sh` directly,
   not via npm — confirms shell behavior matches what cron sees.

For the deploy pipeline end-to-end:
```bash
npm run refresh   # alias for cron-update.sh; safe to run any time
```

---

## §12. Style conventions

- **Match existing patterns.** This repo leans heavily on a small set of
  conventions: `"use client"` only where needed, inline Tailwind, dark
  theme by default, formatters in `lib/portfolio.ts`, components
  colocated by feature. New code should look like the surrounding code.
- **No new dependencies without a reason.** Adding npm packages for
  one-liners is discouraged — there's a working stack and a
  `--legacy-peer-deps` install constraint to live within.
- **Don't add error handling for things that can't fail.** The data
  layer is trusted (we control the snapshot). Network calls in scripts
  can fail — there `try/catch` is fine.
- **Don't write comments that just describe the code.** Comments earn
  their keep by explaining *why* something is done a non-obvious way
  (the `touch-action: none` comment on the chart, the `legacy-peer-deps`
  rationale, the spin-off math, the rehydrate-from-intraday-by-index in
  CompareView, etc.).
- **Single-quote vs double-quote, semicolons, etc:** match Prettier
  defaults used in this repo. Don't reformat unrelated code.

---

## §13. Pushing changes — branch model

- `main` is protected. CI build must pass; PRs required for code
  changes from the laptop.
- The Mac mini's auto-commits ARE allowed to push to main directly
  (bypass list = `btheis15`), so the schedule keeps working.
- Don't force-push to `main`. Don't merge unreviewed code into `main`
  from shared environments.
- Expected workflow from the laptop:
  ```
  git checkout -b feat/xyz
  # ... edit, save, npm run build ...
  git commit -am "..."
  git push -u origin feat/xyz   # pre-push hook runs npm run build
  gh pr create
  # CI green → merge → webhook deploys
  ```

---

## §14. What you don't need to worry about

- **Authentication.** GitHub auth (gh keyring) and Vercel auth (CLI
  token) are persisted on the developer's Mac. New machines need a
  one-time `gh auth login` and (optionally) `vercel login`. There are
  no API keys in the codebase.
- **Secrets.** None. Yahoo Finance is unauthenticated. Vercel project
  doesn't need env vars. `.env*` is gitignored.
- **Database.** None. The "database" is `public/data/prices.json`
  committed to the repo. Vercel rebuilds on each push.
- **Manual CI.** None to invoke. `build.yml` runs automatically.

---

## §15. Project history (very condensed)

This is for context only — not exhaustive. Latest commit is what's true.

- v0: Brian + Kevin, daily closes only, 4 routes, 4 ranges (1W–ALL).
- v1: PWA polish — install hint, OG card, footer, cache headers,
  pull-to-refresh, refresh-on-resume. Vercel deploy.
- v2: Dividends + spin-off plumbing.
- v3: Rick + Lee added. Multi-owner tickers (NVDA/TSLA both Kevin and
  Rick). Per-user share allocation. Tab bar simplified to Compare /
  Stocks. "What's driving it" insights ranked by leaderboard order.
- v4: 1D view. Intraday 15-min bars. Full-day axis. Live pulsing
  endpoint. Market-state badge. Subtle dashed baseline reference line.
- v5: Mac mini hardening. Branch guard, rebase-before-fetch, pause file,
  conditional npm install. Pre-push hook for code-vs-data builds. CI
  workflow on PRs. Branch protection. STATE.md / OVERVIEW.md / CLAUDE.md
  canonical docs introduced and symlinked at the parent folder level
  for iCloud-Desktop discovery.

---

## §16. Trust the user

The user knows what they want. Confirm before doing destructive things
(force-push, deleting branches, reverting commits, removing a player)
but otherwise lean toward acting on the request rather than
over-clarifying. This is a personal project; the user iterates fast.

If a request is genuinely ambiguous, propose two concrete interpretations
and ask which. Don't ask abstract clarifying questions like "what do you
mean by X?" — that wastes a turn.

---

## §17. End of file

If you've made it here, you have the complete operating context. Now
read `STATE.md` for the structured tables and you'll be fully primed to
work on this codebase.
