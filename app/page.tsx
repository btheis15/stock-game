import { CompareView } from "@/components/CompareView";
import { loadPriceData } from "@/lib/data";
import { loadFundsData } from "@/lib/funds";
import { loadFundamentalsData } from "@/lib/fundamentals-data";
import { combinedPlayersFund } from "@/lib/combined";
import { buildCombinedComposition } from "@/lib/portfolio-composition";
import {
  analyzeRange,
  baselinePortfolioSeries,
  buildFundHoldingRows,
  fundSeries as buildFundSeries,
  intradayBaselineSeries,
  intradayFundSeries,
  intradayPortfolioSeries,
  portfolioSeries,
  weeklyBaselineSeries,
  weeklyFundSeries,
  weeklyPortfolioSeries,
} from "@/lib/portfolio";
import type { PortfolioPoint, Range, RangeAnalysis } from "@/lib/types";
import { USER_LIST, type UserId } from "@/lib/picks";

// Switched from force-static to force-dynamic now that the page reads
// config/funds.json. A build-time prerender would otherwise capture a
// stale snapshot of the funds file, and a freshly-saved fund wouldn't
// appear until the next deploy. revalidatePath('/','layout') in the
// funds CRUD routes still busts the per-request cache, so the surface
// area of the change is small — every Compare page render reads fresh
// price + funds data.
export const dynamic = "force-dynamic";

const ALL_RANGES: Range[] = ["1D", "1W", "1M", "3M", "1YR", "ALL"];

export default async function Page() {
  const data = await loadPriceData();
  const fundsFile = await loadFundsData();
  const fundamentals = await loadFundamentalsData();
  // Active + soft-deleted-within-restore-window funds, plus the synthetic
  // Combined Players fund (roster-derived; pools every player's picks into one
  // equal-weight $100k book). The Compare view filters to active only — the
  // combined fund is active + default-off, so it appears as an opt-in chip /
  // chart line / leaderboard row. The Manage sheet reads the same array but
  // hides synthetic funds (nothing to edit or archive).
  const combinedFund = combinedPlayersFund();
  const allKnownFunds = [combinedFund, ...fundsFile.funds];

  // Sector / industry / market-cap breakdown of the pooled combined fund +
  // its game-wide "About" narrative, rendered at the bottom of Compare —
  // same lens as the per-account Portfolio breakdown.
  const combinedComposition = buildCombinedComposition(
    buildFundHoldingRows(combinedFund, data),
    fundamentals
  );

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

  // Per-fund curves. fetch-prices.ts unions fund tickers into ALL_TICKERS so
  // prices.json should already have what we need. In the window between
  // creating a fund with a brand-new ticker and the next cron tick backfilling
  // its history, that holding has no prices yet — the series builders hold it
  // flat at its allocated principal (weight × $100k) so the fund still totals
  // the full $100k instead of showing only the fetched holdings' value.
  const fundSeriesMap: Record<string, PortfolioPoint[]> = {};
  const fundIntradayMap: Record<string, { points: PortfolioPoint[]; previousClose: number } | null> = {};
  const fundWeeklyMap: Record<string, PortfolioPoint[] | null> = {};
  // Per-fund list of holding tickers not in the snapshot yet. While non-empty,
  // those holdings are valued flat at their allocated principal (see
  // unfetchedHoldingDollars in lib/portfolio.ts) and the fund's live gain/loss
  // is partial — CompareView surfaces a "updates next refresh" note so the
  // user isn't confused by an off-looking number.
  const fundPending: Record<string, string[]> = {};
  for (const f of allKnownFunds) {
    fundSeriesMap[f.id] = buildFundSeries(data, f);
    fundIntradayMap[f.id] = intradayFundSeries(data, f);
    fundWeeklyMap[f.id] = weeklyFundSeries(data, f);
    fundPending[f.id] = f.holdings
      .filter((h) => data.tickers[h.ticker] == null)
      .map((h) => h.ticker);
  }

  return (
    <CompareView
      series={series}
      intraday={intraday}
      weekly={weekly}
      baselineDaily={baselineDaily.length > 0 ? baselineDaily : null}
      baselineIntraday={baselineIntraday}
      baselineWeekly={baselineWeekly}
      funds={allKnownFunds}
      fundSeries={fundSeriesMap}
      fundIntraday={fundIntradayMap}
      fundWeekly={fundWeeklyMap}
      fundPending={fundPending}
      intradayDate={data.intradayDate ?? data.tradingDates[data.tradingDates.length - 1]}
      generatedAt={data.generatedAt}
      analyses={analyses}
      combinedComposition={combinedComposition}
    />
  );
}
