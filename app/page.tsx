import { CompareView } from "@/components/CompareView";
import { loadPriceData } from "@/lib/data";
import {
  analyzeRange,
  baselinePortfolioSeries,
  intradayBaselineSeries,
  intradayPortfolioSeries,
  portfolioSeries,
  weeklyBaselineSeries,
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
  // S&P 500 baseline curves — null on each path if SPY data isn't in the
  // snapshot yet (e.g. first deploy after this feature ships, before the
  // next price-refresh cron tick). CompareView is tolerant of nulls.
  const baselineDaily = baselinePortfolioSeries(data);
  const baselineIntraday = intradayBaselineSeries(data);
  const baselineWeekly = weeklyBaselineSeries(data);
  return (
    <CompareView
      series={series}
      intraday={intraday}
      weekly={weekly}
      baselineDaily={baselineDaily.length > 0 ? baselineDaily : null}
      baselineIntraday={baselineIntraday}
      baselineWeekly={baselineWeekly}
      intradayDate={data.intradayDate ?? data.tradingDates[data.tradingDates.length - 1]}
      generatedAt={data.generatedAt}
      analyses={analyses}
    />
  );
}
