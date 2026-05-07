import type { UserId } from "./picks";

export type Range = "1D" | "1W" | "1M" | "3M" | "1YR" | "ALL";

export interface DailyClose {
  date: string;
  close: number;
}

export interface IntradayBar {
  // ISO timestamp in UTC for the bar's start
  t: string;
  close: number;
}

export interface DividendEvent {
  date: string;
  amount: number;
}

export interface TickerSeries {
  ticker: string;
  name: string;
  startClose: number;
  closes: DailyClose[];
  dividends?: DividendEvent[];
  intraday?: IntradayBar[];
  /**
   * 1-hour bars covering roughly the past 7–8 trading days (regular session only).
   * Used by the 1W chart so the line has 35–45 hourly points instead of just 5–7
   * daily closes. Distinct from `intraday` (15-min bars for today only).
   */
  weekly?: IntradayBar[];
}

export interface PriceData {
  startDate: string;
  generatedAt: string;
  intradayDate?: string;
  intradayInterval?: string;
  tickers: Record<string, TickerSeries>;
  tradingDates: string[];
}

export interface PortfolioPoint {
  date: string;
  value: number;
}

export interface ScrubPoint {
  date: string;
  value: number;
  index: number;
}

export interface HoldingRangeStat {
  pct: number;
  dollars: number;
  endClose: number;
}

export interface HoldingRow {
  ticker: string;
  shares: number;
  startClose: number;
  currentClose: number;
  costBasis: number;
  currentValue: number;
  pl: number;
  plPct: number;
  rangeStats: Record<Range, HoldingRangeStat>;
}

export interface RangeMover {
  ticker: string;
  pct: number;
  /** Holding-level $ delta = shares × (endClose − startClose). */
  dollars: number;
  /** Per-share end-of-range close (i.e., the stock's price at range end). */
  price: number;
  /** Per-share $ delta = endClose − startClose ("points" up/down). */
  points: number;
  ownerId: UserId;
}

export interface RangeAnalysis {
  range: Range;
  startDate: string;
  endDate: string;
  perUser: Record<UserId, { pct: number; movers: RangeMover[] }>;
  topGainers: RangeMover[];
  topLosers: RangeMover[];
}
