import { notFound } from "next/navigation";
import { HeaderBack } from "@/components/HeaderBack";
import { StockView } from "@/components/StockView";
import { loadPriceData } from "@/lib/data";
import { loadFundamentalsForTicker } from "@/lib/fundamentals-data";
import { activeFundTickers } from "@/lib/funds";
import { ALL_TICKERS, SPINOFF_CHILD_TICKERS, TICKER_OWNERS } from "@/lib/picks";
import { spinoffForChild } from "@/lib/events";
import { spinoffChildShares } from "@/lib/portfolio";

// Player picks + spin-off children (e.g. HONA) + active-fund holdings (e.g.
// the Legacy Auto comparison fund's Ford / Toyota / Honda, which no player
// owns). StockView already renders a no-owner state, so fund-only tickers get
// a working detail page.
async function browsableTickers(): Promise<string[]> {
  const fundTickers = await activeFundTickers();
  return [
    ...new Set([...ALL_TICKERS, ...SPINOFF_CHILD_TICKERS, ...fundTickers]),
  ];
}

// Rendered per-request like every other data page — this was the last
// build-time consumer of prices.json. Request-time rendering is what lets
// the runtime loaders (lib/data.ts) serve fresh data without a redeploy.
export const dynamic = "force-dynamic";

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

  // Spin-off child (e.g. HONA): each owner's shares are derived from the parent
  // position (parentShares × ratio), not a $100k/N pick, so pass explicit per-
  // owner share counts for the PositionCards.
  const spinoff = spinoffForChild(upper);
  const parent = spinoff ? data.tickers[spinoff.parentTicker] : undefined;
  const ownerShares =
    spinoff && parent
      ? Object.fromEntries(
          (TICKER_OWNERS[upper] ?? []).map((ownerId) => [
            ownerId,
            spinoffChildShares(ownerId, parent, spinoff.sharesPerParentShare),
          ])
        )
      : undefined;

  return (
    <>
      <HeaderBack />
      <StockView
        series={series}
        intradayDate={data.intradayDate ?? data.tradingDates[data.tradingDates.length - 1]}
        generatedAt={data.generatedAt}
        fundamentals={fundamentals}
        ownerShares={ownerShares}
      />
    </>
  );
}
