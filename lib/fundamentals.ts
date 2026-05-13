// Client-safe formatters only. The server-side loader lives in
// `lib/fundamentals-data.ts` to keep `node:fs` out of the client bundle —
// importing this file is fine from a "use client" component.

// --- Formatters ------------------------------------------------------------

/** Short market-cap label: $4.5B, $300M, $1.2T. */
export function fmtMarketCap(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

/** Short revenue/earnings axis label: $4.5B, $300M, -$15M. */
export function fmtMoneyShort(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(1)}T`;
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(0)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

/** Y-axis ticks for the financials chart — fewer significant digits than fmtMoneyShort. */
export function fmtAxisMoney(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "0";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(0)}T`;
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(0)}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(0)}M`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(0)}K`;
  return `${sign}${abs.toFixed(0)}`;
}

export function fmtPctPoints(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(2)}%`;
}

export function fmtRatio(n: number | null, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

export function fmtEPS(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n < 0 ? `-$${Math.abs(n).toFixed(2)}` : `$${n.toFixed(2)}`;
}

export function fmtCount(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

/**
 * Period label for the x-axis. Picks "Q1 FY26" for quarterlies and "FY26"
 * for annuals — derived from the period-end month.
 *
 * Yahoo uses calendar-year fiscal years for most US tickers, but some have
 * non-calendar fiscal years (e.g. AAPL ends Sep). We approximate with the
 * quarter the period-end date falls in.
 */
export function fmtPeriodLabel(date: string, granularity: "quarterly" | "annual"): {
  primary: string;
  secondary: string;
} {
  // YYYY-MM-DD → year, month
  const year = date.slice(0, 4);
  const month = parseInt(date.slice(5, 7), 10);
  // Heuristic: fiscal year for a period ending Jan = previous calendar year's
  // FY (e.g. Jan 2026 = FY25 Q4 for an Apple-style calendar). For everyone
  // else (most US tickers), period-end month maps to its own calendar year.
  // Robinhood's label format is "Q3 FY25" — match that shape.
  const yy = year.slice(-2);
  if (granularity === "annual") {
    return { primary: `FY${yy}`, secondary: "" };
  }
  // Quarter from month:
  const quarter = Math.ceil(month / 3);
  return { primary: `Q${quarter}`, secondary: `FY${yy}` };
}
