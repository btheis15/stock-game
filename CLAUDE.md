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
   patterns to a different project. The motion doctrine lives there too;
   note that the old "only liveness/feedback animates, transitions don't"
   rule has been superseded by the §6.5 iOS-style motion layer (CSS-only
   tab fade + drill push/pop + animated sheets). MLR / innjoy port from
   this repo, so port the §6.5 primitives (motion tokens, `<Sheet>`,
   `template.tsx`, `.press`, the reduced-motion guard) as a set.
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
  scheduler UI (tkinter, long-running)             edits from laptop OR
   │                                                Claude Code mobile,
   ├─ threading.Timer  →  cron-update.sh    (15m)   commits to GitHub
   ├─ threading.Timer  →  digest-update.sh  (M–F)         │
   ├─ background pull: git fetch + pull every 60 s ←──── origin/main
   │   (independent of cron's own pull, so phone-pushed
   │    code lands on disk within ~60 s even overnight)
   └─ self-watch: poll own mtime every 60 s — when a
       newer stockgame_schedule.py lands on disk,
       persist active schedule + os.execv. No manual
       SSH needed.                                        │
              ↓                                                  ↓
      scripts/cron-update.sh                                 git push
       ├─ git pull --rebase                ←─── pulls latest ────┘
       ├─ conditional npm install
       ├─ npm run fetch-prices            writes prices.json
       ├─ swift digest.swift --scope fast  re-renders game 1D/1W/1M
       │                                    templates with live pcts
       └─ git commit + push                ─── data-only push: Vercel build
                                                SKIPPED (vercel.json
                                                ignoreCommand); the app reads
                                                origin/main at request time
                                                via the GitHub Contents API
                                                (lib/remote-json.ts), so data
                                                is live in ≤ ~60-90 s with no
                                                rebuild. Code pushes still
                                                build + deploy normally.
                                                                  ↓
                                                              [iPhone PWA]
                                                              fresh on every open
                                                              (cache: must-revalidate)
