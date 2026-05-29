// User-created comparison funds — loader + share math.
//
// Funds work like players in most ways:
//   - Allocation locked at start_date (shares = $100k × weight / startClose),
//     so any later edit to a holding's weight backtracks naturally.
//   - Curves plot on the same axis as players + the S&P 500 baseline.
//   - The Mac mini fetches history for any new fund ticker on the next 15-min
//     refresh (see scripts/fetch-prices.ts).
//
// What's different from players:
//   - Weights are arbitrary (must sum to 100% ± 0.5 bp), not equal-weight.
//   - Anyone can create / edit / soft-delete via the Compare-page UI; saves
//     go through the server action in app/api/funds/.
//   - AI digests are shorter (1D + 1W only, 2 sentences, no company brief)
//     so a growing fund count doesn't blow up the morning chunked run.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { STARTING_PORTFOLIO_DOLLARS } from "./picks";
import { getGithubFile } from "./github-commit";
import type { Fund, FundHolding, FundsFile } from "./types";

// 7-day window for restoring soft-deleted funds. After this, the entry stays
// in funds.json (cheap, harmless) but the UI hides it permanently.
export const FUND_RESTORE_WINDOW_DAYS = 7;

// Auto-assigned palette so a new fund gets a distinct chart-line color.
// Rotated by fund-creation order; cycles after 12 funds. Picked to be
// visually separate from the existing player palette (greens, blues,
// oranges, purples, pinks, yellow are already used).
export const FUND_COLOR_PALETTE: readonly string[] = [
  "#14B8A6", // teal
  "#F472B6", // pink-300
  "#A78BFA", // violet-400
  "#FB923C", // orange-400
  "#22D3EE", // cyan-400
  "#84CC16", // lime-500
  "#F43F5E", // rose-500
  "#3B82F6", // blue-500
  "#EC4899", // pink-500
  "#10B981", // emerald-500
  "#8B5CF6", // violet-500
  "#EAB308", // yellow-500
] as const;

export function nextFundColor(existingCount: number): string {
  return FUND_COLOR_PALETTE[existingCount % FUND_COLOR_PALETTE.length];
}

/** Active = no deletedAt OR deletedAt is older than the restore window
 *  has elapsed (then we permanently hide). The "OR" branch never matches
 *  because the negation flips it; we just check deletedAt is null. */
export function isFundActive(fund: Fund): boolean {
  return fund.deletedAt === null;
}

/** Within the 7-day archive window (recoverable from the Manage view). */
export function isFundRestorable(fund: Fund, now: Date = new Date()): boolean {
  if (fund.deletedAt === null) return false;
  const deletedAt = new Date(fund.deletedAt);
  const elapsedMs = now.getTime() - deletedAt.getTime();
  return elapsedMs < FUND_RESTORE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}

/** Server-only loader for config/funds.json. Reads from GitHub via the
 *  Contents API when the GITHUB_* env vars are configured (production),
 *  falls back to the filesystem snapshot from the current Vercel deploy
 *  otherwise (dev / unconfigured). The GitHub read is what makes a
 *  freshly-saved fund visible to all users within seconds — before this
 *  change, the page read from the deploy filesystem and a new fund only
 *  appeared after Vercel finished redeploying (~30-60s).
 *
 *  Cache strategy: a short in-process TTL (10s) protects against
 *  burst-rendering hitting GitHub's rate limits during a traffic spike.
 *  After a save, the API route calls invalidateFundsCache() to bust this
 *  instance's cache so the next render fetches fresh. Cross-instance
 *  propagation is bounded by the TTL — at worst, a visitor lands on a
 *  cold instance and sees up-to-10s-stale state. */
const FUNDS_CACHE_TTL_MS = 10_000;
let cached: { data: FundsFile; ts: number } | null = null;

async function fetchFundsFromGithub(): Promise<FundsFile | null> {
  if (!process.env.GITHUB_TOKEN || !process.env.GITHUB_OWNER || !process.env.GITHUB_REPO) {
    return null;
  }
  try {
    const file = await getGithubFile("config/funds.json");
    if (!file) return { funds: [] };
    const parsed = JSON.parse(file.content) as FundsFile;
    return { funds: parsed.funds ?? [] };
  } catch {
    return null;
  }
}

async function fetchFundsFromFilesystem(): Promise<FundsFile> {
  try {
    const file = resolve(process.cwd(), "config", "funds.json");
    const raw = await readFile(file, "utf8");
    const parsed = JSON.parse(raw) as FundsFile;
    return { funds: parsed.funds ?? [] };
  } catch {
    return { funds: [] };
  }
}

export async function loadFundsData(): Promise<FundsFile> {
  if (cached && Date.now() - cached.ts < FUNDS_CACHE_TTL_MS) {
    return cached.data;
  }
  const fromGithub = await fetchFundsFromGithub();
  const data = fromGithub ?? (await fetchFundsFromFilesystem());
  cached = { data, ts: Date.now() };
  return data;
}

/** Reset the in-memory cache. Called from the API routes right after a
 *  successful GitHub commit so this instance picks up the fresh content
 *  on the very next request, not 10s later. Cross-instance, the TTL
 *  bounds visibility lag at the cache window. */
