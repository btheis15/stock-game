import { notFound } from "next/navigation";
import { HeaderBack } from "@/components/HeaderBack";
import { PortfolioView, type CompSeries } from "@/components/PortfolioView";
import { loadPriceData } from "@/lib/data";
import { loadActiveFunds } from "@/lib/funds";
import { loadFundamentalsData } from "@/lib/fundamentals-data";
import { buildPortfolioComposition } from "@/lib/portfolio-composition";
import {
  baselinePortfolioSeries,
  buildHoldingRows,
  fundSeries as buildFundSeries,
  intradayBaselineSeries,
  intradayFundSeries,
  intradayPortfolioSeries,
  portfolioSeries,
  weeklyBaselineSeries,
  weeklyFundSeries,
  weeklyPortfolioSeries,
} from "@/lib/portfolio";
import { USER_LIST, type UserId } from "@/lib/picks";
import { combinedPlayersFund } from "@/lib/combined";
import { getThesis } from "@/lib/thesis";

const VALID_USERS = new Set(USER_LIST.map((u) => u.id as string));

// Dynamic (not force-static) because the page now reads active funds from
// config/funds.json to offer them as comparison overlays — a freshly-saved
// fund should appear without waiting for a redeploy. Mirrors app/page.tsx.
export const dynamic = "force-dynamic";

export default async function Page({
  params,
}: {
  params: Promise<{ user: string }>;
}) {
  const { user } = await params;
  if (!VALID_USERS.has(user)) notFound();
  const userId = user as UserId;
  const data = await loadPriceData();
  const series = portfolioSeries(data, userId);
  const intraday = intradayPortfolioSeries(data, userId);
  const weekly = weeklyPortfolioSeries(data, userId);
  const holdings = buildHoldingRows(userId, data);
  // S&P 500 baseline curves so the user can see "am I beating the market over
  // this range?" — scaled inside PortfolioView to share the player's range-
  // start dollar value. Null on any path means the active range falls back
  // to no comparison overlay.
  const baselineDaily = baselinePortfolioSeries(data);
  const baselineIntraday = intradayBaselineSeries(data);
  const baselineWeekly = weeklyBaselineSeries(data);

  // The other players, available as toggle-on comparison overlays. Same three
  // curves the Compare page builds, minus the current player (always shown).
  const players: CompSeries[] = USER_LIST.filter((u) => u.id !== userId).map(
    (u) => ({
      id: u.id,
      name: u.name,
      color: u.color,
      daily: portfolioSeries(data, u.id),
      intraday: intradayPortfolioSeries(data, u.id),
      weekly: weeklyPortfolioSeries(data, u.id),
    })
  );

  // Active funds (incl. the Legacy Auto comparison) plus the synthetic
  // Combined Players fund, same overlay shape.
  const activeFunds = await loadActiveFunds();
  const funds = [combinedPlayersFund(), ...activeFunds].map((f) => ({
    id: f.id,
    name: f.name,
    color: f.color,
    daily: buildFundSeries(data, f),
    intraday: intradayFundSeries(data, f),
    weekly: weeklyFundSeries(data, f),
    pending: f.holdings
      .filter((h) => data.tickers[h.ticker] == null)
      .map((h) => h.ticker),
  }));

  const fundamentals = await loadFundamentalsData();
  const composition = buildPortfolioComposition(userId, holdings, fundamentals);
  const thesis = await getThesis(userId);
  return (
    <>
      <HeaderBack title="Compare" />
      <PortfolioView
        userId={userId}
        series={series}
        intraday={intraday}
        weekly={weekly}
        baselineDaily={baselineDaily.length > 0 ? baselineDaily : null}
        baselineIntraday={baselineIntraday}
        baselineWeekly={baselineWeekly}
        players={players}
        funds={funds}
        intradayDate={data.intradayDate ?? data.tradingDates[data.tradingDates.length - 1]}
        generatedAt={data.generatedAt}
        holdings={holdings}
        composition={composition}
        thesis={thesis}
      />
    </>
  );
}
