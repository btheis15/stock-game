// Yahoo Finance ticker autocomplete — proxy for the Create-Fund modal's
// search field. Returns stocks, ETFs, mutual funds, ADRs — anything Yahoo
// indexes, with the symbol + display name + asset type + exchange so the
// UI can render a clean pickable list.
//
// Edge runtime + 5-min response cache: the same query repeats often (the
// modal debounces input but two users typing "AAPL" hit the same key).
// Vercel's edge cache absorbs the repeat traffic so Yahoo doesn't see
// burst load.

import { NextResponse } from "next/server";
import YahooFinance from "yahoo-finance2";

export const dynamic = "force-dynamic";
// Edge runtime gives us automatic regional caching at the network edge
// without an additional cache layer; the runtime is still Node-compatible
// for yahoo-finance2's fetch usage.
export const runtime = "nodejs";
// Tell Vercel's edge / CDN to cache responses for 5 minutes — same query
// repeats often (the modal debounces typing but two users typing "AAPL"
// hit the same key).
export const revalidate = 300;

interface SearchResult {
  symbol: string;
  name: string;
  /** "EQUITY" | "ETF" | "MUTUALFUND" | "INDEX" | "CURRENCY" | "CRYPTOCURRENCY" — Yahoo's quoteType. */
  type: string;
  /** Exchange code if Yahoo returned one (e.g. "NMS" for NASDAQ, "NYQ" for NYSE). */
  exchange: string | null;
}

const yahoo = new YahooFinance();

const MAX_RESULTS = 12;

export async function GET(req: Request): Promise<Response> {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  if (q.length < 1) {
    return NextResponse.json({ results: [] }, {
      headers: { "Cache-Control": "public, max-age=300, s-maxage=300" },
    });
  }
  try {
    // Yahoo's search returns up to 10 quotes by default; bump to MAX_RESULTS
    // so users searching common terms ("apple", "vanguard") see a useful
    // list. enableFuzzyQuery=true catches typos.
    const raw = await yahoo.search(q, {
      quotesCount: MAX_RESULTS,
      newsCount: 0,
      enableFuzzyQuery: true,
    });
    const results: SearchResult[] = [];
    for (const r of raw.quotes ?? []) {
      // Filter out the non-tradeable / non-financial entries Yahoo
      // occasionally returns (Crunchbase company profiles, etc.). We need
      // a real symbol to fetch price history for.
      if (!("symbol" in r) || !r.symbol) continue;
      const symbol = String(r.symbol).toUpperCase();
      // Yahoo returns various name fields depending on the entity type.
      // Prefer longname (full company name), fall back to shortname.
      let name: string = symbol;
      if ("longname" in r && typeof r.longname === "string" && r.longname.trim()) {
        name = r.longname;
      } else if ("shortname" in r && typeof r.shortname === "string" && r.shortname.trim()) {
        name = r.shortname;
      }
      let type: string = "UNKNOWN";
      if ("quoteType" in r && typeof r.quoteType === "string" && r.quoteType.trim()) {
        type = r.quoteType;
      }
      let exchange: string | null = null;
      if ("exchange" in r && typeof r.exchange === "string" && r.exchange.trim()) {
        exchange = r.exchange;
      }
      // Skip currencies + crypto pairs since the game tracks equities; users
      // can still pick them via the bundled-ticker entry path if needed.
      if (type === "CURRENCY" || type === "CRYPTOCURRENCY" || type === "FUTURE") {
        continue;
      }
      results.push({ symbol, name, type, exchange });
    }
    return NextResponse.json(
      { results },
      {
        headers: { "Cache-Control": "public, max-age=300, s-maxage=300" },
      }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json(
      { results: [], error: msg },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }
}