```

Three principles fall out of this:

1. **All app state is committed to `main`.** Code, content, and the data
   snapshot all share the same git history. There is no separate database,
   no edge config. `main` IS the live API: the deployed app reads the data
   JSONs from origin/main at request time (GitHub Contents API, 60s TTL,
   filesystem fallback). If it's not in `main`, it doesn't exist.
2. **`main` triggers deploys only for code.** The GitHub→Vercel webhook
   fires on every push, but `vercel.json`'s `ignoreCommand`
   (`scripts/vercel-ignore-build.sh`) skips the build when only
   `public/data/*`, `public/digests.json`, `config/funds.json`, or
   `config/thesis.json` changed since the last deployed SHA. The Mac mini
   doesn't run Vercel CLI — it just pushes data commits, and the app picks
   them up without a rebuild.
3. **The Mac mini and laptop never collide, and never drift.** Every
   cron tick does `git pull --rebase --autostash origin main` before
   doing work, so laptop pushes land cleanly on the mini. Bash + Swift
   + TS files re-read their source on every fire, so commits are live
   on the next tick. The tkinter scheduler is the lone long-running
   process; it auto-restarts itself when a new version of its source
   appears on disk (see §8.5), keeping the Mac mini at exactly the
   commit on `origin/main` with zero manual intervention.

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
                         ├─ weeklyPortfolioSeries(data, userId)   → PortfolioPoint[] | null  (1W view, hourly bars)
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
TickerSeries   = { ticker, name, startClose, closes[], dividends?[], intraday?[], weekly?[] }
                  // intraday[] = today's 15-min bars; weekly[] = past 8 days of 1h bars (1W view)
DailyClose     = { date: "YYYY-MM-DD", close: number }
IntradayBar    = { t: ISO_UTC, close: number }
DividendEvent  = { date: "YYYY-MM-DD", amount: number }
PortfolioPoint = { date: string, value: number }   // date can be daily OR ISO depending on source
HoldingRow     = { ticker, shares, startClose, currentClose, costBasis, currentValue, pl, plPct, rangeStats }
RangeMover     = { ticker, pct, dollars, price, points, ownerId }   // price = endClose; points = per-share $ delta
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
4. For each player, call `weeklyPortfolioSeries(data, u.id)` → past
   5-trading-day hourly portfolio curve (or `null` if no ticker has
   weekly data). Used by the 1W view; non-null path lets CompareView
   set `compactX` on the chart.
5. For each non-1D range, call `analyzeRange(data, r)` → per-user range pct
   + per-ticker movers. Build `analyses: Record<Range, RangeAnalysis>`.
6. Render `<CompareView series={...} intraday={...} weekly={...} analyses={...} intradayDate={...} />`.

**Client side** (`components/CompareView.tsx`):
1. `useState<Range>("1D")` for range tab — Compare opens on 1D.
2. `useState<ScrubState | null>(null)` for chart scrub state.
3. `isIntraday = range === "1D"`. Determines all special-case behavior.
4. `live = isIntraday && lastPointIsLive(intraday[firstUser].points)` →
   true if the most recent intraday timestamp is < 30 min ago. Drives the
   pulsing endpoint and the LIVE/MARKET CLOSED badge.
5. `ranged: Record<UserId, PortfolioPoint[]>` — three branches:
   - 1D: `intraday[u.id].points` (15-min bars, today's session)
   - 1W: `weekly[u.id]` if all users have weekly data (hourly bars over
     the last 5 trading days). `isWeeklyHourly` flips on; ScrubChart
     receives `compactX={true}` so overnight + weekend gaps collapse.
   - else: `filterRange(series[u.id], range)` (daily closes, calendar-time axis)
6. `stats` (useMemo): for each player, compute current value, baseline,
   pct. For 1D, baseline = previousClose. Otherwise, baseline = first
   point in `ranged`. Sort descending by pct. **Crucial scrub detail:**
   `chartSeries.data` ALWAYS plots normalized pct values (not just in 1D).
   The chart's `onScrub` therefore reports pct fractions, not dollars. So
   `stats` rehydrates by indexing `ranged[u.id][scrub.index]` to get the
   raw $ value for the leaderboard. Don't break this — pct on chart, $
   in stats.
7. `chartSeries: ChartSeries[]` — every range is normalized to
   `(value - baseline) / baseline` so all N lines start at y=0 and the
   visual order matches the leaderboard ranking. baseline=0 dashed line is
   passed for every range as the 0% reference.
8. `xDomain: [Date, Date] | undefined` — for 1D, `sessionBoundsForDate(intradayDate)`
   forces the axis to span the full trading session even when only part is filled.
9. Render header (`{leader.user.name} leads` or `It's a tie`), gap pct +
   gap $, optional `<MarketStateBadge>`, `<ScrubChart>`, `<RangeTabs>`,
   `<DigestPanel>` (game-wide briefing scoped to the active range — the
   narrative cause), sports-standings-style leaderboard (`<UserRow>` stack
   — rank + color dot + name + gap-to-leader + value; auto-scales to N
   players; the consequence of what the digest just described),
   `<InsightsCard>` (rendered for every range including 1D — `app/page.tsx`
   precomputes a 1D analysis too), Game rules.

   Render order is cause → consequence: the DigestPanel sits ABOVE the
   leaderboard so reading top-down flows chart → range tabs → "what
   happened" → standings. The leaderboard is the *consequence*; the digest
   is the *story*. The "⬡ Summarized by Apple Intelligence" attribution
   is rendered inline on the digest header (right side of the
   "DAILY BRIEFING" label row), not as a footer block — visible without
   expanding the card.

### §5.2. Portfolio drill-down (`/portfolio/[user]`)

**Server side** (`app/portfolio/[user]/page.tsx`):
1. `generateStaticParams()` returns `{user: 'brian'|'kevin'|'rick'|'lee'}`
   for SSG.
2. Validate the param is a valid UserId, else 404.
3. Compute `series`, `intraday`, `weekly` (`weeklyPortfolioSeries`), and
   `holdings` (via `buildHoldingRows`).
4. Render `<HeaderBack title="Compare" />` + `<PortfolioView ... />`.

**Client side** (`components/PortfolioView.tsx`):
1. Same range/scrub/isIntraday/live machinery as Compare. Defaults to 1D.
2. **Single line**: `chartSeries = [{ id: userId, color, data: ranged }]`.
   No normalization needed (only one line).
3. `baseline` for the chart's dashed reference line = either
   `intraday.previousClose` (1D) or `ranged[0].value` (other ranges).
4. Holdings list below the chart. Each row reads `holding.rangeStats[range]`
   and shows that range's pct + signed $ delta (e.g., `+4.22% • +$482`).
   The list re-sorts by the active range's pct so the top holding is
   whoever's leading *for that range*. Each row has `id={ticker}` so
   deep-links like `/portfolio/kevin#MRVL` jump-scroll and trigger the
   green flash animation.

### §5.3. Stock detail (`/stock/[ticker]`)

**Server side** (`app/stock/[ticker]/page.tsx`):
1. `generateStaticParams()` returns `{ticker}` for every entry in
   `ALL_TICKERS` (currently 45).
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
5. Below chart: ONE `<PositionCard>` per owner. NVDA and TSLA show two
   cards each (Kevin's + Rick's); AAPL also shows two (Brian's + Lee's).
   Each card has its own shares / cost basis / dividends-received /
   current value / total return. Same numbers when they have the same
   allocation, different numbers if not.
6. Below positions: `<DividendsList>` if `series.dividends?.length > 0`.
   Per-share amounts only — converting to per-position cash is each
   PositionCard's job.

### §5.4. Stocks list (`/stocks`)

**Server**: load PriceData, pass `series: TickerSeries[]` (in `ALL_TICKERS`
order) to `<StocksListView>`.

**Client**: filter chips (All / Brian / Kevin / Rick / Lee / Gene), sorted by
total %-return-since-Feb-5 desc. Multi-color owner swatch when 2+ players
own a ticker. Each row links to `/stock/{ticker}`.

### §5.5. Tee Times (`/tee-times`)

A bonus tab so the friend group can quickly hop into Inshalla CC's
foreUP booking page. **The current implementation is a deliberate
deep-link landing — not a native list.** We display nothing about
foreUP's tee-time data in-app; we just provide three quick-pick day
shortcuts that open foreUP pre-filtered to Daily Golf for the chosen
date.

**Why deep-link only, not a native list?** foreUP's [Terms of Use](https://stage.foreupsoftware.com/terms_and_conditions.php)
§3.2(v) prohibits "automated software, devices, or other processes to
'crawl' or scrape data from the Service." Their `robots.txt` disallows
all automated agents (`User-agent: * / Disallow: /`). An earlier version
of this view ran a server-side proxy that hit foreUP's
`/api/booking/times` JSON endpoint and rendered the schedule natively;
that approach worked technically but ran afoul of those clauses. The
deep-link landing avoids the problem entirely — we don't read foreUP's
data, we just hand off cleanly. URL crafting (passing
`booking_class_id`, `schedule_id`, `date` query params they themselves
respect) is normal browser behavior, not scraping.

**The deep-link contract** (discovered by reading the foreUP SPA bundle,
preserved here for future reference):

```
https://stage.foreupsoftware.com/index.php/booking/19715/2251
  ?booking_class_id=2431      ← Daily Golf class; skips chooser
  &schedule_id=2251           ← required alongside booking_class_id
  &date=MM-DD-YYYY            ← optional; pre-fills the date picker
  #/teetimes                  ← SPA route to the time list
```

The SPA's router checks `urlParams.get('booking_class_id') &&
urlParams.get('schedule_id')` and, if both are present, calls
`filters.set('booking_class', ...)` + `filters.set('schedule_id', ...)`
before rendering tee times. It also reads `date`, `players`,
`time_of_day`, `holes` from the same query string (we only set `date`
for now; the others are available for future use).

**TeeTimesView responsibilities** (`components/TeeTimesView.tsx`):
- Small header: "Tee Times · Inshalla CC · Tomahawk, WI"
- "Quick book" card with three rows: Today, Tomorrow, day-after. Each
  is an `<a target="_blank">` to the deep link with that day's date.
- "View all available times ↗" primary CTA — same deep link without a
  date param, so foreUP shows its own date picker.
- Disclosure copy: "Tee times, pricing, and booking are managed by
  Inshalla Country Club via foreUP."
- A bare "Inshalla CC on foreUP →" footer link without `booking_class_id`
  for users who want to browse Members or browse without filters.

**Constants in the codebase**:
- `COURSE_ID = 19715` — Inshalla Country Club
- `SCHEDULE_ID = 2251`
- `DAILY_GOLF_BOOKING_CLASS_ID = 2431` (the schedule's other class is
  "Members" id 49668; we always link to Daily Golf for the quick-book
  rows since that's the family's class)
- foreUP base URL: `https://stage.foreupsoftware.com/`. Note `stage.`;
  foreUP's production endpoint is presumably `app.foreupsoftware.com`
  but the user's URL pointed at stage and that's what works.

**If you ever get permission to display schedule data in-app** (e.g.
Inshalla's pro shop gives written consent, or foreUP issues a partner
embed code), the proxy + native-list pattern lives in
`docs/embedding-third-party-booking.md` §1–§7. The git history at
commits 360e810 → 3326d72 has the full working implementation
(`/api/tee-times` edge proxy, `/api/tee-times/config` SCHEDULES scraper,
booking-window-aware date picker, holes-aware fee selection). Restoring
it is a 1-hour change. Don't restore without permission.

**Daily Deals widget (Sagacity Golf)**: There's a third pattern at
play on this tab — an explicit embed widget. Inshalla's "Daily Deals"
discounted-tee-times product is built by Sagacity Golf and served
from `https://inshalla.dailydeals.golf/widget/layout/2/times`. Three
signals confirm it's an official partner-embed product:

1. The path is literally `/widget/...`
2. `Access-Control-Allow-Origin: *` — they want cross-origin requests
3. No `X-Frame-Options`, no `frame-ancestors` CSP
4. The widget itself promotes "Add Daily Deals to your website" at the
   bottom of its own page
5. UTM-tagged referrals from foreUP's booking engine show partners are
   expected to embed it (`utm_source=foreup-booking-engine&...`)

Even though it's embed-friendly, `TeeTimesView` doesn't iframe it — it
surfaces a tap-through card that opens the widget in a new tab. (We tried
iframing it inline; the fixed-height frame never sized cleanly inside our
card chrome on mobile, so we hand off instead, matching the foreUP
"Quick book" rows.) We attach `utm_source=stockgame-app&
utm_medium=tee-times-tab&utm_campaign=daily-deals` so Inshalla's analytics
can attribute traffic distinctly from this app vs. their other partner
integrations. **This is fundamentally different from the foreUP
situation** — Sagacity's widget is a sanctioned embed product (we simply
choose to hand off to it), whereas foreUP's booking page is the primary
user-facing site that doesn't license embedding.

**Reusable playbook**: `docs/embedding-third-party-booking.md` is a
field guide covering all three patterns: deep-link-only (compliant
default for un-licensed SaaS, what we use for foreUP), proxy +
native-list (when permission is in hand), and explicit-embed-widget
(when the SaaS publishes one — Sagacity Daily Deals is such a widget,
though for visual consistency we currently hand off to it rather than
embed). Read that file before adding the next SaaS-embed feature.

### §5.6. Theme system

The dark palette is the default `:root`. `<ThemeController>` (mounted in
`app/layout.tsx`) toggles `<html data-theme="light">` while the market
is open (`Date.now() − latestIntradayBar < 30 min` — the same rule as
`isMarketLive`). It re-evaluates every 60 seconds so the page flips
when the market crosses open/close without a reload.

**Semantic design tokens (migration COMPLETE 2026-07-21).** Theming is
variable-driven: `globals.css` defines surface tokens
(`--surface-page/chrome/card/raised/pressed/…`), text tokens
(`--ink`, `--ink-2/3/muted/faint/ghost/ghost-2`), and border tokens
(`--border-hairline/hairline-70/deep/strong/ghost`) — assigned wholesale in
`:root` (dark), `[data-theme="light"]`, and `[data-theme="twilight"]`, and
exposed as Tailwind utilities via `@theme inline` (`bg-card`, `bg-chrome`,
`text-ink-muted`, `border-hairline`, `border-hairline-deep`,
`border-edge-strong`, `divide-hairline`, …). Every component uses these;
the old per-utility `!important` override blocks are GONE. Token values
were copied exactly from those overrides, so the migration was
pixel-identical. Three rules:

1. **Markup never uses raw zinc/black/white color utilities** —
   `npm run check-theme` (denylist mode) fails on any
   `bg|text|border|divide|decoration|ring|placeholder`-`black|white|zinc-N`
   in `components/` + `app/`, in ANY variant (`hover:` included — semantic
   utilities theme interaction states too). The only exceptions are the
   `ALLOWLIST` entries in `scripts/check-theme-coverage.sh` (inverted white
   pills, modal scrim), each with a justification.
2. **Never put an opacity modifier on a semantic token** (`bg-card/50`) —
   the guard fails on that too. Each translucency is its own token,
   assigned in all three theme blocks (that's what killed the historical
   "overridden `/50` and `/70` but not `/60`" bug for good).
3. **When you mint a token**: assign it in all three theme blocks, map it
   in `@theme inline`, and add its utility class to the theme-transition
   selector group at the bottom of `globals.css` so it cross-fades at
   session flips.

The guard runs in CI (`.github/workflows/build.yml` `theme-coverage` job)
and the pre-push hook alongside `npm run build`.

**Wide-gamut color (P3) + per-page accents (added 2026-07-21).**
On Display-P3 screens an `@supports (color: color(display-p3 1 1 1))` layer
upgrades `--gain`/`--loss` (globals.css); player accents carry a P3 variant
(`color_p3` in config/roster.json, exposed as `colorP3` by `lib/picks.ts`).
DOM styling uses `var(--gain)`/`var(--loss)` — never
hardcode `#00C805`/`#FF453A` in new code. SVG *attributes* (chart strokes,
gradient stops) can't resolve `var()`, so client components pick the value
via `lib/color.ts` (`useP3()` + `accentFor(entity, p3)`) — the hook starts
false on server + first paint (hydration-safe) and flips post-mount.
Detail pages (portfolio/stock/fund) publish the owning entity's accent as
`--accent` on the page root; the deep-link `holdingFlash` and other
accent-aware chrome read it (fallback: gain green). The leader row and hero
gap number on Compare get a subtle same-hue glow via `color-mix`; twilight
gets a fixed dawn-gradient page wash (dark stays pure #000 — OLED rule).
FundamentalsPanel's SVG fill constants stay hex on purpose (fill attrs).

**Theme QA override.** `ThemeController` honors `?theme=light|twilight|dark`
(persisted to localStorage; `?theme=auto` returns control to the market
clock). This is the fast way to eyeball all three themes — the 60s session
re-apply no longer fights DevTools edits. Left enabled in production
deliberately, for reproducing theme reports on-device.

The Robinhood-light palette is intentionally muted so brand colors
(player accents + gain-green / loss-red) stay readable on white. The
chart's accent gradients and animations are the same in both themes, as
is the whole §6.5 motion layer (it animates transform/opacity, not
color).

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
  compactX?: boolean                   // 1W: index-based x-axis (gap collapse)
}
```

**Internal flow:**
1. `<ParentSize>` reports container width.
2. `dates`: from `series[longest].data`, parsed as Dates. Date strings can
   be `YYYY-MM-DD` (daily) or full ISO (intraday) — distinguish by
   `s.date.length > 10`.
3. `xScale`: branches on `compactX`. `indexScale = scaleLinear over
   [0, dates.length-1]` when compactX is true (one slot per data point —
   used by 1W to collapse overnight + weekend gaps); otherwise
   `timeScale = scaleTime` from `xDomain` if provided, else
   `[dates[0], dates[last]]`. Helper `xAt(i)` abstracts the difference at
   every callsite (line, area, scrub, live endpoint).
4. `yScale`: `scaleLinear` over the data's y range (with `baseline`
   included if set, then ±8% pad).
5. Pointer events on the SVG:
   - `pointerdown` → `setPointerCapture` so the SVG owns the gesture even
     after the finger leaves its bounds. Also calls `handlePointer`.
   - `pointermove` → if pointer is captured (touch) or mouse is moving,
     `handlePointer`.
   - `pointerup`/`cancel`/`leave` → `reportScrub(null)`.
6. `handlePointer(clientX)`: branches on `compactX`. In compactX mode the
   inverted x is rounded to the nearest integer index. In time mode the
   d3-array bisector logic runs (invert → bisect dates → nearest neighbor).
   Either way, `reportScrub(idx)` fires with the resolved data-point index.
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
3. `<AreaClosed>` per series (gradient fill, x-positions via `xAt(i)`).
4. `<LinePath>` per series (curve = `monotoneX`, x via `xAt(i)`).
5. **X-axis tick labels** along the bottom strip (`PAD_BOTTOM=28` reserves
   the room). Two helpers compute positions:
   - `computeXTicksTime(timeScale, width, dates)` — 3–5 evenly distributed
     time positions; format adapts to span (hour / weekday / month-day /
     month / month-year).
   - `computeXTicksCompact(dates, xAt)` — one tick per trading-day boundary
     (UTC y/m/d transition); weekday-short label ("Fri", "Mon").
   First and last labels are clamped inward by `LABEL_EDGE_PAD` (12px) so
   the text doesn't hug the screen edges. Color via `--chart-axis-label`
   CSS var (theme-aware).
6. If `liveEndpoint && !scrubbing`, two concentric `<circle>`s at the
   most recent point, animated by `livePulseRing` and `livePulseFill`
   keyframes in `globals.css`. **Note:** `r` is animated via CSS, not
   `style`, so it works inside `<svg>`.
7. If scrubbing, vertical line + filled circle + glow circle at the
   scrubbed point on each line.

**Critical behavior:**
- `style={{ touchAction: "none" }}` — without this, vertical-finger-drift
  during a horizontal scrub causes iOS Safari to steal the gesture for
  page scroll, releasing pointer capture and firing `pointercancel`. The
  scrub feels like it "lets go." **Don't change this** — it is unchanged
  by the §6.5 motion layer, which never adds JS/React per-frame animation
  to the scrub path. The 16ms gesture budget for the scrub is unchanged.
- The live-endpoint pulse animates the circle's `r` via a CSS keyframe,
  not an inline `style` — that's the only way `r` animates inside `<svg>`.
  Still true; don't move it to JS.
- Chart line / area / scrub fill the parent's full width edge-to-edge.
  Only the first / last tick labels are inset (cosmetic, see render step 5).
- Date strings of length > 10 (full ISO) are parsed as-is; otherwise
  appended `T00:00:00Z` to anchor at UTC midnight.

---

## §6.5. The motion layer (iOS-style transitions, sheets, tap feedback)

> Shipped in commit `ef17cd9` (on `main`). The app used to be deliberately
> motion-sparse — only liveness/feedback animated (live pulse, holding
> flash, pull-to-refresh, scrub crosshair). That rule is **superseded for
> navigation and overlays**: the app now has purposeful, iOS-style
> transitions (tab cross-fade, drill-in push/pop) and animated bottom
> sheets. The reframed doctrine: **animation is for liveness, feedback,
> AND purposeful iOS-style transitions — all done in CSS, within the perf
> budget.** Three guardrails still hold absolutely:
>
> 1. **CSS transforms/opacity only** (GPU-friendly). No new JS/React
>    per-frame animation. The chart-scrub 16ms gesture budget and the
>    `touch-action: none` rule (§6) are untouched.
> 2. **`prefers-reduced-motion` is honored globally** (see the guard
>    below — the repo had *no* reduced-motion handling before this). Any
>    new motion you add must degrade through it automatically.
> 3. **Sheets/modals are for forms, filters, info, and destructive
>    actions — NOT navigation.** Drilling into a detail route is still a
>    real route change (now animated); don't replace it with a sheet
>    (DESIGN.md §11 still holds).

### Motion tokens (`app/globals.css` `:root`)

Use these everywhere; don't hardcode durations/easings in component styles.

```css
--ease-ios:     cubic-bezier(0.32, 0.72, 0, 1);   /* slides (push/pop, sheet) */
--ease-out-ios: cubic-bezier(0.16, 1, 0.3, 1);     /* fades, press */
--dur-press: 140ms;   /* tap-shrink */
--dur-fade:  220ms;   /* cross-fade, backdrop */
--dur-slide: 320ms;   /* push/pop, sheet slide */
```

### `.press` tap feedback

`.press` shrinks an element to `scale(0.96)` on `:active` for an iOS tap
feel. It uses transition **longhands** (`transition-property: transform,
background-color, border-color, color`) on purpose — the shorthand would
clobber Tailwind's `transition-colors`, so an element with both still
animates its color change. Add it to native interactive elements (`a`,
`button`) that get `:active` on touch. Already applied to: TabBar links,
the HeaderBack back button, the FilterToolbar buttons, and the WhatsNew
bell/close. Add `.press` to any new tappable control for consistency.

### Route transitions — `app/template.tsx`

`template.tsx` (not `layout.tsx`) re-mounts its subtree on every App
Router navigation, so a CSS entrance animation replays on each route
change. It classifies the navigation off a **module-level `prevPath`**
compared against the detail-route regex `/^\/(stock|portfolio|fund)\//`:

