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
import { ALL_TICKERS, START_DATE, TICKER_NAMES } from "../lib/picks";
import { getSpinoffTickers, SPINOFFS } from "../lib/events";
import type {
  DailyClose,
  DividendEvent,
  IntradayBar,
  PriceData,
  TickerSeries,
} from "../lib/types";

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

function planFor(ticker: string, existing: PriceData | null, anchorDate: string): FetchPlan {
  const prev = existing?.tickers[ticker] ?? null;
  if (!prev || prev.closes.length === 0) {
    const p1 = new Date(anchorDate + "T00:00:00Z");
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
    events: "div",
  });

  const fresh = (result.quotes ?? [])
    .filter((q) => q.close != null && q.date != null)
    .map<DailyClose>((q) => ({
      date: fmtDate(new Date(q.date as Date)),
      close: q.close as number,
    }))
    .filter((c) => c.date >= START_DATE);

  const freshDivs: DividendEvent[] = (result.events?.dividends ?? [])
    .map((d) => ({
      date: fmtDate(new Date(d.date as Date)),
      amount: d.amount as number,
    }))
    .filter((d) => d.date >= START_DATE);

  let merged: DailyClose[];
  let startClose: number;

  if (plan.prevSeries) {
    const map = new Map<string, number>();
    for (const c of plan.prevSeries.closes) map.set(c.date, c.close);
    for (const c of fresh) map.set(c.date, c.close);
    merged = [...map.entries()]
      .map(([date, close]) => ({ date, close }))
      .sort((a, b) => a.date.localeCompare(b.date));
    startClose = plan.prevSeries.startClose;
  } else {
    if (fresh.length === 0)
      throw new Error(`No price data on or after ${plan.period1.toISOString().slice(0, 10)} for ${plan.ticker}`);
    merged = fresh;
    startClose = merged[0].close;
  }

  const divMap = new Map<string, number>();
  for (const d of plan.prevSeries?.dividends ?? []) divMap.set(d.date, d.amount);
  for (const d of freshDivs) divMap.set(d.date, d.amount);
  const dividends = [...divMap.entries()]
    .map(([date, amount]) => ({ date, amount }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    ticker: plan.ticker,
    name: TICKER_NAMES[plan.ticker] ?? plan.ticker,
    startClose,
    closes: merged,
    dividends,
  };
}

function isSpinoffChild(ticker: string): boolean {
  return getSpinoffTickers().includes(ticker);
}

function spinoffEffectiveDate(ticker: string): string {
  const so = SPINOFFS.find((s) => s.childTicker === ticker);
  return so ? so.effectiveDate : START_DATE;
}

const INTRADAY_INTERVAL = "15m";
const WEEKLY_INTERVAL = "1h";
const WEEKLY_LOOKBACK_DAYS = 8; // covers a 5-day trading week + weekend buffer

async function fetchIntraday(ticker: string): Promise<IntradayBar[]> {
  // Pull today's intraday 15-min bars. range:'1d' is a Yahoo shortcut that
  // returns the current trading session (or the most recent one if closed).
  try {
    const result = await yahooFinance.chart(ticker, {
      period1: new Date(Date.now() - 26 * 60 * 60 * 1000),
      period2: new Date(Date.now() + 60 * 1000),
      interval: INTRADAY_INTERVAL,
    });
    const quotes = result.quotes ?? [];
    return quotes
      .filter((q) => q.close != null && q.date != null)
      .map<IntradayBar>((q) => ({
        t: new Date(q.date as Date).toISOString(),
        close: q.close as number,
      }));
  } catch {
    return [];
  }
}

