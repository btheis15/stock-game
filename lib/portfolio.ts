import type {
  Fund,
  HoldingRow,
  IntradayBar,
  PortfolioPoint,
  PriceData,
  Range,
  RangeAnalysis,
  RangeMover,
  TickerSeries,
} from "./types";
import {
  BASELINE,
  STARTING_PORTFOLIO_DOLLARS,
  USER_LIST,
  USERS,
  perHoldingDollars,
  type UserId,
} from "./picks";
import { SPINOFFS } from "./events";
import {
  EARLY_CLOSE_HOUR_ET,
  marketEarlyCloseName,
  marketHolidayName,
} from "./market-calendar";

export const STARTING_PORTFOLIO_VALUE = STARTING_PORTFOLIO_DOLLARS;

export function getCloseMap(series: TickerSeries): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of series.closes) m.set(c.date, c.close);
  return m;
}

export function lastKnownClose(series: TickerSeries, date: string): number {
  let val = series.startClose;
  for (const c of series.closes) {
    if (c.date > date) break;
    val = c.close;
  }
  return val;
}

export function sharesFor(userId: UserId, series: TickerSeries): number {
  return perHoldingDollars(userId) / series.startClose;
}

export function dividendsReceived(
  series: TickerSeries,
  shares: number,
  asOf: string
): number {
  let cash = 0;
  for (const d of series.dividends ?? []) {
    if (d.date <= asOf) cash += shares * d.amount;
  }
  return cash;
}

export function portfolioSeries(data: PriceData, userId: UserId): PortfolioPoint[] {
  const tickers = USERS[userId].tickers;
  // Filter out tickers missing from prices.json — handles the transient state
  // right after a roster change, where picks.ts lists a ticker the cron hasn't
  // fetched yet. The next fetch-prices run populates them and the curve fills
  // in. Without this guard, the SSG build crashes on `undefined.startClose`.
  const seriesByTicker = tickers
    .map((t) => data.tickers[t])
    .filter((s): s is TickerSeries => s != null);
  const userSpinoffs = SPINOFFS.filter((s) =>
    USERS[userId].tickers.includes(s.parentTicker)
  );

  return data.tradingDates.map((date) => {
    let total = 0;
    for (const s of seriesByTicker) {
      const shares = sharesFor(userId, s);
      total += shares * lastKnownClose(s, date);
      total += dividendsReceived(s, shares, date);
    }
    for (const so of userSpinoffs) {
      if (so.effectiveDate > date) continue;
      const parent = data.tickers[so.parentTicker];
      const child = data.tickers[so.childTicker];
      if (!parent || !child) continue;
      const parentShares = sharesFor(userId, parent);
      const childShares = parentShares * so.sharesPerParentShare;
      total += childShares * lastKnownClose(child, date);
      total += dividendsReceived(child, childShares, date);
    }
    return { date, value: total };
  });
}

/**
 * Baseline ("S&P 500") portfolio: $100k of SPY bought at the START_DATE close,
 * plus dividend reinvestment-equivalent cash (kept as cash, same as the human
 * players' dividend handling — neither side compounds). Mirrors
 * `portfolioSeries` so the resulting curve plots on the same axis as the
 * human players. Returns [] if SPY data isn't present yet (first-ever fetch
 * hasn't run, or older snapshot).
 */
export function baselinePortfolioSeries(data: PriceData): PortfolioPoint[] {
  const s = data.tickers[BASELINE.ticker];
  if (!s) return [];
  const shares = STARTING_PORTFOLIO_DOLLARS / s.startClose;
  return data.tradingDates.map((date) => ({
    date,
    value: shares * lastKnownClose(s, date) + dividendsReceived(s, shares, date),
  }));
}

export function intradayBaselineSeries(
  data: PriceData
): { points: PortfolioPoint[]; previousClose: number } | null {
  const s = data.tickers[BASELINE.ticker];
  if (!s) return null;
  const shares = STARTING_PORTFOLIO_DOLLARS / s.startClose;

  const intradayDate = data.intradayDate ?? "";
  const prevDates = data.tradingDates.filter((d) => d < intradayDate);
  const prevDate =
    prevDates[prevDates.length - 1] ??
    data.tradingDates[data.tradingDates.length - 1];
  const previousClose = shares * lastKnownClose(s, prevDate);

  const points = (s.intraday ?? []).map((b) => ({
    date: b.t,
    value: shares * b.close,
  }));
  return { points, previousClose };
}

