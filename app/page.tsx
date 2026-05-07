import { CompareView } from "@/components/CompareView";
import { loadPriceData } from "@/lib/data";
import {
  analyzeRange,
  intradayPortfolioSeries,
  portfolioSeries,
  weeklyPortfolioSeries,
} from "@/lib/portfolio";
import type { PortfolioPoint, Range, RangeAnalysis } from "@/lib/types";
import { USER_LIST, type UserId } from "@/lib/picks";

export const dynamic = "force-static";

const ALL_RANGES: Range[] = ["1D", "1W", "1M", "3M", "1YR", "ALL"];

export default async function Page() {
  const data = await loadPriceData();
  const series = Object.fromEntries(
    USER_LIST.map((u) => [u.id, portfolioSeries(data, u.id)])
  ) as Record<UserId, PortfolioPoint[]>;
  const intraday = Object.fromEntries(
    USER_LIST.map((u) => [u.id, intradayPortfolioSeries(data, u.id)])
  ) as Record<UserId, { points: PortfolioPoint[]; previousClose: number }>;
  // Past-week hourly bars (null per user if no weekly data was fetched yet).
  // CompareView falls back to filtered daily closes for 1W when null.
  const weekly = Object.fromEntries(
    USER_LIST.map((u) => [u.id, weeklyPortfolioSeries(data, u.id)])
  ) as Record<UserId, PortfolioPoint[] | null>;
  const analyses = Object.fromEntries(
    ALL_RANGES.map((r) => [r, analyzeRange(data, r)])
  ) as Record<Range, RangeAnalysis>;
  return (
    <CompareView
      series={series}
      intraday={intraday}
      weekly={weekly}
      intradayDate={data.intradayDate ?? data.tradingDates[data.tradingDates.length - 1]}
      generatedAt={data.generatedAt}
      analyses={analyses}
    />
  );
}
