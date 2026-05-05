/**
 * Fetches daily closing prices for every pick from Yahoo Finance and writes
 * public/data/prices.json.
 *
 * Run modes:
 *   npm run fetch-prices           - incremental: only refetches recent days,
 *                                    merges with existing data. Cheap to run
 *                                    every 5 min / hourly / daily.
 *   npm run fetch-prices -- --full - full refetch from START_DATE for every
 *                                    ticker (use after picks change).
 *
 * The script always re-pulls the trailing 5 trading days to catch any late
 * adjustments Yahoo may publish.
 */
import YahooFinance from "yahoo-finance2";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ALL_TICKERS, PER_HOLDING_DOLLARS, START_DATE, TICKER_NAMES } from "../lib/picks";
import type { DailyClose, PriceData, TickerSeries } from "../lib/types";

const yahooFinance = new YahooFinance();

const FULL = process.argv.includes("--full");
const REFETCH_TRAILING_DAYS = 5;
const OUT_FILE = resolve(process.cwd(), "public", "data", "prices.json");

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function loadExisting(): PriceData | null {
  if (FULL || !existsSync(OUT_FILE)) return null;
  try {
    return JSON.parse(readFileSync(OUT_FILE, "utf8")) as PriceData;
  } catch {
    return null;
  }
}

interface FetchPlan {
  ticker: string;
  period1: Date;
  prevSeries: TickerSeries | null;
}

function planFor(ticker: string, existing: PriceData | null): FetchPlan {
  const prev = existing?.tickers[ticker] ?? null;
  if (!prev || prev.closes.length === 0) {
    const p1 = new Date(START_DATE + "T00:00:00Z");
    p1.setUTCDate(p1.getUTCDate() - 5);
    return { ticker, period1: p1, prevSeries: null };
  }
  const lastDate = prev.closes[prev.closes.length - 1].date;
  const p1 = new Date(lastDate + "T00:00:00Z");
  p1.setUTCDate(p1.getUTCDate() - REFETCH_TRAILING_DAYS);
  return { ticker, period1: p1, prevSeries: prev };
}

async function fetchTicker(plan: FetchPlan): Promise<TickerSeries> {
  const period2 = new Date();
  period2.setUTCDate(period2.getUTCDate() + 1);

  const result = await yahooFinance.chart(plan.ticker, {
    period1: plan.period1,
    period2,
    interval: "1d",
  });

  const fresh = (result.quotes ?? [])
    .filter((q) => q.close != null && q.date != null)
    .map<DailyClose>((q) => ({
      date: fmtDate(new Date(q.date as Date)),
      close: q.close as number,
    }))
    .filter((c) => c.date >= START_DATE);

  let merged: DailyClose[];
  let startClose: number;
  let shares: number;

  if (plan.prevSeries) {
    const map = new Map<string, number>();
    for (const c of plan.prevSeries.closes) map.set(c.date, c.close);
    for (const c of fresh) map.set(c.date, c.close);
    merged = [...map.entries()]
      .map(([date, close]) => ({ date, close }))
      .sort((a, b) => a.date.localeCompare(b.date));
    startClose = plan.prevSeries.startClose;
    shares = plan.prevSeries.shares;
  } else {
    if (fresh.length === 0)
      throw new Error(`No price data on or after ${START_DATE} for ${plan.ticker}`);
    merged = fresh;
    startClose = merged[0].close;
    shares = PER_HOLDING_DOLLARS / startClose;
  }

  return {
    ticker: plan.ticker,
    name: TICKER_NAMES[plan.ticker] ?? plan.ticker,
    startClose,
    shares,
    closes: merged,
  };
}

async function main() {
  const existing = loadExisting();
  const mode = existing ? "incremental" : FULL ? "full (forced)" : "full (no prior data)";
  console.log(`Fetching prices for ${ALL_TICKERS.length} tickers — mode: ${mode}`);

  const out: Record<string, TickerSeries> = {};
  for (const ticker of ALL_TICKERS) {
    process.stdout.write(`  ${ticker}... `);
    const plan = planFor(ticker, existing);
    try {
      const s = await fetchTicker(plan);
      out[ticker] = s;
      const last = s.closes[s.closes.length - 1];
      console.log(`${s.closes.length} days, last=${last.date} @ $${last.close.toFixed(2)}`);
    } catch (err) {
      console.log(`FAIL: ${(err as Error).message}`);
      throw err;
    }
  }

  const dateSet = new Set<string>();
  for (const s of Object.values(out)) for (const c of s.closes) dateSet.add(c.date);
  const tradingDates = [...dateSet].sort();

  const data: PriceData = {
    startDate: START_DATE,
    generatedAt: new Date().toISOString(),
    tickers: out,
    tradingDates,
  };

  const outDir = resolve(process.cwd(), "public", "data");
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify(data));
  console.log(`\nWrote ${OUT_FILE} (${tradingDates.length} trading days, latest ${tradingDates[tradingDates.length - 1]})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
