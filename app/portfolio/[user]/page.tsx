import { notFound } from "next/navigation";
import { HeaderBack } from "@/components/HeaderBack";
import { PortfolioView } from "@/components/PortfolioView";
import { loadPriceData } from "@/lib/data";
import { buildHoldingRows, portfolioSeries } from "@/lib/portfolio";
import { USER_LIST, USERS, type UserId } from "@/lib/picks";

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
  const holdings = buildHoldingRows(userId, data);
  return (
    <>
      <HeaderBack title="Compare" />
      <PortfolioView userId={userId} series={series} holdings={holdings} />
    </>
  );
}
