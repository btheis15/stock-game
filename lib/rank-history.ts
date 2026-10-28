import type { PortfolioPoint, Range } from "@/lib/types";
import { filterRange } from "@/lib/portfolio";
import type { UserId } from "@/lib/picks";

/**
 * Who-led-when, computed from the players' daily portfolio series (every
 * player starts at the same $100k, so ranking by raw value == ranking by
 * return). Pure derivation — no storage; recomputed per load and memoized
 * by the caller. Powers the Lead Tape strip + Records card on Compare.
 */

export interface DayLeader {
  date: string;
  leaderId: UserId;
}

export interface Reign {
  id: UserId;
  days: number;
}

export interface RankHistory {
  /** One entry per trading day, in order. */
  days: DayLeader[];
  /** Total days led, per player who has ever led, descending. */
  totals: Reign[];
  /** Longest consecutive run of days at #1. */
  longestReign: Reign | null;
  /** The run that is still alive as of the latest trading day. */
  currentStreak: Reign | null;
}

export function computeRankHistory(
  series: Record<UserId, PortfolioPoint[]>
): RankHistory {
  const ids = Object.keys(series) as UserId[];
  const first = ids.length > 0 ? series[ids[0]] : [];
  const days: DayLeader[] = [];

  for (let i = 0; i < first.length; i++) {
    let leaderId: UserId | null = null;
    let best = -Infinity;
    for (const id of ids) {
      const v = series[id][i]?.value;
      if (v != null && v > best) {
        best = v;
        leaderId = id;
      }
    }
    if (leaderId != null) days.push({ date: first[i].date, leaderId });
  }

  const totalsMap = new Map<UserId, number>();
  let longestReign: Reign | null = null;
  let run: Reign | null = null;
  for (const d of days) {
    totalsMap.set(d.leaderId, (totalsMap.get(d.leaderId) ?? 0) + 1);
    if (run && run.id === d.leaderId) {
      run = { id: run.id, days: run.days + 1 };
    } else {
      run = { id: d.leaderId, days: 1 };
    }
    if (!longestReign || run.days > longestReign.days) longestReign = run;
  }

  const totals = [...totalsMap.entries()]
    .map(([id, count]) => ({ id, days: count }))
    .sort((a, b) => b.days - a.days);

  return { days, totals, longestReign, currentStreak: run };
}

/**
 * Range % change as of the previous session close, from a daily series.
 * "Previous close" = the last daily point dated strictly before `beforeDate`
 * (the live session's date), so an in-progress or just-finished session never
 * counts. 1D compares that close to the close before it; longer ranges slice
 * the series up to that close with the usual range window. Null when the
 * series is too short (e.g. a fund created today).
 */
export function pctAtPriorClose(
  daily: readonly PortfolioPoint[] | null | undefined,
  beforeDate: string,
  range: Range
): number | null {
  if (!daily || daily.length === 0) return null;
  let end = daily.length - 1;
  while (end >= 0 && beforeDate && daily[end].date >= beforeDate) end--;
  if (end < 0) return null;
  const last = daily[end].value;
  const start =
    range === "1D"
      ? daily[end - 1]?.value
      : filterRange(daily.slice(0, end + 1), range)[0]?.value;
  if (start == null || start === 0) return null;
  return (last - start) / start;
}

/**
 * Places gained since the previous close, per id (positive = moved up,
 * negative = dropped, 0 = unchanged). `current` is the live standings;
 * `prior` holds each id's range pct at the previous close. Ids missing from
 * `prior` are left out of the result (no chip), and ranking is among the ids
 * present in both so a brand-new entry can't shift everyone else.
 */
export function rankChangesSincePriorClose(
  current: readonly { id: string; pct: number }[],
  prior: ReadonlyMap<string, number>
): Map<string, number> {
  const shared = current.filter((e) => prior.has(e.id));
  const nowOrder = [...shared].sort((a, b) => b.pct - a.pct).map((e) => e.id);
  const thenOrder = [...shared]
    .sort((a, b) => prior.get(b.id)! - prior.get(a.id)!)
    .map((e) => e.id);
  const out = new Map<string, number>();
  for (const id of nowOrder) {
    out.set(id, thenOrder.indexOf(id) - nowOrder.indexOf(id));
  }
  return out;
}
