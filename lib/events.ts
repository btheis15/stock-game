/**
 * Corporate-action events that change the shape of a portfolio after the
 * Feb 5, 2026 inception date.
 *
 * Two kinds live here:
 *
 *   1. SPIN-OFFS — a parent distributes shares of a new child company. On
 *      `effectiveDate`, the parent's holders get
 *      `parent_shares * sharesPerParentShare` shares of `childTicker`,
 *      priced at the child's first close on or after `effectiveDate`. From
 *      that day forward the child contributes its own value to the parent
 *      owner's portfolio total (see `portfolioSeries` in `lib/portfolio.ts`).
 *
 *      The child ticker MUST also be added to `config/roster.json`
 *      `ticker_names` and is fetched automatically (the fetch script pulls
 *      it via `getSpinoffTickers`). The child is surfaced as a first-class
 *      holding/stock WITHOUT being added to any user's `tickers` array —
 *      that would change `perHoldingDollars` ($100k / N) and dilute the
 *      user's other picks. Ownership is derived from the parent in
 *      `lib/picks.ts` (TICKER_OWNERS) and `buildHoldingRows`.
 *
 *   2. REVERSE SPLITS — a ticker reverse- (or forward-) splits. Yahoo
 *      retroactively re-scales that ticker's WHOLE price history so the
 *      chart stays continuous, but the app freezes `startClose` at the real
 *      inception-day price and pins a fixed share count to it. To keep the
 *      two in the same units, `fetch-prices.ts` divides every freshly-fetched
 *      close (daily / intraday / weekly / dividend) by `priceUnitDivisor`
 *      once the split is effective. See `priceUnitDivisor` below.
 *
 * ── Honeywell Aerospace breakup (effective 2026-06-29) ──────────────────
 * Honeywell split its Aerospace business into a standalone company on
 * 2026-06-29 (record date 2026-06-15, distribution 12:01am 2026-06-29):
 *   - Each HON holder received 1 share of Honeywell Aerospace (HONA, Nasdaq)
 *     for every 2 HON shares → `sharesPerParentShare: 0.5`.
 *   - Immediately after (12:02am 2026-06-29) HON did a 1-for-2 reverse split
 *     (≈634M → ≈317M shares; price ≈doubled). The remaining HON ≈ Honeywell
 *     Automation and keeps the HON ticker. This is the reverse-split entry
 *     below; it neutralizes Yahoo's retroactive price re-scaling so HON's
 *     curve stays continuous through the event (the split is economically a
 *     no-op — only the value that moved to HONA leaves HON).
 *
 * (The earlier Solstice Advanced Materials / SOLS spin-off completed
 * 2025-10-30, BEFORE the game's 2026-02-05 start, so it's already baked into
 * HON's history and needs no entry here.)
 */
import eventsJson from "@/config/events.json";

export interface SpinoffEvent {
  parentTicker: string;
  childTicker: string;
  childName: string;
  effectiveDate: string;
  sharesPerParentShare: number;
}

// Event data lives in config/events.json so scripts/digest.swift can read the
// SAME file (its loadEvents() mirrors loadRoster()) — a Swift/TS drift here
// would make digest prose disagree with the app's portfolio math. Note
// config/events.json must NOT be excluded in scripts/vercel-ignore-build.sh:
// it's statically imported, so a change must trigger a rebuild (same rule as
// roster.json).
export const SPINOFFS: SpinoffEvent[] = eventsJson.spinoffs;

/**
 * A reverse (or forward) split on `ticker`, effective `effectiveDate`.
 *
 * `factor` is the number to DIVIDE Yahoo's split-adjusted close by to restore
 * the pre-split share units the app's frozen `startClose` is denominated in.
 * For a 1-for-2 reverse split, Yahoo multiplies historical prices by 2 to keep
 * the chart continuous with the ~doubled post-split price, so `factor: 2`
 * undoes that and keeps the whole series in inception-day units. (A 2-for-1
 * forward split would halve prices, so `factor: 0.5`.)
 */
export interface ReverseSplitEvent {
  ticker: string;
  effectiveDate: string;
  factor: number;
}

export const REVERSE_SPLITS: ReverseSplitEvent[] = eventsJson.reverseSplits;

export function getSpinoffTickers(): string[] {
  return SPINOFFS.map((s) => s.childTicker);
}

export function spinoffsForParent(parent: string): SpinoffEvent[] {
  return SPINOFFS.filter((s) => s.parentTicker === parent);
}

export function spinoffForChild(child: string): SpinoffEvent | undefined {
  return SPINOFFS.find((s) => s.childTicker === child);
}

export interface SpinoffNote {
  role: "parent" | "child";
  event: SpinoffEvent;
}

/**
 * Ticker-keyed lookup for display code: is this ticker on either side of a
 * spin-off? Lets holdings lists, the stock detail page, and mover rows caption
 * a price move that's actually a corporate-action reclassification (value
 * moving to/from a sibling ticker) instead of showing a bare, misleading pct
 * (e.g. HON's ~50% "drop" on the HONA spin-off date, which is really value
 * that moved to HONA, not a loss).
 */
export function spinoffNoteFor(ticker: string): SpinoffNote | null {
  const asParent = spinoffsForParent(ticker)[0];
  if (asParent) return { role: "parent", event: asParent };
  const asChild = spinoffForChild(ticker);
  if (asChild) return { role: "child", event: asChild };
  return null;
}

/**
 * Cumulative factor to divide Yahoo's reported close for `ticker` by, given
 * the run date `asOf`. Returns 1 for tickers/dates with no effective split, so
 * `fetch-prices.ts` can call it unconditionally on every ticker. Only splits
 * whose `effectiveDate` has arrived apply — before then Yahoo hasn't re-scaled
 * the series yet, so dividing would be wrong.
 */
export function priceUnitDivisor(ticker: string, asOf: Date = new Date()): number {
  const iso = asOf.toISOString().slice(0, 10);
  return REVERSE_SPLITS.filter(
    (r) => r.ticker === ticker && iso >= r.effectiveDate
  ).reduce((acc, r) => acc * r.factor, 1);
}