- **tab ↔ tab** (Compare `/`, Stocks `/stocks`, Tee Times `/tee-times`)
  → `.pt-fade` (cross-fade, `--dur-fade`).
- **drilling INTO a detail** (`/stock/*`, `/portfolio/*`, `/fund/*`)
  → `.pt-push` (slide in from the right, `--dur-slide`).
- **backing OUT of a detail** → `.pt-pop` (slide in from the left).

All three are CSS keyframes (`pageFade` / `pagePush` / `pagePop`) with
**`animation-fill-mode: backwards`**, so NO transform lingers at rest.
That's deliberate and load-bearing: ManageFundsSheet still renders a
`position: fixed` modal inline (the other modals now portal to `<body>`
via `<Sheet>`), and a lingering transform on the wrapper would re-root
that fixed descendant and misplace it. Don't switch this to a framer-motion `x`/`y` wrapper for
the same reason. **Shared-element / cross-route morph (View Transitions
API) was intentionally skipped** for older-device compatibility — don't
claim it exists.

### `<Sheet>` primitive — `components/Sheet.tsx`

The reusable iOS bottom-sheet. **Use this for any new overlay** instead of
hand-rolling a modal shell (it replaced four hand-copied ones). It is
CSS-only — no animation library.

Props:

```ts
<Sheet
  open={boolean}            // controlled visibility
  onClose={() => void}      // fired by backdrop tap / Done / Escape
  title?={string}           // heading; also the dialog's accessible name
  eyebrow?={string}         // small uppercase kicker above the title
  doneLabel?={string}       // top-right dismiss label (default "Done")
  full?={boolean}           // full-height (forms/wizards); default = content-height detent
  header?={ReactNode}       // custom header slot; replaces eyebrow/title/Done
                            // (must bring its own dismiss affordance + bottom border)
  footer?={ReactNode}       // pinned action bar below the scroll area (Back/Next/
>                           // Save rows); brings its own top border + padding
  {children}
</Sheet>
```

Behavior:
- **Portals to `document.body`** — immune to ancestor transforms (e.g. the
  route-transition wrapper), so it never gets re-rooted.
- **CSS slide-up open** (`.sheet-panel` / `sheetIn`), backdrop fade
  (`.sheet-backdrop` / `overlayIn`). Closing adds an **`.is-closing`**
  state that slides back down (`sheetOut`, `forwards` fill) and unmounts
  on `animationend` — that's why the panel stays in the DOM through its
  exit.
- **Detent**: partial **content-height** by default; `full` gives a
  full-height sheet for forms (`100dvh` on mobile, capped on desktop).
- Grab handle, `role="dialog"` + `aria-modal`, body-scroll lock,
  Escape-to-close, safe-area bottom padding. On desktop (sm+) it centers
  as a normal modal card.
- **No drag-to-dismiss** — close via backdrop tap / Done / Escape only.
  Don't claim a drag gesture exists.

Already converted to `<Sheet>`: **FilterSheet** (`components/FundsFilter.tsx`),
**WhatsNew** (`components/WhatsNew.tsx`), **CreateFundModal** and
**EditThesisModal** (both `full` sheets using the `footer` action-bar slot).
Still on its own hand-rolled shell: **ManageFundsSheet**.

### Content entrances (added 2026-07-21)

A fourth motion job joined liveness/feedback/transitions: quick, one-shot
content entrances, all CSS on the shared tokens (`--dur-enter: 360ms`):

- **Chart draw-in** — ScrubChart's line paths carry `pathLength={1}` +
  `.chart-line-draw` (stroke-dash sweep); the area fades in behind
  (`.chart-area-in`). A `drawKey` derived from (series ids, point count,
  first date) keys the path groups so a range switch remounts them and
  replays the entrance. Scrub overlays and pointer handling live OUTSIDE
  the keyed groups — the §6 scrub contract is untouched.
- **`.stagger-in`** — children rise in with ≤28ms/row delays (nth-child,
  capped at the 10th). Mount-only: re-sorts reorder mounted children
  without replaying. On the leaderboard, holdings, stocks list.
- **`.content-in`** — fade-up for cards replacing a skeleton (DigestPanel).
- **`.reveal` / `.is-open`** — height animation via grid-template-rows
  0fr↔1fr (same technique as WhatsNew); DigestPanel's expanded meta uses it
  with `inert` on the collapsed state so hidden links leave the tab order.
- **Tab bar**: active icon does a one-shot `tabPop` (keyed by active state)
  and an accent dot fades in under the label; sheet backdrops blur in.
- `.press` now also covers leaderboard rows, holdings rows, stocks-list
  rows, and the digest card.

### Global reduced-motion guard (`app/globals.css`)

A single `@media (prefers-reduced-motion: reduce)` block neutralizes all
animations/transitions (`animation-duration`/`transition-duration` → near-0,
iteration-count → 1) and turns off smooth scroll. This is global and
closes a gap — the repo had no reduced-motion handling before the motion
layer. **Anything you animate is covered automatically**; don't bypass it.

### framer-motion layer (added 2026-07-21)

JS springs now cover what CSS can't, all under `<MotionProvider>`
(`MotionConfig reducedMotion="user"` in app/layout.tsx):

- **`<AnimatedRow>`** (components/AnimatedList.tsx) — FLIP re-ranking:
  leaderboard, holdings, and stocks-list rows glide to new slots on a
  sort/rank change. CompareView passes `animate={scrub == null}` — rows
  must SNAP while a scrub drives live re-ranking (the §6 16ms budget
  covers everything the scrub updates, not just the chart).
- **`<AnimatedNumber>`** — rAF count-up (~450ms, cubic ease-out,
  tabular-nums) on the Compare hero gap, leaderboard values, and the
  PriceHeader hero $. HARD RULE: pass `animate={false}` whenever a scrub
  is active so values render raw, never eased.
- **RangeTabs** — the active pill is a `layoutId="range-pill"` shared
  element that glides between tabs.

### framer-motion is NOT gone

`framer-motion` was **not** removed from the app. The new motion layer is
all CSS, and WhatsNew moved off framer-motion (its accordion is now a CSS
`grid-template-rows: 0fr ↔ 1fr` transition), but framer-motion is **still
a dependency and still used** by:
- `BreakdownDonut` — slice-pop spring,
- `PortfolioComposition` — view crossfade,
- `PortfolioThesis` — accordion.

Don't remove the package or assume the app is framer-free.

### Theme parity

The motion layer is theme-independent: it animates transform/opacity and
reads CSS motion tokens, so it behaves identically in dark / light /
twilight. The `.sheet-panel` surface uses bare dark-surface utilities
(`bg-zinc-950`, `border-zinc-800`) that the §5.6 theme overrides flip —
so new sheet content must follow the same theme-coverage rule (`npm run
check-theme`).

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
   `(value - baseline) / baseline` so every player's line starts at 0%.
   This is now done for every range, not just 1D. Stats rehydrate the
   $ value via `ranged[u.id][scrub.index].value`.
5. **Live state**: `isMarketLive(series.intraday)` checks if the most
   recent bar is < 30 min old. Drives `liveEndpoint` (pulsing ring) and
   the `<MarketStateBadge>` (LIVE vs MARKET CLOSED).
6. **InsightsCard 1D analysis**: `analyzeRange(data, "1D")` is supported.
   It uses `rangeCloses` which scores each ticker as
   (prev-day-close → latest intraday bar). `app/page.tsx` includes "1D"
   in `ALL_RANGES` so the analysis is precomputed at build time.

**Common 1D pitfalls:**
- Don't pass `xDomain` outside 1D — it'll force a too-wide axis on
  daily ranges.
- Don't enable `liveEndpoint` outside 1D — the "last point" of an ALL
  range chart is just yesterday's close, no pulse needed.
- Beware of timezones in `sessionBoundsForDate`. Heuristic: month 2-10
  → EDT (UTC-4), else EST (UTC-5). Wrong on the 4 DST transition days
  per year; harmless for axis rendering.

---

## §7.5. The 1W special case (sibling of §7)

1W has its own quirks distinct from 1D — different data source, different
x-scale, but the same "this range is special" energy.

1. **Data source**: `series.weekly[]` (1h bars over the past ~8 days,
   regular session only). Helpers: `weeklyPortfolioSeries(data, userId)`
   and `weeklyTickerSeries(series)` — both return `null` if the ticker
   has no `weekly` field, and the views fall back to
   `filterRange(daily, "1W")` in that case.
