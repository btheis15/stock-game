import "server-only";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { FundamentalsData, TickerFundamentals } from "./types";

// Server-only loader for `public/data/fundamentals.json`. Returns null when
// the file doesn't exist yet (first deploy before scripts/fetch-fundamentals
// has run) so the page can render its other sections without crashing.
//
// Kept separate from `lib/fundamentals.ts` (formatters) so a "use client"
// component can `import { fmtMarketCap } from "@/lib/fundamentals"` without
// dragging `node:fs/promises` into the browser bundle.

// Manual fundamentals for tickers Yahoo's quoteSummary endpoint can't return
// (typically recent IPOs or post-merger renames whose modules error or 404).
// These get *merged into* the loaded data so the rest of the app sees them as
// first-class fundamentals — the donut chart's sector/industry/market-cap
// buckets pick them up, and /stock/{ticker} gets its About card.
//
// Market caps are rough static estimates chosen to land in the right bucket;
// exact figures move daily but the categorical fit (Mid cap vs Large cap)
// is what the UI uses. Update when fetch-fundamentals.ts is re-run on a
// machine that can reach Yahoo successfully and these tickers start
// returning real data — then this table becomes dead code.
const FUNDAMENTALS_OVERRIDES: Record<string, TickerFundamentals> = {
  HUT: {
    ticker: "HUT",
    name: "Hut 8 Corp",
    // Self-described in 2026 SEC filings as "an energy infrastructure platform
    // integrating power, digital infrastructure, and compute at scale to fuel
    // next-generation, energy-intensive technologies such as AI, high-performance
    // computing, and ASIC compute." Operating segments: Power, Digital
    // Infrastructure, Compute, Other. The Bitcoin-miner framing is legacy —
    // the current business is power-dense data centers for AI/HPC compute, with
    // ASIC mining as one workload tenant. Classified here as Technology /
    // Information Technology Services (matches how Simply Wall St catalogs them
    // and what the customer-facing product actually is).
    description:
      "Hut 8 Corp is an energy infrastructure platform integrating power, digital infrastructure, and compute at scale to fuel next-generation, energy-intensive technologies such as AI, high-performance computing, and ASIC compute. The company develops, commercializes, and operates industrial-scale energy and data center infrastructure across the US and Canada through a power-first approach, organized around four segments: Power, Digital Infrastructure, Compute, and Other.",
    sector: "Technology",
    industry: "Information Technology Services",
    website: "https://hut8.com",
    employees: 130,
    headquarters: "Miami, FL",
    marketCap: 3_500_000_000,
    peRatio: null,
    forwardPE: null,
    eps: null,
    dividendYield: null,
    beta: null,
    fiftyTwoWeekRange: null,
    exchange: "NASDAQ",
    financials: { quarterly: [], annual: [] },
    earnings: { quarterly: [], annual: [] },
  },
  OKLO: {
    ticker: "OKLO",
    name: "Oklo Inc.",
    // Verified from 2026 10-Q + company materials: Oklo is a nuclear power
    // company developing the Aurora Powerhouse, a compact sodium-cooled fast
    // reactor (15-75 MWe, modeled after EBR-II, uses metallic HALEU fuel).
    // The company plans to be designer, builder, owner, AND operator of the
    // plants, selling both electricity and radioisotopes — targeting off-grid
    // data centers, remote communities, industrial sites, and military bases.
    // Pre-revenue today, so the sector fit is Industrials / Specialty
    // Industrial Machinery (matches SMR/NuScale's existing classification);
    // once commercial plants are operating, peers might re-classify to
    // Utilities / Independent Power Producers.
    description:
      "Oklo Inc. is a nuclear power company developing the Aurora Powerhouse — a compact sodium-cooled fast reactor designed for 15 to 75 MWe of output, modeled after Experimental Breeder Reactor II and powered by metallic HALEU fuel. Backed by OpenAI's Sam Altman and headquartered in Santa Clara, Oklo plans to be the designer, builder, owner, and operator of its powerhouses, selling electricity and radioisotopes to off-grid data centers, remote communities, industrial sites, and military bases.",
    sector: "Industrials",
    industry: "Specialty Industrial Machinery",
    website: "https://oklo.com",
    employees: 100,
    headquarters: "Santa Clara, CA",
    marketCap: 15_000_000_000,
    peRatio: null,
    forwardPE: null,
    eps: null,
    dividendYield: null,
    beta: null,
    fiftyTwoWeekRange: null,
    exchange: "NYSE",
    financials: { quarterly: [], annual: [] },
    earnings: { quarterly: [], annual: [] },
  },
};

let cached: FundamentalsData | null = null;

export async function loadFundamentalsData(): Promise<FundamentalsData | null> {
  if (cached) return cached;
  try {
    const file = resolve(process.cwd(), "public", "data", "fundamentals.json");
    const raw = await readFile(file, "utf8");
    const parsed = JSON.parse(raw) as FundamentalsData;
    // Patch in overrides for any ticker missing from the fetched snapshot. We
    // never overwrite a real Yahoo entry — overrides are pure fallbacks.
    for (const [t, override] of Object.entries(FUNDAMENTALS_OVERRIDES)) {
      if (!parsed.tickers[t]) parsed.tickers[t] = override;
    }
    cached = parsed;
    return cached;
  } catch {
    return null;
  }
}

export async function loadFundamentalsForTicker(
  ticker: string
): Promise<TickerFundamentals | null> {
  const data = await loadFundamentalsData();
  return data?.tickers[ticker] ?? null;
}
