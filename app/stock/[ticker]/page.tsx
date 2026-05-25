import { notFound } from "next/navigation";
import { HeaderBack } from "@/components/HeaderBack";
import { StockView } from "@/components/StockView";
import { loadPriceData } from "@/lib/data";
import { loadFundamentalsForTicker } from "@/lib/fundamentals-data";
import { ALL_TICKERS } from "@/lib/picks";

export function generateStaticParams() {
  return ALL_TICKERS.map((ticker) => ({ ticker }));
}

export const dynamic = "force-static";

export default async function Page({
  params,
}: {
  params: Promise<{ ticker: string }>;
}) {
  const { ticker } = await params;
  const upper = ticker.toUpperCase();
  if (!ALL_TICKERS.includes(upper)) notFound();
  const data = await loadPriceData();
  const series = data.tickers[upper];
  if (!series) notFound();
  // Fundamentals load is best-effort — missing file or missing ticker just
  // hides the About/Financials/Earnings sections in the view.
  const fundamentals = await loadFundamentalsForTicker(upper);
  return (
    <>
      <HeaderBack />
      <StockView
        series={series}
        intradayDate={data.intradayDate ?? data.tradingDates[data.tradingDates.length - 1]}
        generatedAt={data.generatedAt}
        fundamentals={fundamentals}
      />
    </>
  );
}