export function weeklyBaselineSeries(data: PriceData): PortfolioPoint[] | null {
  const s = data.tickers[BASELINE.ticker];
  if (!s) return null;
  const series = weeklyTickerSeries(s);
  if (!series) return null;
  const shares = STARTING_PORTFOLIO_DOLLARS / s.startClose;
  return series.map((p) => ({ date: p.date, value: shares * p.value }));
}

// --- User-created funds -----------------------------------------------------
// Same shape as the baseline and player curves so the Compare-chart plotter
// treats them identically. Differs from players in that allocation is
// weighted (not equal-split): `shares = $100k × weight / startClose`. Missing
// tickers (right after a roster change, before fetch-prices fills them in)
// are skipped — the curve shows the partial value rather than crashing.

function fundHoldingShares(
  fund: Fund,
  ticker: string,
  series: TickerSeries
): number {
  const h = fund.holdings.find((x) => x.ticker === ticker);
  if (!h) return 0;
  return (STARTING_PORTFOLIO_DOLLARS * h.weight) / series.startClose;
}

// Principal parked in holdings whose ticker isn't in the snapshot yet — the
// window between creating a fund with a brand-new ticker and the next
// price-fetch cron backfilling its history. We can't value those off real
// prices, so we hold them flat at their allocated dollars (weight × $100k)
// rather than dropping them. Dropping made a fresh $100k two-stock fund
// display only the *fetched* holding's value (e.g. "$55,000" for a fund
// whose second ticker hadn't been fetched). Once the cron fills the ticker
// in, this term goes to 0 and the holding is valued off real closes.
function unfetchedHoldingDollars(data: PriceData, fund: Fund): number {
  return fund.holdings
    .filter((h) => data.tickers[h.ticker] == null)
    .reduce((sum, h) => sum + STARTING_PORTFOLIO_DOLLARS * h.weight, 0);
}

export function fundSeries(data: PriceData, fund: Fund): PortfolioPoint[] {
  const seriesByTicker = fund.holdings
    .map((h) => data.tickers[h.ticker])
    .filter((s): s is TickerSeries => s != null);
  const unfetched = unfetchedHoldingDollars(data, fund);
  return data.tradingDates.map((date) => {
    let total = unfetched;
    for (const s of seriesByTicker) {
      const shares = fundHoldingShares(fund, s.ticker, s);
      total += shares * lastKnownClose(s, date);
      total += dividendsReceived(s, shares, date);
    }
    return { date, value: total };
  });
}

export function intradayFundSeries(
  data: PriceData,
  fund: Fund
): { points: PortfolioPoint[]; previousClose: number } | null {
  const seriesByTicker = fund.holdings
    .map((h) => data.tickers[h.ticker])
    .filter((s): s is TickerSeries => s != null);
  if (seriesByTicker.length === 0) return null;

  const intradayDate = data.intradayDate ?? "";
  const prevDates = data.tradingDates.filter((d) => d < intradayDate);
  const prevDate =
    prevDates[prevDates.length - 1] ??
    data.tradingDates[data.tradingDates.length - 1];

  const unfetched = unfetchedHoldingDollars(data, fund);
  const previousClose = seriesByTicker.reduce((sum, s) => {
    return sum + fundHoldingShares(fund, s.ticker, s) * lastKnownClose(s, prevDate);
  }, unfetched);

  const tsSet = new Set<string>();
  for (const s of seriesByTicker) {
    for (const b of s.intraday ?? []) tsSet.add(b.t);
  }
  const timestamps = [...tsSet].sort();
  if (timestamps.length === 0) return { points: [], previousClose };

  const lookups = seriesByTicker.map((s) => {
    const m = new Map<string, number>();
    for (const b of s.intraday ?? []) m.set(b.t, b.close);
    return { series: s, m };
  });

  const lastSeen = new Map<string, number>();
  for (const { series } of lookups) {
    lastSeen.set(series.ticker, lastKnownClose(series, prevDate));
  }

  const points: PortfolioPoint[] = [];
  for (const t of timestamps) {
    let total = unfetched;
    for (const { series, m } of lookups) {
      const fresh = m.get(t);
      if (fresh != null) lastSeen.set(series.ticker, fresh);
      const price = lastSeen.get(series.ticker)!;
      total += fundHoldingShares(fund, series.ticker, series) * price;
    }
    points.push({ date: t, value: total });
  }
  return { points, previousClose };
}

