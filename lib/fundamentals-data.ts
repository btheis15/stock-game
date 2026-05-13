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

let cached: FundamentalsData | null = null;

export async function loadFundamentalsData(): Promise<FundamentalsData | null> {
  if (cached) return cached;
  try {
    const file = resolve(process.cwd(), "public", "data", "fundamentals.json");
    const raw = await readFile(file, "utf8");
    cached = JSON.parse(raw) as FundamentalsData;
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
