export type Range = "1W" | "1M" | "3M" | "1YR" | "ALL";

export interface DailyClose {
  date: string;
  close: number;
}

export interface TickerSeries {
  ticker: string;
  name: string;
  startClose: number;
  shares: number;
  closes: DailyClose[];
}

export interface PriceData {
  startDate: string;
  generatedAt: string;
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

export interface HoldingRow {
  ticker: string;
  shares: number;
  startClose: number;
  currentClose: number;
  costBasis: number;
  currentValue: number;
  pl: number;
  plPct: number;
}

export interface RangeMover {
  ticker: string;
  pct: number;
  dollars: number;
  ownerId: "brian" | "kevin";
}

export interface RangeAnalysis {
  range: Range;
  startDate: string;
  endDate: string;
  brianPct: number;
  kevinPct: number;
  brianMovers: RangeMover[];
  kevinMovers: RangeMover[];
  topGainers: RangeMover[];
  topLosers: RangeMover[];
}