async function fetchWeeklyHourly(ticker: string): Promise<IntradayBar[]> {
  // 1-hour bars over the past ~8 days. Used by the 1W view so the chart line
  // has 35–45 points instead of 5–7 daily closes. Yahoo accepts interval=1h
  // for ranges up to 730 days, so this is a normal request.
  try {
    const period1 = new Date(Date.now() - WEEKLY_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const period2 = new Date(Date.now() + 60 * 1000);
    const result = await yahooFinance.chart(ticker, {
      period1,
      period2,
      interval: WEEKLY_INTERVAL,
    });
    const quotes = result.quotes ?? [];
    return quotes
      .filter((q) => q.close != null && q.date != null)
      .map<IntradayBar>((q) => ({
        t: new Date(q.date as Date).toISOString(),
        close: q.close as number,
      }));
  } catch {
    return [];
  }
}

// Filter hourly bars to regular session only (9:30 AM – 4:00 PM ET) for each
// trading day in the input. Drops pre-market, after-hours, and weekend bars
// that Yahoo sometimes returns. Uses the same DST heuristic as
// sessionBoundsET (months 3–10 = EDT, else EST).
function filterToRegularSession(bars: IntradayBar[]): IntradayBar[] {
  return bars.filter((b) => {
    const t = new Date(b.t);
    // ET hour-of-day. The DST shift between EST/EDT is 1 hour; pick the offset
    // by month so we get it right ~99% of the year.
    const month = t.getUTCMonth() + 1;
    const isDST = month >= 3 && month <= 10;
    const offset = isDST ? 4 : 5;
    const etHour = (t.getUTCHours() - offset + 24) % 24;
    const etMin = t.getUTCMinutes();
    const etTime = etHour + etMin / 60;
    // Regular session: 9:30 AM (9.5) ≤ t < 4:00 PM (16.0)
    if (etTime < 9.5 || etTime >= 16) return false;
    // Weekday only (US markets closed Sat/Sun)
    const dow = t.getUTCDay();
    if (dow === 0 || dow === 6) return false;
    return true;
  });
}

function todayInETDate(): string {
  // Approximate "today in Eastern Time" as a YYYY-MM-DD string.
  // Used to mark the intradayDate field; close enough for daily rollover.
  const now = new Date();
  // Convert to ET-ish by shifting -5 hours (good enough for our purposes; we
  // only need to know "did the day roll over from the user's perspective").
  const et = new Date(now.getTime() - 5 * 60 * 60 * 1000);
  return et.toISOString().slice(0, 10);
}

// Returns UTC [open, close] timestamps for the regular US trading session
// (9:30 AM – 4:00 PM ET) on the given ET date. Coarse DST heuristic: months
// 3–10 are EDT (UTC-4), else EST (UTC-5). Wrong on the 4 DST transition days
// per year — harmless for filtering since the boundaries shift by 1 hour, but
// the same bars are kept either way during regular session windows.
function sessionBoundsET(dateStr: string): [Date, Date] {
  const [y, m, d] = dateStr.split("-").map(Number);
  const isDST = m >= 3 && m <= 10;
  const offset = isDST ? 4 : 5;
  const open = new Date(Date.UTC(y, m - 1, d, 9 + offset, 30, 0));
  const close = new Date(Date.UTC(y, m - 1, d, 16 + offset, 0, 0));
  return [open, close];
}

async function main() {
  const existing = loadExisting();
  const mode = existing ? "incremental" : FULL ? "full (forced)" : "full (no prior data)";
  const spinoffChildren = getSpinoffTickers();
  const tickersToFetch = [...ALL_TICKERS, ...spinoffChildren];
  console.log(
    `Fetching prices for ${tickersToFetch.length} tickers — mode: ${mode}` +
      (spinoffChildren.length ? ` (incl. ${spinoffChildren.length} spin-off)` : "")
  );

  const out: Record<string, TickerSeries> = {};
  for (const ticker of tickersToFetch) {
    process.stdout.write(`  ${ticker}... `);
    const anchor = isSpinoffChild(ticker) ? spinoffEffectiveDate(ticker) : START_DATE;
    const plan = planFor(ticker, existing, anchor);
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

  // Fetch today's intraday 15-min bars (best-effort; failures are silent so
  // a single ticker hiccup doesn't kill the whole refresh)
  console.log(`Fetching intraday ${INTRADAY_INTERVAL} bars for today...`);
  for (const ticker of tickersToFetch) {
    process.stdout.write(`  ${ticker}... `);
    const bars = await fetchIntraday(ticker);
    if (bars.length > 0) {
      const todayPrefix = todayInETDate();
      const today = bars.filter((b) => b.t.slice(0, 10) === todayPrefix);
      // Filter to regular session only (9:30 AM – 4:00 PM ET). Drops
      // pre-market and after-hours bars so the chart's last point is the
      // official 4:00 PM close, not an after-hours print.
      const [sessionOpen, sessionClose] = sessionBoundsET(todayPrefix);
      const todayRegular = today.filter((b) => {
        const t = new Date(b.t);
        return t >= sessionOpen && t < sessionClose;
      });
      out[ticker].intraday =
        todayRegular.length > 0
          ? todayRegular
          : today.length > 0
            ? today
            : bars.slice(-26); // fallback: pre-market only, or use last session
      console.log(`${out[ticker].intraday?.length ?? 0} bars`);
    } else {
      console.log("none");
    }
  }

  // Fetch past-week hourly bars (1h interval, ~8 day lookback). Used by the
  // 1W view to give the chart line proper density (~35–45 points instead of
  // 5–7 daily closes).
  console.log(`Fetching weekly ${WEEKLY_INTERVAL} bars for the past ${WEEKLY_LOOKBACK_DAYS} days...`);
  for (const ticker of tickersToFetch) {
    process.stdout.write(`  ${ticker}... `);
    const bars = await fetchWeeklyHourly(ticker);
    if (bars.length > 0) {
      const regular = filterToRegularSession(bars);
      out[ticker].weekly = regular.length > 0 ? regular : bars;
      console.log(`${out[ticker].weekly?.length ?? 0} bars`);
    } else {
      console.log("none");
    }
  }

  const dateSet = new Set<string>();
  for (const s of Object.values(out)) for (const c of s.closes) dateSet.add(c.date);
  const tradingDates = [...dateSet].sort();

  const data: PriceData = {
    startDate: START_DATE,
    generatedAt: new Date().toISOString(),
    intradayDate: todayInETDate(),
    intradayInterval: INTRADAY_INTERVAL,
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
