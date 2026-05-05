import type {
  HoldingRow,
  PortfolioPoint,
  PriceData,
  Range,
  RangeAnalysis,
  RangeMover,
  TickerSeries,
} from "./types";
import { PER_HOLDING_DOLLARS, USERS, type UserId } from "./picks";
import { SPINOFFS } from "./events";

export const STARTING_PORTFOLIO_VALUE = PER_HOLDING_DOLLARS * 10;

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
  const seriesByTicker = tickers.map((t) => data.tickers[t]);
  const userSpinoffs = SPINOFFS.filter((s) =>
    USERS[userId].tickers.includes(s.parentTicker)
  );

  return data.tradingDates.map((date) => {
    let total = 0;
    for (const s of seriesByTicker) {
      total += s.shares * lastKnownClose(s, date);
      total += dividendsReceived(s, s.shares, date);
    }
    for (const so of userSpinoffs) {
      if (so.effectiveDate > date) continue;
      const parent = data.tickers[so.parentTicker];
      const child = data.tickers[so.childTicker];
      if (!parent || !child) continue;
      const childShares = parent.shares * so.sharesPerParentShare;
      total += childShares * lastKnownClose(child, date);
      total += dividendsReceived(child, childShares, date);
    }
    return { date, value: total };
  });
}

export function tickerSeriesPortfolio(data: PriceData, ticker: string): PortfolioPoint[] {
  const s = data.tickers[ticker];
  return data.tradingDates.map((date) => ({
    date,
    value: s.shares * lastKnownClose(s, date),
  }));
}

export const RANGE_DAYS: Record<Range, number | "all"> = {
  "1W": 7,
  "1M": 30,
  "3M": 90,
  "1YR": 365,
  ALL: "all",
};

export function filterRange<T extends { date: string }>(points: T[], range: Range): T[] {
  if (range === "ALL" || points.length === 0) return points;
  const days = RANGE_DAYS[range] as number;
  const last = new Date(points[points.length - 1].date + "T00:00:00Z");
  const cutoff = new Date(last);
  cutoff.setUTCDate(cutoff.getUTCDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const idx = points.findIndex((p) => p.date >= cutoffStr);
  return idx <= 0 ? points : points.slice(idx);
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

export function rangeBounds(
  tradingDates: string[],
  range: Range
): { startDate: string; endDate: string } {
  if (tradingDates.length === 0) return { startDate: "", endDate: "" };
  const endDate = tradingDates[tradingDates.length - 1];
  if (range === "ALL") return { startDate: tradingDates[0], endDate };
  const days = RANGE_DAYS[range] as number;
  const last = new Date(endDate + "T00:00:00Z");
  const cutoff = new Date(last);
  cutoff.setUTCDate(cutoff.getUTCDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const startIdx = tradingDates.findIndex((d) => d >= cutoffStr);
  const startDate = startIdx <= 0 ? tradingDates[0] : tradingDates[startIdx];
  return { startDate, endDate };
}

export function analyzeRange(data: PriceData, range: Range): RangeAnalysis {
  const { startDate, endDate } = rangeBounds(data.tradingDates, range);

  const movers: RangeMover[] = [];
  for (const userId of ["brian", "kevin"] as const) {
    for (const ticker of USERS[userId].tickers) {
      const s = data.tickers[ticker];
      const startClose = lastKnownClose(s, startDate);
      const endClose = lastKnownClose(s, endDate);
      const pct = startClose === 0 ? 0 : (endClose - startClose) / startClose;
      const dollars = s.shares * (endClose - startClose);
      movers.push({ ticker, pct, dollars, ownerId: userId });
    }
  }

  const brianMovers = movers.filter((m) => m.ownerId === "brian");
  const kevinMovers = movers.filter((m) => m.ownerId === "kevin");

  const portfolioPct = (userMovers: RangeMover[], userId: UserId): number => {
    let startTotal = 0;
    let endTotal = 0;
    for (const t of USERS[userId].tickers) {
      const s = data.tickers[t];
      startTotal += s.shares * lastKnownClose(s, startDate);
      endTotal += s.shares * lastKnownClose(s, endDate);
    }
    return startTotal === 0 ? 0 : (endTotal - startTotal) / startTotal;
  };

  return {
    range,
    startDate,
    endDate,
    brianPct: portfolioPct(brianMovers, "brian"),
    kevinPct: portfolioPct(kevinMovers, "kevin"),
    brianMovers: [...brianMovers].sort((a, b) => b.dollars - a.dollars),
    kevinMovers: [...kevinMovers].sort((a, b) => b.dollars - a.dollars),
    topGainers: [...movers].sort((a, b) => b.pct - a.pct).slice(0, 3),
    topLosers: [...movers].sort((a, b) => a.pct - b.pct).slice(0, 3),
  };
}

export function buildHoldingRows(
  tickers: string[],
  data: PriceData
): HoldingRow[] {
  return tickers.map((t) => {
    const s = data.tickers[t];
    const last = s.closes[s.closes.length - 1];
    const currentClose = last.close;
    const divCash = dividendsReceived(s, s.shares, last.date);
    const currentValue = s.shares * currentClose + divCash;
    const costBasis = s.shares * s.startClose;
    const pl = currentValue - costBasis;
    const plPct = costBasis === 0 ? 0 : pl / costBasis;
    return {
      ticker: t,
      shares: s.shares,
      startClose: s.startClose,
      currentClose,
      costBasis,
      currentValue,
      pl,
      plPct,
    };
  });
}
