// Yahoo Finance ticker autocomplete — proxy for the Create-Fund modal's
// search field. Returns stocks, ETFs, mutual funds, ADRs — anything Yahoo
// indexes, with symbol + display name + asset type + exchange so the UI
// can render a clean pickable list.
//
// Why a hand-rolled fetch instead of yahoo-finance2:
//   The library bundles a strict response-schema validator that throws
//   ("Failed Yahoo Schema validation") any time Yahoo adds or renames a
//   field — which they do frequently. On the Mac mini that just logs a
//   warning, but inside a Vercel function it surfaces as the 502 that
//   broke every search in the UI on 2026-05-28. Yahoo's autocomplete
//   endpoint itself is stable; the validator was the only thing failing.
//   So we hit the endpoint directly with fetch, parse the shape we care
//   about, and ignore the rest.
//
// Edge-cached 5 min per query so a flurry of keystrokes from the same
// user (or two users typing the same name) doesn't burst-hit Yahoo.

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 300;

interface SearchResult {
  symbol: string;
  name: string;
  /** "EQUITY" | "ETF" | "MUTUALFUND" | "INDEX" | etc. (Yahoo's quoteType). */
  type: string;
  /** Exchange name like "NASDAQ" / "NYSE" / "OTC" when Yahoo provides it. */
  exchange: string | null;
}

// Defensive partial typing — Yahoo adds fields freely so we only model
// what we read. Everything else passes through untouched.
interface YahooQuote {
  symbol?: string;
  shortname?: string;
  longname?: string;
  quoteType?: string;
  exchange?: string;
  exchDisp?: string;
}

interface YahooSearchResponse {
  quotes?: YahooQuote[];
}

const MAX_RESULTS = 12;
// Skip non-equity asset classes that don't make sense in a stock-game
// fund (currency pairs, crypto, futures). Users can still pick ETFs +
// mutual funds + ADRs — those stay in.
const SKIP_TYPES = new Set(["CURRENCY", "CRYPTOCURRENCY", "FUTURE"]);

export async function GET(req: Request): Promise<Response> {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  if (q.length < 1) {
    return NextResponse.json(
      { results: [] },
      { headers: { "Cache-Control": "public, max-age=300, s-maxage=300" } }
    );
  }
  const url =
    `https://query1.finance.yahoo.com/v1/finance/search?` +
    `q=${encodeURIComponent(q)}` +
    `&quotesCount=${MAX_RESULTS}` +
    `&newsCount=0` +
    `&enableFuzzyQuery=true`;
  try {
    const res = await fetch(url, {
      // Yahoo blocks requests with no UA in some regions / from
      // Vercel's IP ranges. A generic browser-like UA reliably passes.
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; StockGameFundSearch/1.0; +https://stock-game-gamma.vercel.app)",
        Accept: "application/json",
      },
      cache: "no-store",
      // 8-second budget: the user's typing already feels slow if we
      // hold the request longer than that, and Yahoo's autocomplete
      // usually responds in 200-400ms.
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return NextResponse.json(
        {
          results: [],
          error: `yahoo finance responded ${res.status}${body ? `: ${body.slice(0, 120)}` : ""}`,
        },
        { status: 502 }
      );
    }
    const body = (await res.json()) as YahooSearchResponse;
    const results: SearchResult[] = [];
    for (const r of body.quotes ?? []) {
      if (!r.symbol) continue;
      const symbol = String(r.symbol).toUpperCase();
      let name = symbol;
      if (typeof r.longname === "string" && r.longname.trim()) name = r.longname;
      else if (typeof r.shortname === "string" && r.shortname.trim()) name = r.shortname;
      const type =
        typeof r.quoteType === "string" && r.quoteType.trim()
          ? r.quoteType
          : "UNKNOWN";
      if (SKIP_TYPES.has(type)) continue;
      // exchDisp ("NASDAQ", "NYSE") reads better than the raw exchange
      // code ("NMS", "NYQ") that the API returns elsewhere.
      let exchange: string | null = null;
      if (typeof r.exchDisp === "string" && r.exchDisp.trim()) {
        exchange = r.exchDisp;
      } else if (typeof r.exchange === "string" && r.exchange.trim()) {
        exchange = r.exchange;
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
    // Includes AbortError (timeout) + network failures. We surface the
    // message in the JSON body so the modal can show it instead of just
    // "(502)" — much faster to diagnose what Yahoo is doing.
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json(
      { results: [], error: msg },
      { status: 502 }
    );
  }
}
