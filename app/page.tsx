import { CompareView } from "@/components/CompareView";
import { loadPriceData } from "@/lib/data";
import { portfolioSeries } from "@/lib/portfolio";

export const dynamic = "force-static";

export default async function Page() {
  const data = await loadPriceData();
  const brian = portfolioSeries(data, "brian");
  const kevin = portfolioSeries(data, "kevin");
  return <CompareView brian={brian} kevin={kevin} />;
}
