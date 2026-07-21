// Roster / player / ticker constants. Sourced from `config/roster.json` so
// that:
//   1. There's a single source of truth shared with `scripts/digest.swift`
//      (which reads the same JSON at startup).
//   2. The roster can be edited from anywhere — GitHub web UI, phone,
//      laptop — without touching the Mac mini. The mini's 15-min
//      `git pull` picks up the change, the next price-refresh fetches
//      historical bars for any newly-added tickers, and the next daily
//      digest run regenerates portfolio + game digests against the new
//      roster.
//
// Type-narrowing note: TypeScript can't preserve string-literal types
// across a JSON import (no `as const` on JSON modules), so `UserId` is
// `string` instead of the previous `"brian" | "kevin" | ...` literal
// union. Callers that use `userId: UserId` and index `USERS[userId]`
// continue to work; the runtime contract is unchanged.
import rosterData from "@/config/roster.json";
import { SPINOFFS } from "./events";

export type UserId = string;

export interface User {
  id: UserId;
  name: string;
  color: string;
  colorRgb: string;
  /** Display-P3 accent (CSS Color 4 string) — richer than `color` on
   *  wide-gamut screens. Optional; pick at runtime via lib/color.ts
   *  `accentFor` so non-P3 displays fall back to the sRGB hex. */
  colorP3?: string;
  tickers: string[];
}

export interface Baseline {
  id: string;
  name: string;
  color: string;
  colorRgb: string;
  ticker: string;
}

interface RawUser {
  id: string;
  name: string;
  color: string;
  color_rgb: string;
  color_p3?: string;
  tickers: string[];
}

interface RawRoster {
  start_date: string;
  starting_dollars: number;
  baseline: {
    id: string;
    name: string;
    color: string;
    color_rgb: string;
    ticker: string;
  };
  users: RawUser[];
  ticker_names: Record<string, string>;
}

const raw = rosterData as unknown as RawRoster;

export const START_DATE = raw.start_date;
export const STARTING_PORTFOLIO_DOLLARS = raw.starting_dollars;

function toUser(u: RawUser): User {
  return {
    id: u.id,
    name: u.name,
    color: u.color,
    colorRgb: u.color_rgb,
    colorP3: u.color_p3,
    tickers: u.tickers,
  };
}

export const USER_LIST: User[] = raw.users.map(toUser);

export const USERS: Record<UserId, User> = (() => {
  const m: Record<UserId, User> = {};
  for (const u of USER_LIST) m[u.id] = u;
  return m;
})();

export function perHoldingDollars(userId: UserId): number {
  const u = USERS[userId];
  return STARTING_PORTFOLIO_DOLLARS / u.tickers.length;
}

export const TICKER_OWNERS: Record<string, UserId[]> = (() => {
  const out: Record<string, UserId[]> = {};
  for (const u of USER_LIST) {
    for (const t of u.tickers) {
      if (!out[t]) out[t] = [];
      out[t].push(u.id);
    }
  }
  // Spin-off children are owned by whoever owns the parent (e.g. HONA is held
  // by every HON holder). They're deliberately NOT in any user's `tickers`
  // array — that would change `perHoldingDollars` ($100k / N) and dilute the
  // user's other picks. The position is derived from the parent instead (see
  // `buildHoldingRows` + `spinoffChildShares` in lib/portfolio.ts), so it
  // surfaces as a first-class holding/stock that's purely additive from the
  // spin-off's effective date forward.
  for (const so of SPINOFFS) {
    const parentOwners = out[so.parentTicker];
    if (parentOwners?.length) out[so.childTicker] = [...parentOwners];
  }
  return out;
})();

// Spin-off child tickers (e.g. HONA). Used by the /stocks list and
// /stock/[ticker] params to surface them as first-class detail pages, kept
// separate from ALL_TICKERS (player picks) so the digest + game-facts
// pipeline, which iterate ALL_TICKERS, are unaffected.
export const SPINOFF_CHILD_TICKERS: string[] = SPINOFFS.map((s) => s.childTicker);

export const ALL_TICKERS: string[] = [
  ...new Set(USER_LIST.flatMap((u) => u.tickers)),
];

// S&P 500 baseline. Compare-page leaderboard treats this as a "player" for
// ranking purposes (its $100k-in-SPY-since-START_DATE curve competes
// head-to-head) but it has no portfolio drill-down page, no digest entries,
// no stock detail, and never appears as a TICKER_OWNERS entry. SPY is the
// implementation vehicle (an actual ETF with dividends, so the comparison
// reflects total return); we surface it to users as "S&P 500".
export const BASELINE: Baseline = {
  id: raw.baseline.id,
  name: raw.baseline.name,
  color: raw.baseline.color,
  colorRgb: raw.baseline.color_rgb,
  ticker: raw.baseline.ticker,
};

export const TICKER_NAMES: Record<string, string> = raw.ticker_names;
