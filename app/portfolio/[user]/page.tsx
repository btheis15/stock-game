import { notFound } from "next/navigation";
import { HeaderBack } from "@/components/HeaderBack";
import { PortfolioView } from "@/components/PortfolioView";
import { loadPriceData } from "@/lib/data";
import {
  baselinePortfolioSeries,
  buildHoldingRows,
  intradayBaselineSeries,
  intradayPortfolioSeries,
  portfolioSeries,
  weeklyBaselineSeries,
  weeklyPortfolioSeries,
} from "@/lib/portfolio";
import { USER_LIST, type UserId } from "@/lib/picks";

export function generateStaticParams() {
  return USER_LIST.map((u) => ({ user: u.id }));
}

const VALID_USERS = new Set(USER_LIST.map((u) => u.id as string));

export const dynamic = "force-static";

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
        intradayDate={data.intradayDate ?? data.tradingDates[data.tradingDates.length - 1]}
        generatedAt={data.generatedAt}
        holdings={holdings}
      />
    </>
  );
}
