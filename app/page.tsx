import { CompareView } from "@/components/CompareView";
import { loadPriceData } from "@/lib/data";
import { analyzeRange, portfolioSeries } from "@/lib/portfolio";
import type { Range, RangeAnalysis } from "@/lib/types";

export const dynamic = "force-static";

const ALL_RANGES: Range[] = ["1W", "1M", "3M", "1YR", "ALL"];

export default async function Page() {
  const data = await loadPriceData();
  const brian = portfolioSeries(data, "brian");
  const kevin = portfolioSeries(data, "kevin");
  const analyses = Object.fromEntries(
    ALL_RANGES.map((r) => [r, analyzeRange(data, r)])
  ) as Record<Range, RangeAnalysis>;
  return <CompareView brian={brian} kevin={kevin} analyses={analyses} />;
}
