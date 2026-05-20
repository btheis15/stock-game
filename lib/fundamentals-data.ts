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
    description:
      "Hut 8 Corp is a vertically integrated operator of large-scale energy infrastructure and one of North America's largest Bitcoin mining companies. It owns and operates power-dense data centers across the US and Canada, and is expanding its footprint into high-performance computing and AI compute services in addition to digital-asset mining.",
    sector: "Financial Services",
    industry: "Capital Markets",
    website: "https://hut8.io",
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
    description:
      "Oklo Inc. designs and plans to commercialize advanced fission power plants based on a compact fast-reactor design. Backed by OpenAI's Sam Altman and headquartered in Santa Clara, the company is targeting next-generation small modular reactors for data center, industrial, and grid applications, with a build-own-operate model for selling clean power on long-term contracts.",
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