export function weeklyFundSeries(data: PriceData, fund: Fund): PortfolioPoint[] | null {
  const seriesByTicker = fund.holdings
    .map((h) => data.tickers[h.ticker])
    .filter((s): s is TickerSeries => s != null);
  if (seriesByTicker.length === 0) return null;
  const haveWeekly = seriesByTicker.some((s) => (s.weekly?.length ?? 0) > 0);
  if (!haveWeekly) return null;

  const tsSet = new Set<string>();
  for (const s of seriesByTicker) {
    for (const b of s.weekly ?? []) {
      if (!isHourBoundaryBar(b)) continue;
      tsSet.add(b.t);
    }
  }
  const allTs = [...tsSet].sort().map((t) => ({ t }));
  const timestamps = trimToLastNTradingDays(allTs, WEEKLY_TRADING_DAYS).map((x) => x.t);
  if (timestamps.length === 0) return null;

  const firstDate = timestamps[0].slice(0, 10);
  const lookups = seriesByTicker.map((s) => {
    const m = new Map<string, number>();
    for (const b of s.weekly ?? []) m.set(b.t, b.close);
    return { series: s, m };
  });
  const lastSeen = new Map<string, number>();
  for (const { series } of lookups) {
    lastSeen.set(series.ticker, lastKnownClose(series, firstDate));
  }
  const unfetched = unfetchedHoldingDollars(data, fund);

  const points: PortfolioPoint[] = [];
  for (const t of timestamps) {
    let total = unfetched;
    for (const { series, m } of lookups) {
      const fresh = m.get(t);
      if (fresh != null) lastSeen.set(series.ticker, fresh);
      const price = lastSeen.get(series.ticker)!;
      total += fundHoldingShares(fund, series.ticker, series) * price;
    }
    points.push({ date: t, value: total });
  }
  return points;
}

export const RANGE_DAYS: Record<Range, number | "all" | "intraday"> = {
  "1D": "intraday",
  "1W": 7,
  "1M": 30,
  "3M": 90,
  "1YR": 365,
  ALL: "all",
};

