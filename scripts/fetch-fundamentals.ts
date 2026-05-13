/**
 * Fetches company profile + key statistics + financial statements + earnings
 * history for every pick from Yahoo Finance and writes
 * public/data/fundamentals.json.
 *
 * Refreshes once a day — the values it pulls (market cap, P/E, last quarter's
 * revenue, etc.) don't change intraday and lagging them by ~24 h is fine for
 * the "About / Financials / Earnings" sections on /stock/[ticker].
 *
 * Yahoo coverage is uneven — micro caps, recent IPOs, and ADRs frequently
 * lack some modules. Every field is best-effort: missing data is recorded as
 * null and the UI just hides those rows. A failed quoteSummary call for one
 * ticker doesn't abort the rest; we log and move on.
 *
 * Run:
 *   npx tsx scripts/fetch-fundamentals.ts
 */
import YahooFinance from "yahoo-finance2";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { ALL_TICKERS, TICKER_NAMES } from "../lib/picks";
import type {
  EarningsRow,
  FinancialsRow,
  FundamentalsData,
  TickerFundamentals,
} from "../lib/types";

const yahooFinance = new YahooFinance();
const OUT_FILE = resolve(process.cwd(), "public", "data", "fundamentals.json");

const QUOTE_SUMMARY_MODULES = [
  "assetProfile",
  "summaryDetail",
  "defaultKeyStatistics",
  "incomeStatementHistory",
  "incomeStatementHistoryQuarterly",
  "earningsHistory",
  "price",
] as const;

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (
    v &&
    typeof v === "object" &&
    "raw" in (v as Record<string, unknown>)
  ) {
    const raw = (v as { raw: unknown }).raw;
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  }
  return null;
}

function str(v: unknown): string | null {
  if (typeof v === "string" && v.trim().length > 0) return v.trim();
  return null;
}

function isoDate(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.valueOf())) {
    return v.toISOString().slice(0, 10);
  }
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  if (typeof v === "number" && Number.isFinite(v)) {
    // Yahoo occasionally hands back Unix-seconds for dates inside earningsDate
    const d = new Date(v * 1000);
    if (!Number.isNaN(d.valueOf())) return d.toISOString().slice(0, 10);
  }
  return null;
}

interface RawAddress {
  city?: string;
  state?: string;
  country?: string;
}
function formatHQ(profile: RawAddress | null | undefined): string | null {
  if (!profile) return null;
  const city = str(profile.city);
  const region = str(profile.state) ?? str(profile.country);
  if (city && region) return `${city}, ${region}`;
  return city ?? region;
}

function buildFinancialsRows(
  statements: Array<Record<string, unknown>> | null | undefined
): FinancialsRow[] {
  if (!statements) return [];
  const rows: FinancialsRow[] = [];
  for (const s of statements) {
    const date = isoDate((s as Record<string, unknown>).endDate);
    if (!date) continue;
    const revenue = num((s as Record<string, unknown>).totalRevenue);
    const grossProfit = num((s as Record<string, unknown>).grossProfit);
    const netIncome = num((s as Record<string, unknown>).netIncome);
    const netMargin =
      revenue != null && revenue !== 0 && netIncome != null
        ? netIncome / revenue
        : null;
    rows.push({ date, revenue, grossProfit, netIncome, netMargin });
  }
  // Yahoo returns newest-first; reverse so the chart can render left-to-right.
  return rows.reverse();
}

function buildEarningsRows(
  history: Array<Record<string, unknown>> | null | undefined
): EarningsRow[] {
  if (!history) return [];
  const rows: EarningsRow[] = [];
  for (const e of history) {
    const date =
      isoDate((e as Record<string, unknown>).quarter) ??
      isoDate((e as Record<string, unknown>).endDate);
    if (!date) continue;
    const epsEstimate = num((e as Record<string, unknown>).epsEstimate);
    const epsActual = num((e as Record<string, unknown>).epsActual);
    const surprise =
      epsEstimate != null && epsActual != null
        ? epsActual - epsEstimate
        : null;
    rows.push({ date, epsEstimate, epsActual, surprise });
  }
  // Yahoo returns earningsHistory oldest-first; keep that order for the chart.
  return rows;
}