export function invalidateFundsCache(): void {
  cached = null;
}

/** Returns just the funds visible in the main Compare UI — active only.
 *  Use loadFundsData() directly when you also need archived funds (e.g.
 *  the Manage view's Archive tab). */
export async function loadActiveFunds(): Promise<Fund[]> {
  const file = await loadFundsData();
  return file.funds.filter(isFundActive);
}

/** Returns the funds whose tickers should be in fetch-prices' ALL_TICKERS.
 *  Includes funds inside the 7-day restore window so a restore brings back
 *  the price archive too. */
export async function loadFundsForPriceFetching(): Promise<Fund[]> {
  const file = await loadFundsData();
  const now = new Date();
  return file.funds.filter((f) => isFundActive(f) || isFundRestorable(f, now));
}

/** Unique ticker symbols referenced across all not-permanently-deleted funds.
 *  Joined with players' ALL_TICKERS + the baseline ticker in fetch-prices. */
export async function allFundTickers(): Promise<string[]> {
  const funds = await loadFundsForPriceFetching();
  const set = new Set<string>();
  for (const f of funds) for (const h of f.holdings) set.add(h.ticker);
  return [...set];
}

/** Unique tickers held by ACTIVE funds only. Used to make fund holdings
 *  browsable on the Stocks tab / stock detail pages even when no player owns
 *  them (e.g. the Legacy Auto comparison fund's Ford / Toyota / Honda). */
export async function activeFundTickers(): Promise<string[]> {
  const funds = await loadActiveFunds();
  const set = new Set<string>();
  for (const f of funds) for (const h of f.holdings) set.add(h.ticker);
  return [...set];
}

/** Dollars allocated to a single holding at start_date. */
export function dollarsForHolding(h: FundHolding): number {
  return STARTING_PORTFOLIO_DOLLARS * h.weight;
}

/** Validation used by both the API route (before commit) and the validator
 *  script (before push). Throws on first failure with a human-readable
 *  message. Tolerances:
 *    - weights sum to 1.0 ± 0.00005 (0.5 basis points of slack for the
 *      0.001-step UI, which can produce 0.999 / 1.001 from rounding)
 *    - each weight ≥ 0.001 (10 basis points, the min the UI offers)
 *    - tickers are uppercase, 1-10 chars
 */
const TICKER_RE = /^\^?[A-Z][A-Z0-9.\-]{0,9}$/;
const WEIGHT_TOLERANCE = 0.00005;
const MIN_WEIGHT = 0.001;

export function validateFund(fund: Partial<Fund>): asserts fund is Fund {
  if (!fund.id || typeof fund.id !== "string") {
    throw new Error("fund.id must be a non-empty string");
  }
  if (!fund.name || typeof fund.name !== "string" || !fund.name.trim()) {
    throw new Error("fund.name must be a non-empty string");
  }
  if (!fund.color || !/^#[0-9A-Fa-f]{6}$/.test(fund.color)) {
    throw new Error(`fund.color ${fund.color} must be a #RRGGBB hex code`);
  }
  if (!fund.createdAt || isNaN(Date.parse(fund.createdAt))) {
    throw new Error("fund.createdAt must be a valid ISO timestamp");
  }
  if (!fund.updatedAt || isNaN(Date.parse(fund.updatedAt))) {
    throw new Error("fund.updatedAt must be a valid ISO timestamp");
  }
  if (fund.deletedAt !== null && fund.deletedAt !== undefined) {
    if (isNaN(Date.parse(fund.deletedAt))) {
      throw new Error("fund.deletedAt must be null or a valid ISO timestamp");
    }
  }
  if (!Array.isArray(fund.holdings) || fund.holdings.length === 0) {
    throw new Error("fund.holdings must be a non-empty array");
  }
  const seenTickers = new Set<string>();
  let weightSum = 0;
  for (const h of fund.holdings) {
    if (!h.ticker || !TICKER_RE.test(h.ticker)) {
      throw new Error(`fund.holdings ticker "${h.ticker ?? "(missing)"}" must be an uppercase symbol`);
    }
    if (seenTickers.has(h.ticker)) {
      throw new Error(`fund.holdings contains duplicate ticker ${h.ticker}`);
    }
    seenTickers.add(h.ticker);
    if (typeof h.weight !== "number" || isNaN(h.weight) || h.weight < MIN_WEIGHT || h.weight > 1) {
      throw new Error(`fund.holdings weight ${h.weight} must be in [${MIN_WEIGHT}, 1]`);
    }
    weightSum += h.weight;
  }
  if (Math.abs(weightSum - 1) > WEIGHT_TOLERANCE) {
    throw new Error(
      `fund.holdings weights must sum to 1.0 (got ${weightSum.toFixed(6)}, off by ${((weightSum - 1) * 10000).toFixed(1)} bp)`
    );
  }
}

/** Generate a URL-safe fund id from the name + a 5-char random suffix.
 *  The suffix prevents collisions across creators picking the same name. */
export function generateFundId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const suffix = Math.random().toString(36).slice(2, 7);
  return slug ? `${slug}-${suffix}` : `fund-${suffix}`;
}