export function filterRange<T extends { date: string }>(points: T[], range: Range): T[] {
  if (range === "ALL" || range === "1D" || points.length === 0) return points;
  const days = RANGE_DAYS[range] as number;
  const last = new Date(points[points.length - 1].date + "T00:00:00Z");
  const cutoff = new Date(last);
  cutoff.setUTCDate(cutoff.getUTCDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const idx = points.findIndex((p) => p.date >= cutoffStr);
  return idx <= 0 ? points : points.slice(idx);
}

// Extended US trading session: 7:00 AM ET (pre-market start) → 6:00 PM ET
// (after-hours end). The chart axis and intraday fetch both use this wider
// window so pre-market and after-hours moves are visible on the 1D view.
// Regular session is the 9:30 AM – 4:00 PM ET subset.
export const EXTENDED_SESSION_START_HOUR_ET = 7;
export const EXTENDED_SESSION_END_HOUR_ET = 18;
export const REGULAR_SESSION_START_HOUR_ET = 9.5;
export const REGULAR_SESSION_END_HOUR_ET = 16;

export function intradayPortfolioSeries(
  data: PriceData,
  userId: UserId
): { points: PortfolioPoint[]; previousClose: number } {
  const tickers = USERS[userId].tickers;
  const seriesByTicker = tickers
    .map((t) => data.tickers[t])
    .filter((s): s is TickerSeries => s != null);

  // Find previous trading day (last entry in tradingDates that's before today's intraday date)
  const intradayDate = data.intradayDate ?? "";
  const prevDates = data.tradingDates.filter((d) => d < intradayDate);
  const prevDate = prevDates[prevDates.length - 1] ?? data.tradingDates[data.tradingDates.length - 1];

  const previousClose = seriesByTicker.reduce((sum, s) => {
    return sum + sharesFor(userId, s) * lastKnownClose(s, prevDate);
  }, 0);

  // Collect all unique intraday timestamps across this user's tickers
  const tsSet = new Set<string>();
  for (const s of seriesByTicker) {
    for (const b of s.intraday ?? []) tsSet.add(b.t);
  }
  const timestamps = [...tsSet].sort();
  if (timestamps.length === 0) return { points: [], previousClose };

  // Build per-ticker quick lookups
  const lookups = seriesByTicker.map((s) => {
    const m = new Map<string, number>();
    for (const b of s.intraday ?? []) m.set(b.t, b.close);
    return { series: s, m };
  });

  const points: PortfolioPoint[] = [];
  // Track most-recent intraday price per ticker (carry-forward fill)
  const lastSeen = new Map<string, number>();
  for (const { series } of lookups) {
    lastSeen.set(series.ticker, lastKnownClose(series, prevDate));
  }

  for (const t of timestamps) {
    let total = 0;
    for (const { series, m } of lookups) {
      const fresh = m.get(t);
      if (fresh != null) lastSeen.set(series.ticker, fresh);
      const price = lastSeen.get(series.ticker)!;
      total += sharesFor(userId, series) * price;
    }
    points.push({ date: t, value: total });
  }

  return { points, previousClose };
}

// Cap the 1W view at the most-recent 5 distinct trading days. Yahoo's 8-day
// lookback always gives us a partial first day at one edge of the window;
// trimming to 5 complete days means the chart shows a consistent "trading
// week" without that stub. Also matches what Robinhood / most stock UIs
// consider "1W."
const WEEKLY_TRADING_DAYS = 5;

/**
 * Yahoo's 1h bars normally arrive at clean hour boundaries (minute=30,
 * second=0 in UTC for US market alignment). When the market is mid-hour
 * Yahoo also returns a "live current-quote" bar with the actual
 * second-of-now timestamp (e.g. `19:29:33`). That bar makes the spacing
 * between the last two points uneven (~59 min vs the consistent 60 min
 * elsewhere). Drop those non-aligned bars from the 1W view so every
 * plotted point sits at the same hourly interval.
 */
function isHourBoundaryBar(b: { t: string }): boolean {
  // Cheap and exact: regular hourly bars end with ":30:00.000Z" (or
  // ":00:00.000Z" if Yahoo aligns differently for some markets). The live
  // bar always has a non-zero seconds component — `19:29:33.000Z` etc.
  return b.t.endsWith(":00.000Z");
}

/** Group bars by their trading day (UTC YYYY-MM-DD prefix), keep the last N
 *  groups, return the bars belonging to those days. Bars within each kept day
 *  remain in their original order. */
function trimToLastNTradingDays<B extends { t: string }>(
  bars: B[],
  n: number
): B[] {
  if (bars.length === 0) return bars;
  const days = new Set<string>();
  for (const b of bars) days.add(b.t.slice(0, 10));
  const sortedDays = [...days].sort();
  const keepDays = new Set(sortedDays.slice(-n));
  return bars.filter((b) => keepDays.has(b.t.slice(0, 10)));
}

/**
 * Builds a portfolio-level series from per-ticker hourly bars covering roughly
 * the past 7–8 days. Used by the 1W view so the chart line has proper density.
 *
 * Strategy mirrors `intradayPortfolioSeries`: collect every unique timestamp
 * across the user's tickers, walk forward, and at each timestamp sum
 * (sharesFor(ticker) × most-recent-known-close-of-that-ticker). Tickers with no
 * weekly data fall back to the most recent daily close as their value.
 *
 * Output is trimmed to the most recent 5 trading days so the chart doesn't
 * show a partial first-day stub.
 *
 * Returns `null` if no ticker has weekly data — caller should fall back to the
 * existing daily-closes path.
 */
export function weeklyPortfolioSeries(
  data: PriceData,
  userId: UserId
): PortfolioPoint[] | null {
  const tickers = USERS[userId].tickers;
  const seriesByTicker = tickers
    .map((t) => data.tickers[t])
    .filter((s): s is TickerSeries => s != null);
  const haveWeekly = seriesByTicker.some((s) => (s.weekly?.length ?? 0) > 0);
  if (!haveWeekly) return null;

  const tsSet = new Set<string>();
  for (const s of seriesByTicker) {
    for (const b of s.weekly ?? []) {
      // Skip Yahoo's live partial bar so all plotted points sit on hour
      // boundaries (consistent intervals, no stray sub-hour spacing).
      if (!isHourBoundaryBar(b)) continue;
      tsSet.add(b.t);
    }
  }
  // Trim union of timestamps to the last 5 distinct trading days.
  const allTs = [...tsSet].sort().map((t) => ({ t }));
  const timestamps = trimToLastNTradingDays(allTs, WEEKLY_TRADING_DAYS).map((x) => x.t);
  if (timestamps.length === 0) return null;

  // Carry-forward last-seen close per ticker. Initialize with the daily close
  // from just before the first timestamp so a missing first bar doesn't drag
  // the value to zero.
  const firstDate = timestamps[0].slice(0, 10);
  const lookups = seriesByTicker.map((s) => {
    const m = new Map<string, number>();
    for (const b of s.weekly ?? []) m.set(b.t, b.close);
    return { series: s, m };
  });
  const lastSeen = new Map<string, number>();
  for (const { series } of lookups) {
    lastSeen.set(series.ticker, lastKnownClose(series, firstDate));
  }

  const points: PortfolioPoint[] = [];
  for (const t of timestamps) {
    let total = 0;
    for (const { series, m } of lookups) {
      const fresh = m.get(t);
      if (fresh != null) lastSeen.set(series.ticker, fresh);
      const price = lastSeen.get(series.ticker)!;
      total += sharesFor(userId, series) * price;
    }
    points.push({ date: t, value: total });
  }
  return points;
}

/**
 * Past-week hourly bars for a single ticker, trimmed to the last 5 trading
 * days. Returns `null` if the ticker has no weekly data — caller should fall
 * back to daily-close range filtering.
 */
export function weeklyTickerSeries(
  series: TickerSeries
): PortfolioPoint[] | null {
  const bars = (series.weekly ?? []).filter(isHourBoundaryBar);
  if (bars.length === 0) return null;
  const trimmed = trimToLastNTradingDays(bars, WEEKLY_TRADING_DAYS);
  if (trimmed.length === 0) return null;
  return trimmed.map((b) => ({ date: b.t, value: b.close }));
}

export function intradayTickerSeries(
  series: TickerSeries,
  intradayDate: string
): { points: PortfolioPoint[]; previousClose: number } {
  let previousClose = 0;
  for (const c of series.closes) {
    if (c.date >= intradayDate) break;
    previousClose = c.close;
  }
  if (previousClose === 0) previousClose = series.closes[0]?.close ?? 0;
  const points = (series.intraday ?? []).map((b) => ({ date: b.t, value: b.close }));
  return { points, previousClose };
}

const LIVE_MAX_LAG_MS = 30 * 60 * 1000;

/**
 * Data-freshness check for the chart's pulsing endpoint: true when the most
 * recent intraday bar arrived within the last 30 minutes. Distinct from
 * `isUsMarketOpen` — when the price-refresh cron breaks, isMarketLive goes
 * false even though the market is actually open. Use this only for "are we
 * receiving realtime data" signals (the chart pulse). For the user-facing
 * "Market open" badge and theme switch, use `isUsMarketOpen()`.
 */
export function isMarketLive(intraday: IntradayBar[] | undefined): boolean {
  if (!intraday || intraday.length === 0) return false;
  const lastBar = new Date(intraday[intraday.length - 1].t);
  const now = Date.now();
  return now - lastBar.getTime() < LIVE_MAX_LAG_MS;
}

export type MarketSessionState =
  | "premarket" // Mon-Fri 7:00 - 9:30 AM ET
  | "open" // Mon-Fri 9:30 AM - 4:00 PM ET
  | "afterhours" // Mon-Fri 4:00 - 6:00 PM ET
  | "closed"; // Everything else (overnight, weekends)

/**
 * Calendar-based market session state for the current moment in ET.
 * DST-aware via the "America/New_York" IANA zone, and holiday-aware via
 * `lib/market-calendar.ts`: full-closure NYSE holidays report "closed" all
 * day, and scheduled early-close ("half") days use the 1:00 PM ET close so the
 * dead afternoon reports "afterhours"/"closed" instead of a phantom "open".
 *
 * Use this for the user-facing badge and the theme switch. Don't use it for
 * the chart's pulsing endpoint — that wants `isMarketLive` (data freshness),
 * since a stale-data session shouldn't show a pulsing "live" dot even if
 * calendar says open.
 */
export function getMarketSessionState(now: Date = new Date()): MarketSessionState {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value;
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const minute = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  if (weekday === "Sat" || weekday === "Sun") return "closed";
  if (marketHolidayName(now)) return "closed";
  const minutes = hour * 60 + minute;
  const closeHour = marketEarlyCloseName(now) ? EARLY_CLOSE_HOUR_ET : 16;
  if (minutes >= 7 * 60 && minutes < 9 * 60 + 30) return "premarket";
  if (minutes >= 9 * 60 + 30 && minutes < closeHour * 60) return "open";
  if (minutes >= closeHour * 60 && minutes < 18 * 60) return "afterhours";
  return "closed";
}

/**
 * Convenience wrapper preserved for callers that only need the regular-hours
 * boolean. Equivalent to `getMarketSessionState() === "open"`.
 */
export function isUsMarketOpen(now: Date = new Date()): boolean {
  return getMarketSessionState(now) === "open";
}

export function pctChange(start: number, end: number): number {
  return start === 0 ? 0 : (end - start) / start;
}

export function fmtUSD(n: number, fractionDigits = 2): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

export function fmtSignedUSD(n: number, fractionDigits = 2): string {
  const sign = n >= 0 ? "+" : "−";
  return `${sign}${fmtUSD(Math.abs(n), fractionDigits)}`;
}

export function fmtPct(n: number, fractionDigits = 2): string {
  const sign = n >= 0 ? "+" : "−";
  return `${sign}${(Math.abs(n) * 100).toFixed(fractionDigits)}%`;
}

export function fmtDateLong(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function fmtDateShort(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  });
}

