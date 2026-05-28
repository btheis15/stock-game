import { StocksListView } from "@/components/StocksListView";
import { loadPriceData } from "@/lib/data";
import { activeFundTickers } from "@/lib/funds";
import { ALL_TICKERS } from "@/lib/picks";

// Dynamic (not force-static) because the displayed list now includes
// active-fund holdings, which can change via the funds API without a code
// deploy. Mirrors the same call made on the Compare page.
export const dynamic = "force-dynamic";

export default async function Page() {
  const data = await loadPriceData();
  // Player picks first (in roster order), then any fund-only tickers that no
  // player owns (e.g. the Legacy Auto comparison fund's holdings). De-duped.
  const fundTickers = await activeFundTickers();
  const tickers = [...new Set([...ALL_TICKERS, ...fundTickers])];
  const series = tickers.map((t) => data.tickers[t]).filter((s) => s != null);
  return <StocksListView series={series} />;
}
