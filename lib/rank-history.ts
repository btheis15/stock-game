import type { PortfolioPoint } from "@/lib/types";
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
