import { notFound } from "next/navigation";
import { HeaderBack } from "@/components/HeaderBack";
import { FundView } from "@/components/FundView";
import type { CompSeries } from "@/components/comparisonOverlays";
import { loadPriceData } from "@/lib/data";
import { loadActiveFunds } from "@/lib/funds";
import {
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
import { USER_LIST } from "@/lib/picks";
import { COMBINED_FUND_ID, combinedPlayersFund } from "@/lib/combined";

// Dynamic because the fund roster lives in config/funds.json and can change
// via the funds API without a code deploy. Mirrors /portfolio/[user].
export const dynamic = "force-dynamic";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await loadPriceData();
  const activeFunds = await loadActiveFunds();
  // The Combined Players fund is synthetic (roster-derived, not in funds.json),
  // so resolve it directly rather than looking it up in the active list.
  const fund =
    id === COMBINED_FUND_ID
      ? combinedPlayersFund()
      : activeFunds.find((f) => f.id === id);
  if (!fund) notFound();

  const series = buildFundSeries(data, fund);
  // intradayFundSeries returns null only when none of the fund's tickers are
  // in the snapshot yet; fall back to a flat previousClose so the 1D view
  // degrades gracefully instead of crashing.
  const intraday = intradayFundSeries(data, fund) ?? {
    points: [],
    previousClose: series[series.length - 1]?.value ?? 0,
  };
  const weekly = weeklyFundSeries(data, fund);
  const holdings = buildFundHoldingRows(fund, data);
  const pending = fund.holdings
    .filter((h) => data.tickers[h.ticker] == null)
    .map((h) => h.ticker);

  const baselineDaily = baselinePortfolioSeries(data);
  const baselineIntraday = intradayBaselineSeries(data);
  const baselineWeekly = weeklyBaselineSeries(data);

  // Comparison overlays: every player, plus the OTHER active funds.
  const players: CompSeries[] = USER_LIST.map((u) => ({
    id: u.id,
    name: u.name,
    color: u.color,
    daily: portfolioSeries(data, u.id),
    intraday: intradayPortfolioSeries(data, u.id),
    weekly: weeklyPortfolioSeries(data, u.id),
  }));
  // Offer the Combined Players fund as an overlay too (unless this IS it).
  const overlayFunds =
    fund.id === COMBINED_FUND_ID ? activeFunds : [combinedPlayersFund(), ...activeFunds];
  const otherFunds: CompSeries[] = overlayFunds
    .filter((f) => f.id !== fund.id)
    .map((f) => ({
      id: f.id,
      name: f.name,
      color: f.color,
      daily: buildFundSeries(data, f),
      intraday: intradayFundSeries(data, f),
      weekly: weeklyFundSeries(data, f),
    }));

  return (
    <>
      <HeaderBack title="Compare" />
      <FundView
        fundId={fund.id}
        name={fund.name}
        color={fund.color}
        creator={fund.creator}
        series={series}
        intraday={intraday}
        weekly={weekly}
        baselineDaily={baselineDaily.length > 0 ? baselineDaily : null}
        baselineIntraday={baselineIntraday}
        baselineWeekly={baselineWeekly}
        players={players}
        funds={otherFunds}
        intradayDate={data.intradayDate ?? data.tradingDates[data.tradingDates.length - 1]}
        generatedAt={data.generatedAt}
        holdings={holdings}
        pending={pending}
      />
    </>
  );
}