// Annual earnings = roll up the quarterly EPS into a yearly sum, both for
// estimate and actual. Yahoo's earningsHistory doesn't have a separate annual
// series; the four trailing quarters that share a fiscal-year-end month make
// the annual figures.
function rollupAnnualEarnings(quarterly: EarningsRow[]): EarningsRow[] {
  const byYear = new Map<string, EarningsRow[]>();
  for (const row of quarterly) {
    const year = row.date.slice(0, 4);
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year)!.push(row);
  }
  const out: EarningsRow[] = [];
  for (const [year, rows] of [...byYear.entries()].sort()) {
    if (rows.length < 4) continue;            // skip partial years
    let sumE = 0,
      sumA = 0;
    let hasEvery = true;
    for (const r of rows) {
      if (r.epsEstimate == null || r.epsActual == null) {
        hasEvery = false;
        break;
      }
      sumE += r.epsEstimate;
      sumA += r.epsActual;
    }
    if (!hasEvery) continue;
    out.push({
      date: `${year}-12-31`,
      epsEstimate: sumE,
      epsActual: sumA,
      surprise: sumA - sumE,
    });
  }
  return out;
}

async function fetchOne(ticker: string): Promise<TickerFundamentals | null> {
  try {
    const summary = (await yahooFinance.quoteSummary(ticker, {
      modules: [...QUOTE_SUMMARY_MODULES],
    })) as Record<string, Record<string, unknown> | null | undefined>;

    const profile = summary.assetProfile ?? null;
    const detail = summary.summaryDetail ?? null;
    const keystats = summary.defaultKeyStatistics ?? null;
    const incomeAnnual = summary.incomeStatementHistory ?? null;
    const incomeQuarterly = summary.incomeStatementHistoryQuarterly ?? null;
    const earnings = summary.earningsHistory ?? null;
    const price = summary.price ?? null;

    const fifty2Low = num(detail?.fiftyTwoWeekLow);
    const fifty2High = num(detail?.fiftyTwoWeekHigh);
    const fifty2: [number | null, number | null] | null =
      fifty2Low != null || fifty2High != null ? [fifty2Low, fifty2High] : null;

    const quarterlyEarnings = buildEarningsRows(
      (earnings?.history as Array<Record<string, unknown>>) ?? null
    );

    return {
      ticker,
      name:
        str(price?.longName) ??
        str(price?.shortName) ??
        TICKER_NAMES[ticker] ??
        ticker,
      description: str(profile?.longBusinessSummary),
      sector: str(profile?.sector),
      industry: str(profile?.industry),
      website: str(profile?.website),
      employees: num(profile?.fullTimeEmployees),
      headquarters: formatHQ(profile ?? null),
      marketCap: num(price?.marketCap) ?? num(detail?.marketCap),
      peRatio: num(detail?.trailingPE) ?? num(keystats?.trailingPE),
      forwardPE: num(detail?.forwardPE) ?? num(keystats?.forwardPE),
      eps: num(keystats?.trailingEps),
      dividendYield: num(detail?.dividendYield),
      beta: num(detail?.beta) ?? num(keystats?.beta),
      fiftyTwoWeekRange: fifty2,
      exchange: str(price?.exchangeName) ?? str(price?.fullExchangeName),
      financials: {
        quarterly: buildFinancialsRows(
          (incomeQuarterly?.incomeStatementHistory as Array<
            Record<string, unknown>
          >) ?? null
        ),
        annual: buildFinancialsRows(
          (incomeAnnual?.incomeStatementHistory as Array<
            Record<string, unknown>
          >) ?? null
        ),
      },
      earnings: {
        quarterly: quarterlyEarnings,
        annual: rollupAnnualEarnings(quarterlyEarnings),
      },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`  ! ${ticker}: ${msg.slice(0, 100)}`);
    return null;
  }
}

async function main() {
  console.log(`Fetching fundamentals for ${ALL_TICKERS.length} tickers...`);
  const out: FundamentalsData = {
    generatedAt: new Date().toISOString(),
    tickers: {},
  };
  for (const ticker of ALL_TICKERS) {
    process.stdout.write(`  ${ticker}... `);
    const f = await fetchOne(ticker);
    if (f) {
      out.tickers[ticker] = f;
      const fq = f.financials.quarterly.length;
      const eq = f.earnings.quarterly.length;
      console.log(
        `mcap=${f.marketCap ? `$${(f.marketCap / 1e9).toFixed(1)}B` : "—"}, pe=${
          f.peRatio?.toFixed(1) ?? "—"
        }, fin=${fq}q ${f.financials.annual.length}a, eps=${eq}q ${f.earnings.annual.length}a`
      );
    }
  }
  mkdirSync(dirname(OUT_FILE), { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify(out, null, 2));
  console.log(
    `\nWrote ${OUT_FILE} (${Object.keys(out.tickers).length} tickers)`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
