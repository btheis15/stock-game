import { StocksListView } from "@/components/StocksListView";
import { loadPriceData } from "@/lib/data";
import { activeFundTickers } from "@/lib/funds";
import { spinoffDisplaySeries } from "@/lib/portfolio";
import { ALL_TICKERS, SPINOFF_CHILD_TICKERS } from "@/lib/picks";

// Dynamic (not force-static) because the displayed list now includes
// active-fund holdings, which can change via the funds API without a code
// deploy. Mirrors the same call made on the Compare page.
export const dynamic = "force-dynamic";

export default async function Page() {
  const data = await loadPriceData();
  // Player picks first (in roster order), then any fund-only tickers that no
  // player owns (e.g. the Legacy Auto comparison fund's holdings). De-duped.
  const fundTickers = await activeFundTickers();
  // Spin-off children (e.g. HONA) appear once they're trading; before their
  // listing day they're absent from prices.json and filtered out below.
  const tickers = [
    ...new Set([...ALL_TICKERS, ...SPINOFF_CHILD_TICKERS, ...fundTickers]),
  ];
  // Spin-off parents (HON) show a back-adjusted "since Feb 5" so the list
  // doesn't rank them as a fake ~-50% loser (value distributed to HONA, not a
  // loss). No-op for every other ticker. See spinoffDisplaySeries.
  const series = tickers
    .map((t) => data.tickers[t])
    .filter((s) => s != null)
    .map((s) => spinoffDisplaySeries(s!, data));
  return <StocksListView series={series} />;
}
