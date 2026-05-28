import { notFound } from "next/navigation";
import { HeaderBack } from "@/components/HeaderBack";
import { StockView } from "@/components/StockView";
import { loadPriceData } from "@/lib/data";
import { loadFundamentalsForTicker } from "@/lib/fundamentals-data";
import { activeFundTickers } from "@/lib/funds";
import { ALL_TICKERS } from "@/lib/picks";

// Player picks + active-fund holdings (e.g. the Legacy Auto comparison fund's
// Ford / Toyota / Honda, which no player owns). StockView already renders a
// no-owner state, so fund-only tickers get a working detail page.
async function browsableTickers(): Promise<string[]> {
  const fundTickers = await activeFundTickers();
  return [...new Set([...ALL_TICKERS, ...fundTickers])];
}

export async function generateStaticParams() {
  return (await browsableTickers()).map((ticker) => ({ ticker }));
}

export const dynamic = "force-static";

export default async function Page({
  params,
}: {
  params: Promise<{ ticker: string }>;
}) {
  const { ticker } = await params;
  const upper = ticker.toUpperCase();
  if (!(await browsableTickers()).includes(upper)) notFound();
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