export function fmtTimeOfDay(iso: string): string {
  // Render an ISO-UTC timestamp (intraday bar) in the user's local clock,
  // hour:minute AM/PM. Ignore seconds.
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/**
 * Absolute timestamp pinned to Eastern Time with an explicit "ET" label —
 * e.g. "Jul 13, 9:59 AM ET". Used as the fallback for `fmtRelativeTime` and
 * as the hydration-safe first paint of `<RelativeTime>` (an absolute string
 * renders identically on server and client; a relative one doesn't).
 */
export function fmtDateTimeET(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const s = d.toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return `${s} ET`;
}

/**
 * Relative freshness label: "just now" (<60s), "N min ago", "N hr ago"
 * (<6h), then falls back to the absolute ET timestamp ("Jul 13, 9:59 AM ET")
 * — past 6 hours a wall-clock time reads better than "14 hr ago".
 */
export function fmtRelativeTime(iso: string, now: number = Date.now()): string {
  const t = new Date(iso).getTime();
  if (isNaN(t)) return "";
  const sec = Math.max(0, (now - t) / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 6) return `${hr} hr ago`;
  return fmtDateTimeET(iso);
}

/**
 * Unsigned weight percentage from a 0–1 fraction — "12.5%". The signed
 * `fmtPct` is for gains/losses; fund weights are compositions, so a plus
 * sign would misread as a return.
 */
export function fmtWeightPct(fraction: number, digits = 1): string {
  return `${(fraction * 100).toFixed(digits)}%`;
}

/**
 * Share counts: up to 4 decimals, trailing zeros trimmed — "12.5",
 * "0.0431", "100". Fractional shares need the precision; whole-share
 * counts shouldn't drag ".0000" around.
 */
export function fmtShares(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

/**
 * Returns the extended US trading session bounds (7:00 AM – 6:00 PM ET) for
 * the given ET date, as a [start, end] tuple in UTC. The wider window covers
 * pre-market (7:00 – 9:30 AM ET) and after-hours (4:00 – 6:00 PM ET) so the
 * 1D chart axis spans every period bars may arrive in.
 */
export function sessionBoundsForDate(intradayDateUTC: string): [Date, Date] {
  // ET is UTC-5 (winter) or UTC-4 (summer). Use UTC-4 Mar-Nov, UTC-5
  // Dec-Feb as a rough heuristic. Wrong on the 4 DST transition days per
  // year; harmless for axis rendering.
  const dt = new Date(intradayDateUTC + "T00:00:00Z");
  const month = dt.getUTCMonth(); // 0-indexed
  const isEDT = month >= 2 && month <= 10;
  const offset = isEDT ? 4 : 5; // hours behind UTC
  const start = new Date(
    `${intradayDateUTC}T${String(7 + offset).padStart(2, "0")}:00:00Z`
  );
  const end = new Date(
    `${intradayDateUTC}T${String(18 + offset).padStart(2, "0")}:00:00Z`
  );
  return [start, end];
}

export function rangeBounds(
  tradingDates: string[],
  range: Range
): { startDate: string; endDate: string } {
  if (tradingDates.length === 0) return { startDate: "", endDate: "" };
  const endDate = tradingDates[tradingDates.length - 1];
  if (range === "ALL") return { startDate: tradingDates[0], endDate };
  if (range === "1D") {
    // Previous trading day → today. End date is the intraday date if present;
    // start date is the most recent earlier trading day.
    const prev = tradingDates[tradingDates.length - 2] ?? endDate;
    return { startDate: prev, endDate };
  }
  const days = RANGE_DAYS[range] as number;
  const last = new Date(endDate + "T00:00:00Z");
  const cutoff = new Date(last);
  cutoff.setUTCDate(cutoff.getUTCDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const startIdx = tradingDates.findIndex((d) => d >= cutoffStr);
  const startDate = startIdx <= 0 ? tradingDates[0] : tradingDates[startIdx];
  return { startDate, endDate };
}

/**
 * For a range, return the start and end close used to score a single ticker.
 * 1D uses (previous-day close → latest intraday bar) so it matches the live
 * curve; other ranges use (lastKnownClose at startDate → lastKnownClose at
 * endDate).
 */
export function rangeCloses(
  series: TickerSeries,
  data: PriceData,
  range: Range
): { startClose: number; endClose: number } {
  if (range === "1D") {
    const intradayDate =
      data.intradayDate ?? data.tradingDates[data.tradingDates.length - 1];
    const prevDates = data.tradingDates.filter((d) => d < intradayDate);
    const prevDate =
      prevDates[prevDates.length - 1] ??
      data.tradingDates[data.tradingDates.length - 1];
    const startClose = lastKnownClose(series, prevDate);
    const intraday = series.intraday ?? [];
    const endClose =
      intraday[intraday.length - 1]?.close ??
      series.closes[series.closes.length - 1]?.close ??
      startClose;
    return { startClose, endClose };
  }
  const { startDate, endDate } = rangeBounds(data.tradingDates, range);
  return {
    startClose: lastKnownClose(series, startDate),
    endClose: lastKnownClose(series, endDate),
  };
}

export function analyzeRange(data: PriceData, range: Range): RangeAnalysis {
  const { startDate, endDate } = rangeBounds(data.tradingDates, range);

  const allMovers: RangeMover[] = [];
  const perUser = {} as RangeAnalysis["perUser"];

  for (const u of USER_LIST) {
    const userMovers: RangeMover[] = [];
    let startTotal = 0;
    let endTotal = 0;
    for (const t of u.tickers) {
      const s = data.tickers[t];
      if (!s) continue;
      const shares = sharesFor(u.id, s);
      const { startClose, endClose } = rangeCloses(s, data, range);
      const pct = startClose === 0 ? 0 : (endClose - startClose) / startClose;
      const dollars = shares * (endClose - startClose);
      const points = endClose - startClose;
      const mover: RangeMover = {
        ticker: t,
        pct,
        dollars,
        price: endClose,
        points,
        ownerId: u.id,
      };
      userMovers.push(mover);
      allMovers.push(mover);
      startTotal += shares * startClose;
      endTotal += shares * endClose;
    }
    perUser[u.id] = {
      pct: startTotal === 0 ? 0 : (endTotal - startTotal) / startTotal,
      movers: userMovers,
    };
  }

  return {
    range,
    startDate,
    endDate,
    perUser,
    topGainers: [...allMovers].sort((a, b) => b.pct - a.pct).slice(0, 3),
    topLosers: [...allMovers].sort((a, b) => a.pct - b.pct).slice(0, 3),
  };
}

const HOLDING_RANGES: Range[] = ["1D", "1W", "1M", "3M", "1YR", "ALL"];

// Shares of a spin-off child a user holds = parentShares × ratio. Derived
// from the parent (NOT a fresh $100k/N pick), so it's purely additive and
// doesn't dilute the user's other holdings.
export function spinoffChildShares(
  userId: UserId,
  parent: TickerSeries,
  sharesPerParentShare: number
): number {
  return sharesFor(userId, parent) * sharesPerParentShare;
}

// First-class holding rows for the spin-off children a user holds (e.g. HONA
// for HON owners). They appear only once the child is trading (present in
// prices.json with a startClose on its listing day) — no backtracked history,
// value added on top from that day forward, exactly like receiving the
// distribution in a real brokerage account. Cost basis = the received shares
// valued at the child's first close, so the row tracks the child's own return.
function spinoffHoldingRows(userId: UserId, data: PriceData): HoldingRow[] {
  return SPINOFFS.flatMap((so) => {
    if (!USERS[userId].tickers.includes(so.parentTicker)) return [];
    const parent = data.tickers[so.parentTicker];
    const child = data.tickers[so.childTicker];
    if (!parent || !child || child.closes.length === 0) return [];

    const last = child.closes[child.closes.length - 1];
    const currentClose = last.close;
    const shares = spinoffChildShares(userId, parent, so.sharesPerParentShare);
    const divCash = dividendsReceived(child, shares, last.date);
    const currentValue = shares * currentClose + divCash;
    const costBasis = shares * child.startClose;
    const pl = currentValue - costBasis;
    const plPct = costBasis === 0 ? 0 : pl / costBasis;

    const rangeStats = {} as HoldingRow["rangeStats"];
    for (const r of HOLDING_RANGES) {
      const { startClose, endClose } = rangeCloses(child, data, r);
      const pct = startClose === 0 ? 0 : (endClose - startClose) / startClose;
      rangeStats[r] = {
        pct,
        dollars: shares * (endClose - startClose),
        endClose,
      };
    }

    return [
      {
        ticker: so.childTicker,
        name: child.name,
        shares,
        startClose: child.startClose,
        currentClose,
        costBasis,
        currentValue,
        pl,
        plPct,
        rangeStats,
      },
    ];
  });
}

export function buildHoldingRows(
  userId: UserId,
  data: PriceData
): HoldingRow[] {
  const directRows = USERS[userId].tickers.flatMap((t) => {
    const s = data.tickers[t];
    if (!s || s.closes.length === 0) return [];
    const last = s.closes[s.closes.length - 1];
    const currentClose = last.close;
    const shares = sharesFor(userId, s);
    const divCash = dividendsReceived(s, shares, last.date);
    const currentValue = shares * currentClose + divCash;
    const costBasis = shares * s.startClose;
    const pl = currentValue - costBasis;
    const plPct = costBasis === 0 ? 0 : pl / costBasis;

    // Per-range pct + $ delta for the underlying ticker over the range. The
    // intraday range uses prev-day close → latest intraday bar so it tracks
    // the live curve.
    const rangeStats = {} as HoldingRow["rangeStats"];
    for (const r of HOLDING_RANGES) {
      const { startClose, endClose } = rangeCloses(s, data, r);
      const pct = startClose === 0 ? 0 : (endClose - startClose) / startClose;
      rangeStats[r] = {
        pct,
        dollars: shares * (endClose - startClose),
        endClose,
      };
    }

    return [
      {
        ticker: t,
        name: s.name,
        shares,
        startClose: s.startClose,
        currentClose,
        costBasis,
        currentValue,
        pl,
        plPct,
        rangeStats,
      },
    ];
  });
  return [...directRows, ...spinoffHoldingRows(userId, data)];
}

// Per-holding rows for a fund's drill-down page — same HoldingRow shape as a
// player's, but share counts come from the fund's weights
// (shares = $100k × weight / startClose) instead of an equal per-pick split.
// costBasis = the holding's allocated principal (weight × $100k). Missing
// tickers (not yet fetched) are skipped, same as buildHoldingRows.
export function buildFundHoldingRows(fund: Fund, data: PriceData): HoldingRow[] {
  return fund.holdings.flatMap((h) => {
    const s = data.tickers[h.ticker];
    if (!s || s.closes.length === 0) return [];
    const last = s.closes[s.closes.length - 1];
    const currentClose = last.close;
    const shares = fundHoldingShares(fund, h.ticker, s);
    const divCash = dividendsReceived(s, shares, last.date);
    const currentValue = shares * currentClose + divCash;
    const costBasis = shares * s.startClose;
    const pl = currentValue - costBasis;
    const plPct = costBasis === 0 ? 0 : pl / costBasis;

    const rangeStats = {} as HoldingRow["rangeStats"];
    for (const r of HOLDING_RANGES) {
      const { startClose, endClose } = rangeCloses(s, data, r);
      const pct = startClose === 0 ? 0 : (endClose - startClose) / startClose;
      rangeStats[r] = {
        pct,
        dollars: shares * (endClose - startClose),
        endClose,
      };
    }

    return [
      {
        ticker: h.ticker,
        name: s.name,
        shares,
        startClose: s.startClose,
        currentClose,
        costBasis,
        currentValue,
        pl,
        plPct,
        rangeStats,
      },
    ];
  });
}
