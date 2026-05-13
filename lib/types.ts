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

// --- Fundamentals (public/data/fundamentals.json) ---------------------------
// Refreshed once a day by scripts/fetch-fundamentals.ts. Every field is
// optional — Yahoo's coverage varies a lot for small caps, recent IPOs, ADRs,
// etc. The /stock/[ticker] UI hides anything missing rather than blocking the
// section, so partial data is fine.

export interface FinancialsRow {
  /** Period end date, YYYY-MM-DD. */
  date: string;
  revenue: number | null;
  grossProfit: number | null;
  netIncome: number | null;
  /** netIncome / revenue, as a fraction (0.12 = 12%). null when either is missing. */
  netMargin: number | null;
}

export interface EarningsRow {
  /** Period end date for annual, YYYY-MM-DD-or-quarter-label for quarterly. */
  date: string;
  epsEstimate: number | null;
  epsActual: number | null;
  /** epsActual - epsEstimate; null when either is missing. */
  surprise: number | null;
}

export interface TickerFundamentals {
  ticker: string;
  /** Display name. Falls back to picks.ts TICKER_NAMES when Yahoo omits longName. */
  name: string;
  description: string | null;
  sector: string | null;
  industry: string | null;
  website: string | null;
  employees: number | null;
  /** City, State or City, Country. Constructed from address fields. */
  headquarters: string | null;
  /** USD. Null for tickers Yahoo doesn't price (rare). */
  marketCap: number | null;
  /** Trailing twelve months P/E. Null when EPS ≤ 0. */
  peRatio: number | null;
  forwardPE: number | null;
  eps: number | null;
  /** As a fraction. 0.025 = 2.5%. */
  dividendYield: number | null;
  beta: number | null;
  /** [low, high] over the past 52 weeks; both can be null. */
  fiftyTwoWeekRange: [number | null, number | null] | null;
  exchange: string | null;
  financials: {
    quarterly: FinancialsRow[];
    annual: FinancialsRow[];
  };
  earnings: {
    quarterly: EarningsRow[];
    annual: EarningsRow[];
  };
}

export interface FundamentalsData {
  generatedAt: string;
  tickers: Record<string, TickerFundamentals>;
}
