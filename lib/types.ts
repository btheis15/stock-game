import type { UserId } from "./picks";

export type Range = "1W" | "1M" | "3M" | "1YR" | "ALL";

export interface DailyClose {
  date: string;
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