2. **Trim to last 5 trading days**. The fetch grabs an 8-day window so
   we always have enough headroom even if Yahoo's bars start mid-day at
   the edge. `trimToLastNTradingDays(bars, 5)` then keeps only the most
   recent 5 distinct trading days so the chart shows a clean Mon–Fri
   week without the partial-first-day stub.
3. **Filter the live partial bar**. Yahoo's hourly endpoint adds a
   "current quote" bar with the actual second-of-now timestamp (e.g.
   `19:29:33.000Z`) when the market is mid-hour. That bar makes the
   spacing between the last two points uneven (~59 min instead of 60).
   `isHourBoundaryBar(b)` (in `lib/portfolio.ts`) drops anything whose
   timestamp doesn't end with `:00.000Z`. All plotted points sit at
   clean hourly boundaries.
4. **compactX x-axis**. The chart switches from `scaleTime` to
   `scaleLinear` over `[0, dates.length-1]` so every data point gets one
   equal-width slot. Overnight + weekend gaps disappear. The line stays
   continuous across day boundaries. CompareView / PortfolioView /
   StockView all pass `compactX={isWeeklyHourly}` to ScrubChart.
5. **Day-boundary tick labels**. `computeXTicksCompact` walks the dates
   array finding y/m/d transitions and labels each first-bar-of-day with
   weekday short ("Fri", "Mon", "Tue"). Edge labels clamped inward.

**Common 1W pitfalls:**
- Don't pass `compactX` outside 1W — daily-close ranges need calendar
  time spacing because their points really are days apart.
- Don't try to use `xDomain` with `compactX` — they're mutually
  exclusive; `compactX` short-circuits the time scale entirely.
- If the 1W chart looks weird and you suspect data, check three things:
  (a) is `weekly` populated on every ticker? (b) does the trimmed
  window have all hourly intervals? (c) did `isHourBoundaryBar` drop
  the live partial?

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
   to get daily closes + dividend events. The daily call retries 2×
   (2s/8s backoff via `withRetry`); intraday/weekly get one quick retry
   before their silent-`[]` fallback. A ticker whose daily fetch still
   fails is **carried forward** (previous series kept, intraday/weekly
   dropped) instead of aborting the run; the run aborts only if >25% of
   the roster fails. `validatePriceData()` then refuses to write a
   snapshot that loses history, changes any `startClose`, or drops a
   roster ticker — so a bad run leaves the last-good file untouched and
   `cron-update.sh` (which also JSON-parses the file before staging)
   commits nothing.
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
5. **Fetch prices**: `npm run fetch-prices` (incremental).
6. **Fast tier digest re-render**: `swift digest.swift --scope fast`. No RSS,
   no AI — just rewrites the `digest` field on each templated game window
   (1D / 1W / 1M) by substituting live pcts from the fresh `prices.json`
   into the stored `digestTemplate`. Sub-second. Failures here log but do
   not block the price commit.
7. **Stage `public/data/prices.json` AND `public/digests.json`** explicitly.
   Any other WIP survives.
8. **Commit + push** if anything changed. The push also carries any
   locally-committed digest commits left by an earlier `digest-update.sh`
   run (that script commits but never pushes — `cron-update.sh` is the
   single publisher, preventing push races).
9. **No `vercel deploy`.** Webhook handles redeploy. Comment in the
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

- The app *is* the scheduler. Two independent `threading.Timer` chains
  fire `cron-update.sh` (price refresh) and `digest-update.sh` (briefings)
  at their respective cadences.
- Uses `caffeinate -i -w <pid>` so the Mac doesn't sleep while open.
- **Price refresh**: interval options `5/10/15/30 min` and `1-24 hr`
  (default 15 min); start/end time window (default 8:30 AM – 3:00 PM CT).
- **Briefings**: one time-of-day setting (default 7 AM CT). The same hour
  drives both:
  - **Mon–Fri** → fires the `daily` digest scope (1D + 1W per-stock and
    per-portfolio briefings; all game windows, with `digestTemplate` on
    1D / 1W / 1M).
  - **Saturday** → fires the `weekly` digest scope (1M / 3M / 1Y / ALL
    per-stock and per-portfolio briefings; no RSS fetch; no game windows —
    those refresh daily + every 15 min via the fast tier).
  - **Sunday** → skipped.
  - The "Weekdays only" checkbox additionally suppresses the Saturday
    weekly fire when on.
- Buttons:
  - **Schedule Run / Run Now / Stop** — price-refresh controls (the
    15-min cron-update.sh chain).
  - **Run Daily Briefing / Run Weekly Briefing** — explicit-scope
    manual briefing triggers. Force the named scope regardless of which
    day it is. The scheduled morning timer still auto-picks (Mon-Fri
    daily, Sat weekly); these buttons override that for one-shot runs.
  - **Re-run Game Only** — fires `DIGEST_SCOPE=game`, regenerating
    the 6 game-wide leaderboard digests in ~30 s from the existing
    archive. No RSS, no per-stock or per-portfolio work. For previewing
    prompt-tuning changes mid-day.
  - **Run All Briefings (Daily + Weekly)** — chains daily → weekly
    back-to-back under the same digest lock. Combined steady-state
    runtime: ~40-45 min. First time it's fired after Phase 2 ships:
    ~3-4 hours while the chain-of-summaries cache lazy-backfills
    (~3 months × 45 tickers of daily + weekly + monthly summaries).
  - **Open Log** — opens `/tmp/stock-game.log` in the default viewer.
  - **Restart now (pull + re-exec)** — forces a `git pull` + py_compile
    + `os.execv` to pick up a freshly-pushed scheduler.py. See "GitHub
    sync" below.

  Every manual briefing button refuses if any briefing is already
  running, surfacing a warning dialog. All four route through
  `_fire_briefing_scope(scope)` (or `_run_all_with_guard` for "Run All")
  under a single `digest_lock` so concurrent clicks can't double-fire.
- Status labels: "Next refresh: ...", "Last run: ✓...", "Next briefing:
  ... (daily|weekly)", "Last briefing: ... (scope) ✓", and "Code: in sync
  / update pending / re-launching".
