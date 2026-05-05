import { StocksListView } from "@/components/StocksListView";
import { loadPriceData } from "@/lib/data";
import { ALL_TICKERS } from "@/lib/picks";

export const dynamic = "force-static";

export default async function Page() {
  const data = await loadPriceData();
  const series = ALL_TICKERS.map((t) => data.tickers[t]);
  return <StocksListView series={series} />;
}
