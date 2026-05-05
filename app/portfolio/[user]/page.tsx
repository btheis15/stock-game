import { notFound } from "next/navigation";
import { HeaderBack } from "@/components/HeaderBack";
import { PortfolioView } from "@/components/PortfolioView";
import { loadPriceData } from "@/lib/data";
import { buildHoldingRows, portfolioSeries } from "@/lib/portfolio";
import { USERS, type UserId } from "@/lib/picks";

export function generateStaticParams() {
  return [{ user: "brian" }, { user: "kevin" }];
}

export const dynamic = "force-static";

export default async function Page({
  params,
}: {
  params: Promise<{ user: string }>;
}) {
  const { user } = await params;
  if (user !== "brian" && user !== "kevin") notFound();
  const userId = user as UserId;
  const data = await loadPriceData();
  const series = portfolioSeries(data, userId);
  const holdings = buildHoldingRows(USERS[userId].tickers, data);
  return (
    <>
      <HeaderBack title="Compare" />
      <PortfolioView userId={userId} series={series} holdings={holdings} />
    </>
  );
}