- **GitHub sync (auto-pull + auto-restart)**: The bash + Swift + TS pieces
  of the pipeline are re-read from disk on every fire. The Python
  scheduler is the one exception — it loads its source once at launch.
  To close that gap, the scheduler runs *two* things on a 60-s timer:
  1. A **background `git fetch` + `git pull --rebase --autostash`** on a
     daemon thread. This makes the scheduler an active puller — it
     doesn't wait for `cron-update.sh`'s next 15-min tick to bring code
     down. Push from the laptop or from Claude Code mobile at 9 pm and
     the new code lands on the Mac mini's disk within ~60 s, even
     overnight or on weekends when no cron is firing.
  2. A **mtime check** comparing the loaded version of
     `stockgame_schedule.py` against what's on disk. When the background
     pull (or the cron's pull) brings down a newer version, the watcher
     trips:
     a. Sets the "Code: update pending" banner.
     b. If "Auto-restart on GitHub update" is checked (default ON) AND
        no refresh / digest run is currently in progress, the scheduler
        persists its active schedule to `~/.stockgame-schedule.json`,
        `py_compile`-checks the new source, then `os.execv`s itself.
     c. The freshly-launched process reads
        `~/.stockgame-schedule.json` on startup, re-applies the
        schedule (price interval + window + briefing time), and deletes
        the state file. The user sees "Code: re-launched with latest
        version (state restored from …)".
- **Safety net**: a Python syntax error in a pushed commit is caught by
  the `py_compile` check pre-execv. The restart is aborted, the old
  process keeps running, and the sync label flips red so the laptop
  user knows to push a fix.
- **Manual "Restart now" button**: forces a `git pull` + py_compile +
  re-exec without waiting for the polling cycle. Useful when a code
  push lands seconds before you want it active. Refuses to restart
  if a price refresh or briefing is currently mid-flight.
- **State file lives at `~/.stockgame-schedule.json`** (outside the repo,
  no commit pollution). Gets deleted on consume — a fresh manual launch
  always starts from the default UI selections.

### §8.6. `scripts/digest.swift` + `scripts/digest-update.sh` (the briefing pipeline)

The digest pipeline is the second of the two writers to `main` and produces
`public/digests.json` plus, on the daily tier, `public/data/fundamentals.json`
(via `npm run fetch-fundamentals` — see §8.6.5). It has four scopes, each
owning a disjoint slice of `digests.json`. Whatever a scope doesn't touch is
preserved on the next merge.

> **⚠ INTERIM (2026-07-13): on-device is DISABLED — `DIGEST_ONDEVICE=off`.**
> macOS 27 **Beta 3** (installed 2026-07-07) broke on-device FoundationModels:
> ANY on-device generation (`LanguageModelSession` / `SystemLanguageModel`)
> dies with an uncatchable `_assertionFailure` SIGTRAP inside the framework —
> the daily briefing crashed every run from 7/08 until this interim mode
> landed. `digest-update.sh` now exports `DIGEST_ONDEVICE=off` by default and
> preflights `fm serve` before invoking swift (curl `/v1/models`; if down,
> launch `fm serve --port 8799` in Terminal via osascript and poll up to 60s).
> Under `off`, digest.swift never constructs or probes ANY in-process model:
> `AIEngine.resolve()` short-circuits to a PCC-serve-only state, `aiRespond`
> goes to PCC over `fm serve` and **throws on failure (no on-device
> fallback — callers catch and skip that prose)**, the structured on-device
> scorer path is skipped, and **the relevance scorer temporarily runs on PCC**
> via the text+`parseScoreJSON` path (higher PCC quota usage — note MLR
> moderation shares the same `fm serve`; a failed scoring call fails open,
> keeping the article unscored). `DIGEST_ONDEVICE=auto` (the in-code default)
> is byte-identical pre-Beta3 behavior. **Revert when an Apple beta fixes
> on-device generation:** remove the `DIGEST_ONDEVICE` export + fm-serve
> preflight block from `digest-update.sh` (or set `auto`) and this note.
> Everything in the paragraphs below describes the normal `auto` mode.
>
> **AI engine (macOS 27 — PCC for ALL prose).** [UPDATE 2026-06-18: **every
> prose summary now runs on PCC** via the Terminal-hosted `fm serve`, not just
> the game digest. The central helper `aiRespond(_:reasoning:preferPCCServe:)`
> POSTs to the local `fm serve` with `model=pcc` (`pccServeRespond`) and falls
> back to the in-process on-device model only if the server is down or PCC
> errors — so facts extraction, daily/weekly/monthly summaries, company briefs,
> and per-stock / portfolio / fund / game window digests all get the bigger PCC
> model. This is what fixed the vague, "generic"-padded on-device output. PCC
> isn't reachable in-process from the CLI (entitlement-gated → `ModelManagerError
> 1046`), so `fm serve` hosts it in a GUI/Login-Item context — see `APPLE_PCC.md`.
> The Stage-2 **relevance scorer (`scoreArticleAI`) deliberately stays on-device**
> (high-volume, temperature-0 per-article filter, not a summary; its rare
> text-fallback passes `preferPCCServe: false`). Override the whole prose
> pipeline back to on-device with `SUMMARY_ENGINE=on-device` (the older
> `GAME_SUMMARY_ENGINE` env is still honored for back-compat); point at a
> different endpoint with `FM_SERVE_URL`. Requires `fm serve` running (Login Item
> on the mini, else started manually in Terminal); if it's down the pipeline
> fails open to on-device. **Prompts were also de-rigidified** for the stronger
> model — the old "write exactly 3 sentences (1)…(2)…(3)", "load-bearing hard
> rules" walls, and the game prompt's "describe the move generically" fallback
> are gone; prompts now state the goal + the few load-bearing constraints
> (ticker symbols, player names, no numbers, real ownership) and trust the model.
> The game prompt now explicitly lets the model reconcile a price move that
> contradicts its headline ("fell despite good news") instead of forcing an
> incoherent sentence.] Every AI call still funnels
> through one helper instead of inlining `LanguageModelSession()`. At startup
> `AIEngine.resolve()` still probes the in-process PCC path and falls back to
> on-device (the resolved engine is the on-device *fallback* now that PCC comes
> via `fm serve`); override with `DIGEST_ENGINE=on-device|pcc|auto`. `aiEngine`
> in `digests.json` stays `"AppleIntelligence"` (PCC *is* Apple Intelligence; the
> frontend keys attribution off that exact string), and the engine actually used
> is logged to `/tmp/stock-game.log`. Full detail in STATE.md → "AI engine
> selection (PCC vs on-device)". If you tune prompts, note Apple also *replaces*
> the on-device model on each OS upgrade, so prompt behavior can shift even with
> no code change.
>
> **Generation options + structured output.** `aiRespond` sets temperature per
> tier (`temperatureFor`): **0.0** for `.standard` (deterministic
> classification/extraction) and **0.4** for `.deep` (prose) — passed to PCC over
> `fm serve` and applied identically on the on-device fallback. The relevance
> scorer (`scoreArticleAI`) uses `aiRespondStructured` + a `DynamicGenerationSchema`
> (`RELEVANCE_SCHEMA`) for typed `{score, reason}` output instead of parsing
> JSON, with the old `parseScoreJSON` path kept as a fallback. Structured output
> stays in-process/on-device (no JSON-schema response_format over `fm serve`).
> Use the runtime `DynamicGenerationSchema` API, **not** the `@Generable` macro —
> the macro's compiler plugin needs Xcode, which the Mac mini doesn't have, so it
> won't build under interpreted `swift digest.swift`.
>
> **Concurrency (macOS 27).** The ticker / portfolio / fund / game phases fan
> out via `mapConcurrent`, and each prose call self-gates by engine: PCC calls
> go through `actor PCCGate` and on-device calls through `actor AIGate`. PCC runs
> in the cloud, not on the mini's 8 GB of RAM, so its cap is wider —
> `DIGEST_PCC_CONCURRENCY` (default 8) vs `DIGEST_AI_CONCURRENCY` (default 4, the
> memory-bound on-device limit; `1` = serial). A failed PCC call releases its
> slot before the on-device fallback takes an AIGate slot, so the two gates are
> never held at once and can't deadlock. Phases still run in order and output
> order is preserved. Detail in STATE.md → "In-process AI concurrency".

**`--scope fast`** — runs from `cron-update.sh` step 6, after every 15-min
price refresh. No RSS, no Apple Intelligence calls. Reads the existing
`digests.json`, opens each game window in `TEMPLATED_GAME_WINDOWS` (1D / 1W
/ 1M), substitutes live pcts into the stored `digestTemplate`, writes the
result back to `digest`. Sub-second. Failures here log a warning but never
block the price commit (`cron-update.sh` swallows non-zero exit and
continues).

**`--scope daily`** — runs from `digest-update.sh` Mon–Fri. Full RSS fetch
+ Stage-1 keyword filter + Stage-2 Apple Intelligence relevance scoring,
then digest generation for:
- Holdings: 1D + 1W only.
- Portfolios: 1D + 1W only.
- Game: ALL six windows. 1D / 1W / 1M additionally extract a
  `digestTemplate` from the freshly-generated prose (see Templates below).
Existing holdings/portfolios 1M / 3M / 1Y / ALL stay frozen on disk until
the Saturday weekly run. After regeneration the script does a one-shot
template render (the same logic the fast tier runs) so the just-written
1D/1W/1M game prose reflects the current standings, not the standings at
prompt time.

**`--scope weekly`** — runs from `digest-update.sh` on Saturday. No RSS
fetch. Regenerates the slow windows:
- Holdings: 1M / 3M / 1Y / ALL.
- Portfolios: 1M / 3M / 1Y / ALL.
- Game: not touched (the daily + fast tiers already maintain it).
Lighter than daily because it skips the fetch phase entirely.

**`--scope game`** — manual trigger. Fired by the "Re-run Game Briefings
Only" button in the scheduler UI (or directly via
`DIGEST_SCOPE=game bash scripts/digest-update.sh` on the Mac mini). No
RSS, no per-stock or per-portfolio briefings. Regenerates all 6 game
windows from the existing article archive with the current prompt — ~30 s.
Used for previewing prompt-tuning changes mid-day without sitting through
the full daily run; 1D/1W/1M emit fresh `digestTemplate`s so the next
fast tier picks up the new prose.

**`--scope backfill`** — manual, one-time. Regenerates the hierarchical
summary cache under `~/StockDigests` (daily → weekly → monthly → company
brief) on PCC, replacing summaries left from the on-device era. Run
directly: `swift scripts/digest.swift --scope backfill` (it writes only the
cache, never `digests.json`). Deliberately conservative so it stays within
PCC limits and doesn't starve the MLR moderation that shares the same
`fm serve`: it runs the chain **sequentially** (PCC concurrency ~1), uses
**strict PCC** (a failed PCC call skips the write instead of poisoning the
cache with an on-device fallback), **hard-stops** after `BACKFILL_ABORT_AFTER`
(default 5) PCC failures (the quota-exhausted signal), and is **resumable**
via per-ticker markers under `~/StockDigests/.backfill-done` (re-run to
continue; `BACKFILL_RESET=1` clears them). Scope to specific names with
`BACKFILL_TICKERS=AAPL,MSFT`. Facts (Layer 0.5) and raw articles are left
as-is. After it runs, the next daily/weekly briefing's window digests
synthesize from the now-PCC-quality chain.

`digest-update.sh` reads two env vars from the scheduler:

- `DIGEST_SCOPE` (default `daily`) — forwarded as `--scope`. Accepts
  `daily | weekly | game`. `fast` is rejected with a no-op exit so nobody
  accidentally fires the fast tier from there (`cron-update.sh` owns that
  path).
- `DIGEST_MODE` (default `full`) — when `digests-only`, forwards
  `--digests-only` to `digest.swift` so RSS is skipped. The weekly + game
  scopes always force this on regardless of `DIGEST_MODE`.

#### Templates (game 1D / 1W / 1M)

The daily run prompts Apple Intelligence to write every percentage as
`TOKEN [SIGN+DECIMAL%]` — e.g. `ASTS [-10.23%]`, `TSLA [+5.62%]`,
`Brian [+8.45%]`. TOKEN is either a ticker symbol (uppercase, from
`DEFAULT_TICKERS`) or a player first name (from `PLAYERS`). The prompt is
strict about this format; if the model wavers, `extractGameDigestTemplate`
emits a `no template tokens extracted` warning and the fast tier just
leaves that window's prose alone until the next daily run.

After the model returns, two things happen:

1. The rendered prose is stored in `WindowDigest.digest` (display string).
2. A regex pass replaces each `TOKEN [SIGN+DECIMAL%]` occurrence with a
   placeholder — `{{TICKER}}` if TOKEN matches a known ticker,
   `{{user:USERID}}` if TOKEN matches a player. The templated string is
   stored in `WindowDigest.digestTemplate`.

The fast tier (every 15 min) reads each game template, computes the live
pct for each placeholder via `liveTickerPct` / `liveUserPct` (which call
`rangeCloses` / `computeUserMovers` on the freshly-pulled `prices.json`),
formats as `[±X.XX%]`, and writes back to `digest`.

Result: the game-wide "What's driving it" prose on `/` updates every 15
min with current standings while the *narrative* (catalysts, news events,
ranking story) only regenerates once per morning. ~3-sentence prose stays
semantically frozen all day; the bracketed numbers flip.

#### Game prompt — facts-first layered architecture

Earlier versions of the game-summary prompt handed Apple Intelligence
the raw standings + an article list and asked it to pick the top mover,
drag, and forward catalyst itself, then write prose. That gave the model
too many degrees of freedom and produced hallucinations like *"the
biggest drag of the day saw a 40% increase in April"* and *"TSLA has
seen a 30% increase since April, a big concern for Rick, who lost 6.24%
of his portfolio."* Neither April figure was in any input — the model
confabulated.

Current architecture (Phase 4): Swift computes three structured anchors
deterministically in `computeGameDigestFacts(data, window, standings,
articles)`. Each anchor is a `GameAnchor` carrying `ticker`, `tickerPct`,
every `owners[].name + portfolioPct`, and one article (highest
`relevanceScore` for that ticker in the window):

- **`topMover`** — ticker with the largest positive window pct
  (from `tickerPctMap = { ticker → pct }` across `ALL_TICKERS`).
- **`topDrag`** — ticker with the largest negative window pct.
- **`forwardCatalyst`** — highest-relevance article whose title or
  description mentions a `FUTURE_EVENT_KEYWORDS` term (`upcoming`,
  `scheduled`, `outlook`, `FDA decision`, `earnings call`, `to launch`,
  …), filtered to an owned ticker not already used in sentences 1-2.
  Falls back to the highest-relevance unused article if no
  future-event match exists.

`renderFactBlock` renders each anchor as a compact fact (ticker, its
holders, and the single best article as the "Catalyst"). The prompt
(rewritten 2026-06-18 for the PCC model) gives the model these facts and
asks for three flowing sentences — top gainer, biggest drag, what's
worth watching — with only a few load-bearing constraints: use ticker
symbols + player first names exactly, only ever credit a stock to its
real holders, and write no numbers (the fast tier injects live pcts).
Two deliberate behaviors fix the old failure modes: (1) when an anchor
has **no article in the (widened) news window**, the block says the move
has *"no notable news in the last several days; attribute it to ongoing
momentum or positioning rather than inventing a specific event"* — this
replaced the old "describe the move generically" fallback that literally
produced "a generic market move";
(2) when a price move **contradicts its headline** (e.g. ASTS down on a
day its best article is a positive launch story), the model is told to
say so plainly ("fell despite…") instead of being forced to paraphrase
the headline as the cause of a drag — the old rigid "FACT 2 = drag,
paraphrase the headline" slot produced incoherent "popped… that dragged"
sentences. A slot with no data is marked "skip this sentence" and the
model omits it. `tickerPct`/`portfolioPct` are still on `GameAnchor` but
no longer shown to the model (it can't write numbers anyway).

**News lookback is WIDER than the price window for short windows (added
2026-06-19).** `WindowKey.newsLookback(gameAge:)` returns 5 days for 1D
and 10 for 1W (long windows fall through to `effectiveLookback`). The
three article loaders — `articlesForWindow`, `gameNewsArticles`,
`portfolioArticlesForWindow` — all use it. Rationale: a catalyst from a
few days ago often still explains where the price sits (a Thursday report
a stock is still riding on Friday; Friday news read on Monday). Searching
only the 1-day price window made every still-elevated-but-quiet-today
stock report "no notable news," which read as misleading. To stop an
older catalyst being passed off as fresh, each fact/headline is tagged
with `articleRecencyPhrase` ("reported today" / "reported yesterday" /
"reported N days ago"), and both the game prompt and the per-stock 1D
prompt instruct the model to frame an older catalyst as "still
riding/reacting to" rather than as today's news. The 1D per-stock framing
changed from "what happened today" to "what's driving it right now
(possibly a catalyst from the past few days)". `ARTICLES_PER_WINDOW_CAP`
still bounds prompt size.

#### Ownership QA backstop

`detectOwnershipViolations(prose)` runs on every generated digest
(portfolio + game) right after `cleanDigestProse`. It splits the prose
into sentences, finds every (player_name, ticker) co-occurrence, and
checks `TICKER_OWNERS[ticker]`. If a player is named in a sentence with
a ticker they don't own AND no legitimate owner of that ticker is named
in the same sentence (the second clause handles legitimate multi-player
sentences like "TSLA helped Kevin and Rick"), the pair is flagged and
logged via `logOwnershipViolations` → stderr → `/tmp/stock-game.log`
with the sentence text. The digest still ships (we don't burn an
already-generated AI call), but the log gives the user a paper trail
to spot recurring failure modes and refine the prompt.

#### Per-window article caps (Phase 1)

`ARTICLES_PER_WINDOW_CAP = [.d1: 15, .w1: 15, .m1: 20, .m3: 25, .y1: 24,
.all: 25]` (with `DESC_TRUNCATE = 300`) bounds every raw-article prompt
under ~2.5 K tokens. Articles are sorted by `relevanceScore` desc and
capped via `prefix(N)`. Before this cap, `.d1` and `.w1` returned ALL
qualifying articles; newsy weeks for popular tickers (AMZN, AAPL with
100+ Yahoo articles per week) hit Apple Intelligence's context window
and the AI call errored with `Exceeded model context window size`.
This cap is the safety net for the legacy raw-article path. The Phase 2
chain-of-summaries path below avoids the issue entirely by feeding
small, pre-summarized inputs instead.

#### Hierarchical chain-of-summaries (Phase 2)

For windows ≥ 1W, the digest pipeline doesn't feed raw articles to the
AI at all. Instead it summarizes in cached, write-once layers and
chains them upward. Layout outside the repo at `~/StockDigests/`:

```
articles/{T}/{YYYY-MM-DD}.json          Layer 0  raw Yahoo articles (existing)
summaries/{T}/daily/{YYYY-MM-DD}.json   Layer 1  daily summary (NEW)
summaries/{T}/weekly/{YYYY-MM-DD}.json  Layer 2  weekly summary (NEW; key = Mon-of-week)
summaries/{T}/monthly/{YYYY-MM}.json    Layer 3  monthly summary (NEW)
```

Each summary file is a tiny JSON: `{ ticker, key, summary, generatedAt,
sourceCount, aiEngine }`. Completed periods don't change (yesterday's
news is fixed), so the cache is permanent — once written, every later
run reads from disk.

**Window → input mapping:**

| Window | AI input |
|---|---|
| 1D | raw articles (capped) — small + needs detail |
| 1W | 7 daily summaries |
| 1M | 4 weekly summaries + current partial-week daily summaries |
| 3M | 13 weekly summaries |
| 1Y | 12 monthly summaries |
| ALL | every monthly summary since 2026-02-05 (~3-60 months) |

**Cached-or-generate helpers:**
- `getOrGenerateDailySummary(ticker, date)` — checks `dailySummaryFile`;
  on miss, loads raw articles for that day and calls
  `generateAndCacheDailySummary` (one AI call, ~2 s).
- `getOrGenerateWeeklySummary(ticker, mondayKey)` — checks weekly cache;
  on miss, calls `getOrGenerateDailySummary` for each of the 7 days
  Mon-Sun (recursive chain), then `generateAndCacheWeeklySummary`.
- `getOrGenerateMonthlySummary(ticker, yearMonth)` — checks monthly
  cache; on miss, walks every Monday-of-week that falls in the month,
  calls `getOrGenerateWeeklySummary` for each, then
  `generateAndCacheMonthlySummary`.

The chain is recursive: a 1Y digest request that finds no monthly
cache for a ticker triggers `getOrGenerateMonthlySummary` for each of
12 months, each of which in turn triggers 4-5 weeklies, each of which
triggers 7 dailies. On the very first 1Y digest ever requested for a
ticker, that's a few hundred AI calls to populate the cache. All
subsequent 1Y digests read everything from disk and only make 1 AI
call (the 1Y digest itself).

**Date helpers** (`mondayOfWeekFor`, `mondayKey`, `yearMonthKey`)
anchor every summary key to America/New_York to match the rest of the
pipeline's market-day semantics. Weekly cache files are keyed by the
Monday's date in ISO format (e.g. `2026-05-11.json` = week of May 11-17).

**Steady-state cadence:**
- Daily tier: always generates today's daily summary right after the
  archive write (`processTicker` step 5b, only in `args.scope == .daily`).
  Then 1D from raw articles + 1W from cached daily summaries. ~25-30 min
  total for 45 tickers.
- Weekly tier: lazy chain populates last week's weekly + (on first Sat
  of month) prior month's monthly + 1M/3M/1Y/ALL window digests.
  ~10-15 min steady-state.

**First-run backfill cost** (one-time): ~2-3 hours the first Saturday
weekly tier fires after Phase 2 ships, while the chain populates
~90 daily + ~13 weekly + ~12 monthly summaries per ticker. After that
the cache is built and every subsequent weekly run is fast. Backfill
can be front-loaded by manually firing `DIGEST_SCOPE=weekly bash
scripts/digest-update.sh` (or the "Run Weekly Briefing" UI button) at
any convenient time before the next Saturday.

**Quality benefit for long windows:** 1Y / ALL now synthesize across
12 structured monthly summaries (each built from 4 weekly summaries
each built from 7 daily summaries each built from that day's articles)
instead of "top 24-30 raw articles from the period." Every storyline
of every week survives through the chain instead of being dropped at
the article-count cap.

**Fallback path:** if `buildSummaryBackedWindowPrompt` returns nil (no
cached summaries available AND no chain backfill possible — e.g.
brand-new ticker, missing archive directory), `generateDigestText`
falls back to the legacy raw-article path using
`buildDigestPrompt(ticker, window, articles, gameAge)` with the Phase 1
caps. So windows always generate something even before the cache is
populated.

**Visibility:** every cache write logs to `/tmp/stock-game.log` via
`log` (not `vlog`) so the user can watch the chain populate during a
backfill — look for lines like `AMZN daily summary cached for
2026-04-15 (8 articles)`.

#### Merge writer

`writeOutputJSON` reads the existing `digests.json` via
`loadExistingDigests`, treats it as the base, and overlays the windows
this run regenerated. Tickers / players not in the current roster are
dropped at this step (this is what removed SPY when Lee swapped picks).
First-ever run (no existing file): the base is empty; only the windows
this run produced get written.

### §8.6.5. `scripts/fetch-fundamentals.ts` (per-ticker About / Financials / Earnings data)

Pulls Yahoo's `quoteSummary` modules (`assetProfile`, `summaryDetail`,
`defaultKeyStatistics`, `incomeStatementHistory{,Quarterly}`,
`earningsHistory`, `price`) for every ticker in `ALL_TICKERS` and writes
`public/data/fundamentals.json`. Powers the three new sections on
`/stock/[ticker]`:

- **About card** — company description (with Show more / Show less past
  400 chars) + a 2-col key-stats grid (Market cap, P/E, Forward P/E, EPS,
  52-week range, Beta, Dividend yield, Sector / Industry, Headquarters,
  Employees, Exchange, Website). Rows whose Yahoo value is null don't
  appear, so partial-coverage tickers don't show empty rows.
- **Financials chart** — Quarterly / Annual toggle. Revenue (green) /
  Gross profit (dark orange) / Net income (light orange) as grouped bars;
  Net margin as a thin overlay line on its OWN scaled y-range (visual
  trend indicator, not read off the dollar axis — same approach as
  Robinhood, since margin % and dollar magnitudes are incomparable). A
  solid theme-aware zero reference line draws across the chart whenever
  the y-domain spans both signs, so positive vs. negative bars read at a
  glance. Below the chart, a "Show numbers" button expands a per-period
  card stack (most-recent on top) with the exact figures (Revenue /
  Gross profit / Net income / Net margin) — net-margin can be 4-digit-%
  for unprofitable companies and isn't readable off the chart axis.
- **Earnings chart** — Quarterly only (no toggle; annual rollup was
  ambiguous for partial-year companies and the cadence is quarterly
  anyway). Per-period scatter: a lighter-green / slightly larger
  Estimate dot drawn first, brand-green Actual dot drawn on top — when
  they overlap concentrically the ring frames the actual; when they
  stack vertically the gap reads as the surprise. No connector line
  (earlier draft had one — added noise without information beyond what
  the dot positions already show). The y-domain always clamps to
  include 0 so all-negative-EPS companies (most of the growth-stage
  roster) get a visible breakeven reference line at the top. Same
  "Show numbers" expandable table as Financials, showing Estimate /
  Actual / Surprise per quarter.

Both charts' grid lines use `var(--chart-baseline)` and zero lines use
`var(--chart-axis-label)` (already defined per-theme in `globals.css`)
so they're visible in dark / light / twilight modes. The zero line is
drawn WITHOUT a y-axis label (no "0" / "$0" text) — a fixed-position
zero label would collide with whichever evenly-spaced y-tick happens
to land closest to zero, producing overlapping illegible numbers. The
line position itself is the signal. The inner per-period cards in
"Show numbers" use `bg-zinc-800/40` for the same theme-awareness
reason — the bare-class overrides in `globals.css` flip the background
between dark, white, and indigo correctly per theme; using a class
without an override (e.g. `bg-zinc-950/60`) leaves a dark band in light
mode that swallows the dark-overridden text colors inside.

Every field is optional. Yahoo's coverage is uneven — micro caps + recent
IPOs frequently lack some modules, and Yahoo's `incomeStatementHistory*`
endpoints have been returning truncated data since late 2024 (4 quarters /
4 years is typical). The UI hides missing rows / sections rather than
blocking the page; the fetch script catches per-ticker errors so one
ticker's failure (e.g. HUT hits a Yahoo schema-validation bug) doesn't
abort the rest.

**Cadence**: `digest-update.sh` runs `npm run fetch-fundamentals` once a
day on the daily tier only (skipped on the Saturday weekly tier — these
values don't move on weekends). Takes ~30 s for 45 tickers. Failures here
don't block the digest pipeline.

**Client/server split**: `lib/fundamentals-data.ts` (server-only loader,
imports `node:fs/promises`) is separate from `lib/fundamentals.ts`
(formatters only). The split keeps `node:fs` out of the client bundle —
a "use client" component can `import { fmtMarketCap } from "@/lib/fundamentals"`
without dragging Node modules into the browser.

### §8.7. The webhook + deploy (+ why data pushes don't deploy)

- GitHub→Vercel integration (one-time UI install at
  `https://github.com/apps/vercel/installations/select_target`) listens
  for pushes to `main`.
- **Ignored Build Step:** before building, Vercel runs `vercel.json`'s
  `ignoreCommand` → `scripts/vercel-ignore-build.sh`. Exit 0 = skip,
  exit 1 = build (Vercel's contract, inverted from shell intuition). The
  script diffs `VERCEL_GIT_PREVIOUS_SHA..HEAD` (the last deployed SHA,
  explicitly `git fetch`ed since it falls outside the shallow clone)
  excluding `public/data`, `public/digests.json`, `config/funds.json`,
  `config/thesis.json` — data-only pushes skip the build (shown as
  "Canceled" in the dashboard, no failure emails). Every uncertain path
  fails open to building. `config/roster.json` is deliberately NOT
  excluded (statically imported by `lib/picks.ts` — roster changes must
  rebuild).
- **How data reaches users without a deploy:** `lib/remote-json.ts`
  (shared by `lib/data.ts`, `lib/fundamentals-data.ts`,
  `lib/digests-data.ts` → `/api/digests`) reads the file from origin/main
  via the GitHub Contents API (raw media type — digests.json exceeds the
  1 MB base64 limit) with a 60s in-process TTL, stale-on-error, and a
  filesystem-snapshot fallback for dev / `next build` / GitHub outages.
  All pages are `force-dynamic` (including `/stock/[ticker]` — it was the
  last `force-static` price consumer). Uses the same `GITHUB_*` env vars
  as the funds CRUD.
- On a code push, Vercel pulls the repo, runs `npm install
  --legacy-peer-deps` (per `.npmrc`), runs `next build`, deploys to its
  CDN.
- The Vercel project is aliased to `stock-game-gamma.vercel.app`.
- Cache-Control headers (`next.config.ts`) set every user-facing document
  route + the data JSON snapshots to `no-cache, no-store, max-age=0,
  must-revalidate` so the iPhone PWA fetches fresh HTML on every open and
  picks up the newest deploy. **Why `no-store`, not just `must-revalidate`:**
  iOS home-screen webclips aggressively serve a cached HTML snapshot on cold
  launch — frequently *without* revalidating, even under `max-age=0,
  must-revalidate`. That stored snapshot references the OLD content-hashed
  CSS bundle, so a shipped style fix can fail to reach the phone for days
  (this is what made two consecutive light-mode fixes "not show up").
  `no-store` removes the snapshot entirely. The `/_next/static/*` JS/CSS
  bundles keep their own `immutable` caching (Next sets that, and the header
  config deliberately enumerates only document/data routes so it's left
  untouched) — so only the tiny HTML + JSON re-fetch, never the bundles.
  **Caveat on the first upgrade:** a device already holding a stale snapshot
  from the OLD header has to fetch the new HTML once (manual refresh / delete
  + re-add) to learn about `no-store`; every deploy after that lands
  automatically.
- End-to-end latency: ~3s fetch + 14s build + ~30s propagate ≈ **50s**.

---

## §9. Debugging playbook

Symptom → checks → fixes. Walk top to bottom; the early checks are
cheaper.

### §9.1. "I don't see the latest data on my phone."

| Check | How | If yes, then |
|---|---|---|
| Footer shows recent timestamp? | Look at bottom of any page | Cron is running; the issue is on your phone (next row) |
| Footer shows old timestamp? | Same | Cron isn't pushing — see §9.2. If origin/main HAS fresh data commits but the site is stale, the runtime loader is falling back: check that `GITHUB_TOKEN`/`GITHUB_OWNER`/`GITHUB_REPO` are still set on Vercel and the PAT hasn't expired (lib/remote-json.ts silently falls back to the deploy snapshot) |
| Vercel deployed since push? | `vercel ls --yes` — but remember data pushes deliberately DON'T deploy ("Canceled" in dashboard = ignoreCommand skip, which is correct) | Only code pushes need a deploy; if a code push shows Canceled, check scripts/vercel-ignore-build.sh |
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
   - The synthetic "Combined Players" fund (lib/combined.ts) and the
     Compare-page Combined breakdown / About-the-combined-portfolio card
     (buildCombinedComposition in lib/portfolio-composition.ts) both derive
     from USER_LIST at request time, so they reshape automatically — no edit
     needed. A hand-written investing style label for the new player in
     PER_USER_ANALYSIS (lib/portfolio-composition.ts) will also flow into the
     About-the-combined-portfolio blurb; players without one are just skipped
     there.

2. scripts/digest.swift: NO EDIT NEEDED. The script reads
   config/roster.json at startup and derives DEFAULT_TICKERS,
   TICKER_NAMES, and PLAYERS from it (the same file lib/picks.ts
   imports), so the step-1 roster edit covers the digest pipeline too.
   The old hardcoded lists survive only as EMBEDDED_* fallbacks used
   when roster.json is missing/unparseable (the run then logs
   "WARNING: config/roster.json unreadable — using hardcoded roster
   fallback (drift risk!)"); refresh them opportunistically, but
   there are no more three-lists-in-lockstep edits.

3. scripts/fetch-prices.ts:
   - No code change. Run: npm run fetch-prices -- --full
   - This fetches the new tickers' history and rewrites prices.json.

4. components: NO CHANGES NEEDED. CompareView's leaderboard renders as a
   sports-standings <UserRow> stack — auto-scales to N players. (Older
   versions used a 2x2 grid that needed refactoring past 4 players; that
   was replaced by the stacked-row layout, so the doc reflects the
   current code, not the historical constraint.)

5. STATE.md: update the Players table.
   OVERVIEW.md: update the players table.

6. Test: npm run build. Verify every player's /portfolio route is SSG'd.

7. Commit, push, verify on staging. The next morning's digest-update.sh
   run will populate the new player's portfolio digests + add any new
   tickers to the holdings block.
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

2. scripts/digest.swift: NO EDIT NEEDED. It reads config/roster.json
   at startup (see §10.1 step 2), so the step-1 edit flows into the
   digest pipeline on its next run. The hardcoded lists are only a
   fallback for a missing/unparseable roster.json — the old "digests
   silently generated for the OLD roster" drift mode is gone unless
   the fallback WARNING appears in the log.

3. npm run fetch-prices -- --full to grab the new ticker's history.

4. npm run fetch-fundamentals to populate the About / Financials /
   Earnings sections for the new ticker. (The next morning's digest
   cron will also do this automatically; running manually here just
   means the stock detail page works on the very next deploy without
   waiting for the morning fire.)

5. STATE.md / OVERVIEW.md: update the picks table.
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

### §10.4. Add a spin-off (and an accompanying split)

The **HON → HONA** spin-off (effective 2026-06-29, ratio 0.5) bundled with a
**HON 1-for-2 reverse split** is the live, worked example — see `lib/events.ts`
(`SPINOFFS` + `REVERSE_SPLITS`). The wiring below is already built, so a future
spin-off is mostly a config edit:

```
1. lib/events.ts:
   a. push to SPINOFFS:
      {
        parentTicker: "HON",
        childTicker: "NEWCO",
        childName: "...",
        effectiveDate: "YYYY-MM-DD",   // child's first regular-way trading day
        sharesPerParentShare: 0.5,     // distribution ratio (child per parent)
      }
   b. If the parent ALSO splits (common — companies often reverse-split the
      stub after a large carve-out), push to REVERSE_SPLITS:
      { ticker: "PARENT", effectiveDate: "YYYY-MM-DD", factor: 2 }
      `factor` = the number to divide Yahoo's split-adjusted close by to
      restore inception-day share units. 1-for-2 reverse split → 2;
      2-for-1 forward split → 0.5. WITHOUT this, Yahoo's retroactive price
      re-scaling makes the parent show a fake ~±100% jump (the frozen
      startClose + fixed share count get out of units with the closes).

2. config/roster.json: add NEWCO to `ticker_names`. Do NOT add it to any
   user's `tickers` — that would change perHoldingDollars ($100k / N) and
   dilute the user's other picks. Ownership is derived from the parent
   (lib/picks.ts TICKER_OWNERS + SPINOFF_CHILD_TICKERS), and it's exported
   as a first-class holding/stock automatically.

3. The child needs no fetch-script change — it's pulled via
   getSpinoffTickers(). It can't trade before its effectiveDate, so the
   fetcher SKIPS a spin-off child whose fetch returns no data (instead of
   aborting). On/after the effective date a normal incremental fetch picks
   it up; running `npm run fetch-prices -- --full` from the laptop after the
   event gives the cleanest result (re-normalizes the parent's whole series).

4. No view changes. portfolioSeries adds the child position from
   effectiveDate forward (purely additive — no backtracked history, like
   receiving the distribution in a real brokerage account, so the parent's
   holders are made whole rather than punished). buildHoldingRows appends a
   derived child row (shares = parentShares × ratio), and the child gets its
   own /stock page + /stocks list entry + owner PositionCards.

5. STATE.md / OVERVIEW.md: note the event.
```

**HON-specific operational note (June 2026):** the spin-off + reverse split
both land 2026-06-29. Everything above is date-gated, so it's inert until then
and activates automatically on the first fetch on/after that date (Yahoo only
re-scales HON once the split processes). HONA has no price data until it lists,
so it shows as a 404/absent everywhere until 2026-06-29 — that's expected.

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
1b. `npm run check-theme` — if you added or edited any component markup,
   confirm every dark-surface utility flips in light + twilight (see
   §5.6). This is the guard against the recurring "looks fine in dark,
   broken in light mode" bug. It also runs in CI + the pre-push hook, but
   running it locally is the fast feedback loop.
2. `npm run dev`, open `localhost:3000` in browser at mobile width:
   - Click each tab (1D / 1W / 1M / 3M / 1YR / ALL). All render without
     console errors.
   - **Check light mode too**, not just the dark default. The fastest way:
     in DevTools, run `document.documentElement.dataset.theme = "light"`
     (and `"twilight"`) in the console and eyeball every new surface for
     contrast. `check-theme` catches *missing* overrides; only your eyes
     catch an override that's the *wrong shade*.
   - Tap a leaderboard card → land on player's portfolio. Back button
     visible. Hash deep-link from the InsightsCard works.
   - **Motion (§6.5):** tab ↔ tab cross-fades; drilling into a
     stock/portfolio/fund slides in from the right (push) and Back
     slides in from the left (pop). No transform lingers at rest —
     confirm the inline fixed modal (ManageFundsSheet) is still anchored
     after a transition. Open a `<Sheet>` (FilterSheet / WhatsNew /
     CreateFundModal / EditThesisModal): it slides up, dismisses on
     backdrop tap / Done / Escape by sliding back down. Tappable controls shrink slightly on press.
   - **Reduced motion:** in DevTools emulate `prefers-reduced-motion:
     reduce` (Rendering panel) and re-check — transitions/animations
     should be ~instant, nothing broken or stuck off-screen.
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

The actual day-to-day workflow on the laptop is intentionally minimal:

```
git commit -am "..."
git push                      # pre-push hook handles everything
```

The pre-push hook does both jobs automatically:
1. **Auto-rebases** onto `origin/main` if the laptop's local main has
   fallen behind (which it always has, because the Mac mini pushes data
   commits every 5 min). No manual `git pull` needed.
2. **Runs `npm run build`** to catch type errors / SSG failures.

`git config pull.rebase true` and `pull.ff only` are also set in the
local repo config, so manual `git pull` invocations rebase too.

Branch protection is **not yet enabled** on `main` (per
`docs/branch-protection.md` — solo-dev mode). When you turn it on, the
laptop's workflow shifts to feature-branch + PR + CI + merge. Until then,
direct push to `main` from the laptop is fine. The Mac mini's data
commits ARE allowed to push to main directly via the bypass list when
protection is enabled.

- Don't force-push to `main`. Don't merge unreviewed code into `main`
  from shared environments.
- Bypass the hook only for emergencies: `git push --no-verify`.

### §13.1. Failure modes when iterating from the laptop

The Mac mini fires `cron-update.sh` every 5–15 min while the schedule
is running. Whatever's on `origin/main` gets pulled, run, and pushed
back. Two distinct failure modes if a change you push has a bug:

| Bug location | What happens on next Mac mini fire | Live site impact | Recovery |
|---|---|---|---|
| App code (`app/`, `components/`, `lib/`, styles) | Cron still runs to completion (fetch + commit + push succeed). Vercel build may fail. | If build fails, Vercel keeps serving the **last-good deploy** with stale data. If build succeeds with a runtime bug, users see the bug. | Push a fix → next fire's webhook redeploys. |
| Cron internals (`scripts/fetch-prices.ts`, `scripts/cron-update.sh`) | Cron itself fails at the broken step. `set -e` aborts. **No commit, no push, no deploy.** | Last-good deploy keeps serving until you push a fix. Each subsequent fire keeps failing on the same code. | Push a fix → next fire runs cleanly. Check `/tmp/stock-game.log` on the Mac mini for the failure mode. |

The pre-push hook (`.githooks/pre-push`) runs `npm run build` for any
non-data push from the laptop. CI on PR runs the same. Both catch
TypeScript / SSG errors. **Neither catches runtime bugs** — Yahoo
Finance API hiccups, fetch-script logic errors, broken imports that
only fire at request time. Those need a fix-forward push.

For day-to-day: edit app code freely, push via PR, the next fire takes
over cleanly. Edit the cron internals more carefully (run
`bash scripts/cron-update.sh` locally first) since their bugs persist
until fixed.

### §13.2. First-time machine setup (Mac mini OR laptop)

The setup is the same on both machines. **The single most important
rule: do NOT clone the repo into iCloud Desktop or any iCloud-synced
folder.** Clone to `~/Repos/stock-game` instead.

**Why iCloud is forbidden** (lesson learned the hard way, 2026-05-06):
iCloud silently writes `<filename> 2` duplicates inside `.git/`,
`.next/`, `node_modules/`, and the working tree whenever it thinks two
devices are racing on a write. A duplicated
`.git/refs/remotes/origin/main 2` poisons `git fetch` with
`fatal: bad object refs/remotes/origin/main 2`, which makes every cron
fire silently abort at the rebase step (no commit, no push, last-good
data sticks until you notice). `.next/` corruption breaks every local
`next build`. `package.json 2` will trip `npm install`. Whack-a-mole
cleanup is futile; iCloud regenerates duplicates on the next sync
event. The only durable fix is to keep the repo off iCloud.

The two machines stay in sync via **GitHub** (`origin/main`), not iCloud.
Both push/pull from the same remote. iCloud Desktop's `~/Desktop/Stock
Game App/` folder keeps absolute symlinks to the canonical docs
(CLAUDE.md, STATE.md, OVERVIEW.md, DESIGN.md) so the user can still
discover the project from their iCloud Desktop view, but the repo
itself lives outside iCloud.

**Setup commands (one-time per machine):**

```bash
mkdir -p ~/Repos
git clone https://github.com/btheis15/stock-game.git ~/Repos/stock-game
cd ~/Repos/stock-game

# Local hooks: auto-rebase before push + build-check (skipped on data-only)
git config core.hooksPath .githooks

# Identity matches the existing commit history (Mac mini's auto-commits
# are authored as the same person)
git config user.name "Brian Theis"
git config user.email "brian.theis15@gmail.com"

# Dependencies — the flag is required; .npmrc also pins it
npm install --legacy-peer-deps

# Verify it builds and the working tree is sane
npm run build
git status   # → "On branch main, your branch is up to date, working tree clean"
```

**Mac mini extras** (for running the recurring schedule):

- Python 3 + tkinter — system Python on macOS includes both
- Node 22+ via Homebrew (`brew install node`) is fine; the project
  works on 22, 24, and 25
- Vercel CLI is **not** required — the GitHub→Vercel webhook handles
  deploys. The `.vercel/project.json` link in the repo is only useful
  if you want to run `vercel deploy` manually.
- `caffeinate` is built into macOS; the scheduler invokes it.

**Laptop extras** (for development):

- `gh` (GitHub CLI) for PRs: `brew install gh && gh auth login`
- IPv6 disable if `npm install` or Yahoo Finance times out
  (some local networks advertise IPv6 without working routing):
  ```
  sudo networksetup -setv6off "Wi-Fi"
  sudo networksetup -setv6off "Ethernet"
  ```

**Launch commands:**

| Action | Command |
|---|---|
| Mac mini: open scheduler UI | `cd ~/Repos/stock-game && npm run stockgame` |
| Mac mini: manual one-shot refresh | `cd ~/Repos/stock-game && npm run refresh` |
| Laptop: dev server | `cd ~/Repos/stock-game && npm run dev` |
| Laptop: feature branch + PR | `git checkout -b feat/x && ... && git push -u origin feat/x && gh pr create` |

**If you find iCloud duplicates after the fact** (`<file> 2`,
`<file> 2.json`, etc.) inside the repo, sweep them out:

```bash
cd ~/Repos/stock-game
find . -name "* 2" -o -name "* 2.*" | xargs rm -rf
```

If you find them and the repo IS in iCloud, that's the signal to
relocate (`mv ~/Desktop/Stock\ Game\ App/stock-game ~/Repos/`).

---

## §13.3. Working from Claude Code mobile (GitHub connector)

This repo is set up so it's usable from the Claude Code mobile app via
the GitHub connector. The intended flow when you're away from the
laptop:

```
[iPhone, Claude Code mobile]
   "tweak the digest.swift prompt so the AI never says 'today's market'"
   → mobile-Claude edits scripts/digest.swift
   → commits to btheis15/stock-game / main via GitHub API
       ↓
[GitHub Actions]
   build.yml fires:
     • build       (Ubuntu)  — npm install + next build
     • python-syntax (Ubuntu) — py_compile scripts/stockgame_schedule.py
     • swift-syntax  (macOS) — swift -frontend -parse scripts/digest.swift
   If any fails, the mobile UI shows the red ✗ and you push a fix.
       ↓ all green
[Mac mini]
   Within ~60 s the tkinter scheduler's background pull
   (`_background_pull` in stockgame_schedule.py) fetches origin/main
   and writes the new files to disk. The mtime watcher then auto-
   restarts the scheduler if its own source changed.
   The next 15-min cron tick is also pulling on its own cadence —
   redundant, intentionally so. Doesn't matter which one wins; both
   land at the same SHA.
       ↓
[Mac mini, next fire of cron-update.sh / digest-update.sh]
   reads the updated file from disk and runs it. Swift script edits
   take effect on the next 7 AM briefing fire (or "Run Briefing Now").
```

### What works well from mobile-Claude

- **digest.swift prompt edits** (the most common ask). Tweaking the
  3-sentence template, adding rejection rules, changing tone, etc.
  The swift-syntax CI job catches typos; if the prompt itself produces
  bad prose, the next morning's briefing will show it and you can
  push a refinement.
- **UI text / colors / Tailwind classes** in `components/` and `app/`.
  The build job catches type errors and bad JSX. PWA preview deploys
  automatically.
- **picks.ts edits**: changing a player's color, renaming, fixing a
  typo in TICKER_NAMES. Adding a *new* ticker mid-game is technically
  possible but the data backfill needs a `--full` fetch which the
  cron only does on the laptop trigger (see §10.2 for why); plan
  ticker additions for the laptop, not mobile.
- **Doc edits** in CLAUDE.md / STATE.md / OVERVIEW.md.
- **stockgame_schedule.py tweaks**: UI labels, status text. The
  scheduler will auto-restart on the Mac mini within ~60 s of CI
  going green.

### What to avoid from mobile-Claude

- **`npm run fetch-prices -- --full`** can't run from a phone push.
  If a change *requires* a full fetch (adding a new ticker, moving
  START_DATE, etc.), do it from the laptop.
- **OG image / PWA icon regeneration** (`scripts/make-og.py`,
  `scripts/make-icons.py`) needs local Python + Pillow. Cosmetic only;
  defer to laptop.
- **Anything touching `public/data/prices.json`** — that file is
  auto-generated. Never hand-edit.
- **Big refactors** that need `npm run dev` to verify visually.
  Mobile can't preview at small/iPhone widths; ship those from the
  laptop after `npm run dev` poke-tests.

### Safety nets

- **CI build job** catches TS/React errors.
- **CI python-syntax job** catches `stockgame_schedule.py` typos.
- **CI swift-syntax job** catches `digest.swift` parse errors.
- **Scheduler's `py_compile` check on auto-restart** is the last gate
  before the new code actually runs on the Mac mini — a syntax error
  that somehow slipped past CI (e.g., merge conflict resolution) gets
  caught here and the old process keeps running with a red "Code"
  banner.
- **digest pipeline** never pushes; `cron-update.sh` is the only
  publisher. Mobile commits + this script never race on push.

### How to connect this repo in the mobile app

(This is a one-time UI step, not something I can do from this terminal.)

1. Open Claude Code mobile → Settings → Connectors → GitHub.
2. Make sure the GitHub account that owns `btheis15/stock-game` is
   authorized.
3. Add `btheis15/stock-game` to the allowed repositories list (if it
   isn't already covered by an "all repos" grant).
4. Start a new chat and reference the repo by name to begin.

---

## §14. What you don't need to worry about

- **Authentication.** GitHub auth (gh keyring) and Vercel auth (CLI
  token) are persisted on the developer's Mac. New machines need a
  one-time `gh auth login` and (optionally) `vercel login`. There are
  no API keys in the codebase.
- **Secrets.** One set: `GITHUB_TOKEN` / `GITHUB_OWNER` / `GITHUB_REPO`
  on the Vercel project (fine-grained PAT, Contents read+write) — powers
  both the funds/thesis CRUD writes AND the runtime data reads
  (lib/remote-json.ts). Nothing in the codebase; `.env*` is gitignored.
  The Mac mini holds no API keys (gh keyring only). Yahoo Finance is
  unauthenticated.
- **Database.** None. The "database" is `public/data/prices.json`
  committed to the repo, served to the app at request time from
  origin/main. Vercel rebuilds only on code pushes (see §3 / §8.7).
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
- v6: iOS-style motion layer (commit `ef17cd9`). CSS-only route
  transitions (`app/template.tsx`: tab cross-fade, drill push/pop),
  reusable `<Sheet>` bottom-sheet primitive (FilterSheet + WhatsNew
  converted), motion tokens + `.press` tap feedback, and a global
  `prefers-reduced-motion` guard. WhatsNew moved off framer-motion;
  framer-motion still powers the donut / composition / thesis. See §6.5.

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
