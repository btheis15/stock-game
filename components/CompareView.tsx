"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ScrubChart, type ChartSeries, type ScrubState } from "./ScrubChart";
import { RangeTabs } from "./RangeTabs";
import { InsightsCard } from "./InsightsCard";
import { DigestPanel } from "./DigestPanel";
import { useDigests } from "@/lib/digests";
import {
  filterRange,
  fmtDateLong,
  fmtPct,
  fmtSignedUSD,
  fmtTimeOfDay,
  fmtUSD,
  sessionBoundsForDate,
} from "@/lib/portfolio";
import type { PortfolioPoint, Range, RangeAnalysis } from "@/lib/types";
import { BASELINE, USER_LIST, type UserId } from "@/lib/picks";
import { MarketStateBadge } from "./MarketStateBadge";

const LIVE_LAG_MS = 30 * 60 * 1000;
function lastPointIsLive(points: { date: string }[]): boolean {
  const last = points[points.length - 1];
  if (!last || last.date.length <= 10) return false;
  return Date.now() - new Date(last.date).getTime() < LIVE_LAG_MS;
}

interface IntradayResult {
  points: PortfolioPoint[];
  previousClose: number;
}

interface Props {
  series: Record<UserId, PortfolioPoint[]>;
  intraday: Record<UserId, IntradayResult>;
  /** Past-week hourly bars per user; null falls back to filtered daily closes. */
  weekly: Record<UserId, PortfolioPoint[] | null>;
  /** S&P 500 (SPY) benchmark curves. Each may be null if SPY data isn't in
   *  the current snapshot yet — the view hides the baseline row + line in
   *  that case rather than blocking the page. */
  baselineDaily: PortfolioPoint[] | null;
  baselineIntraday: IntradayResult | null;
  baselineWeekly: PortfolioPoint[] | null;
  intradayDate: string;
  generatedAt: string;
  analyses: Record<Range, RangeAnalysis>;
}

interface RankedEntry {
  id: string;
  name: string;
  color: string;
  href: string | null;
  value: number;
  pct: number;
  baseline: number;
}

export function CompareView({
  series,
  intraday,
  weekly,
  baselineDaily,
  baselineIntraday,
  baselineWeekly,
  intradayDate,
  generatedAt,
  analyses,
}: Props) {
  const [range, setRange] = useState<Range>("1D");
  const { loading: digestsLoading, getGameDigest } = useDigests();
  const [scrub, setScrub] = useState<ScrubState | null>(null);

  const isIntraday = range === "1D";
  // Whether we have SPY data at all in this snapshot. Drives an extra row in
  // the leaderboard and an extra line on the chart. If the baseline lacks the
  // path the active range needs (e.g. weekly hourly bars), we fall back to its
  // daily-close curve, matching the player-fallback behavior.
  const hasBaseline = baselineDaily != null;
  // Use the hourly weekly series for 1W when we have it. Falls back to
  // filtered daily closes when no weekly data is present (older snapshots
  // pre-dating the weekly-fetch addition). Baseline must also have weekly
  // data to enable the compactX chart — otherwise we'd mix hourly-spaced
  // player lines with a daily-spaced baseline line.
  const isWeeklyHourly =
    range === "1W" &&
    USER_LIST.every((u) => weekly[u.id] != null) &&
    (!hasBaseline || baselineWeekly != null);
  const live = useMemo(
    () => isIntraday && lastPointIsLive(intraday[USER_LIST[0].id].points),
    [isIntraday, intraday]
  );

  const ranged = useMemo(() => {
    const out = {} as Record<UserId, PortfolioPoint[]>;
    if (isIntraday) {
      for (const u of USER_LIST) out[u.id] = intraday[u.id].points;
    } else if (isWeeklyHourly) {
      for (const u of USER_LIST) out[u.id] = weekly[u.id]!;
    } else {
      for (const u of USER_LIST) out[u.id] = filterRange(series[u.id], range);
    }
    return out;
  }, [series, intraday, weekly, range, isIntraday, isWeeklyHourly]);

  // Same shape as `ranged` but for the SPY baseline. null when SPY data isn't
  // available, or when the intraday path is selected and SPY has no intraday
  // bars yet (rare — usually fetched in the same cron run as everyone else).
  const baselineRanged = useMemo<PortfolioPoint[] | null>(() => {
    if (!hasBaseline) return null;
    if (isIntraday) return baselineIntraday?.points ?? null;
    if (isWeeklyHourly) return baselineWeekly;
    return filterRange(baselineDaily!, range);
  }, [hasBaseline, isIntraday, isWeeklyHourly, baselineIntraday, baselineWeekly, baselineDaily, range]);

  const stats = useMemo(() => {
    const entries: RankedEntry[] = USER_LIST.map((u) => {
      const pts = ranged[u.id];
      const baseline = isIntraday ? intraday[u.id].previousClose : pts[0]?.value ?? 0;
      const lastVal = pts[pts.length - 1]?.value ?? baseline;
      // The chart plots % change so scrub.values are pct fractions, not
      // dollar values. Rehydrate by indexing into the underlying $ points.
      const scrubIdx = scrub?.index;
      const scrubDollar =
        scrubIdx != null && pts[scrubIdx] ? pts[scrubIdx].value : undefined;
      const value = scrubDollar ?? lastVal;
      const pct = baseline === 0 ? 0 : (value - baseline) / baseline;
      return {
        id: u.id,
        name: u.name,
        color: u.color,
        href: `/portfolio/${u.id}`,
        value,
        pct,
        baseline,
      };
    });
    if (baselineRanged && baselineRanged.length > 0) {
      const pts = baselineRanged;
      const baseline =
        isIntraday && baselineIntraday
          ? baselineIntraday.previousClose
          : pts[0]?.value ?? 0;
      const lastVal = pts[pts.length - 1]?.value ?? baseline;
      const scrubIdx = scrub?.index;
      const scrubDollar =
        scrubIdx != null && pts[scrubIdx] ? pts[scrubIdx].value : undefined;
      const value = scrubDollar ?? lastVal;
      const pct = baseline === 0 ? 0 : (value - baseline) / baseline;
      entries.push({
        id: BASELINE.id,
        name: BASELINE.name,
        color: BASELINE.color,
        href: null,
        value,
        pct,
        baseline,
      });
    }
    return entries.sort((a, b) => b.pct - a.pct);
  }, [ranged, baselineRanged, scrub, intraday, baselineIntraday, isIntraday]);

  const leader = stats[0];
  const second = stats[1];
  const gapPct = leader.pct - second.pct;
  // Gap in dollars = difference in gain over the active range (not total
  // portfolio diff), so it's consistent with the % comparison.
  const gapDollars =
    (leader.value - leader.baseline) - (second.value - second.baseline);
  const scrubLabel = scrub
    ? scrub.date.length > 10
      ? fmtTimeOfDay(scrub.date)
      : fmtDateLong(scrub.date)
    : null;

  const xDomain = isIntraday ? sessionBoundsForDate(intradayDate) : undefined;

  // Normalize all lines to % change from the range's baseline so the chart
  // visually matches the leaderboard ranking (highest line = 1st place).
  // Without this, lines would plot raw $ at different starting points and a
  // player with a lower portfolio value but higher gain would look "lowest"
  // even though they're winning the range.
  const chartSeries: ChartSeries[] = USER_LIST.map((u) => {
    const pts = ranged[u.id];
    const baseline = isIntraday ? intraday[u.id].previousClose : pts[0]?.value ?? 0;
    return {
      id: u.id,
      color: u.color,
      data: pts.map((p) => ({
        date: p.date,
        value: baseline === 0 ? 0 : (p.value - baseline) / baseline,
      })),
    };
  });
  if (baselineRanged && baselineRanged.length > 0) {
    const pts = baselineRanged;
    const baseline =
      isIntraday && baselineIntraday
        ? baselineIntraday.previousClose
        : pts[0]?.value ?? 0;
    chartSeries.push({
      id: BASELINE.id,
      color: BASELINE.color,
      data: pts.map((p) => ({
        date: p.date,
        value: baseline === 0 ? 0 : (p.value - baseline) / baseline,
      })),
    });
  }

  return (
    <div className="pb-24">
      <div className="px-4 pt-2 pb-3">
        <div className="text-[11px] font-bold tracking-[0.12em] uppercase text-zinc-500 mb-1">
          Compare
        </div>
        <h1 className="text-[22px] leading-tight font-semibold text-white">
          {gapPct === 0 ? "It's a tie" : `${leader.name} leads`}
        </h1>
        <div
          className="text-[34px] font-semibold tracking-tight mt-1"
          style={{ color: leader.color }}
        >
          {fmtPct(gapPct)}
        </div>
        <div className="text-[14px] font-medium text-zinc-400 mt-0.5">
          {fmtSignedUSD(gapDollars)} gap
          {scrubLabel && <span className="text-zinc-500"> • {scrubLabel}</span>}
        </div>
      </div>

      {isIntraday && <MarketStateBadge generatedAt={generatedAt} />}

      <ScrubChart
        series={chartSeries}
        onScrub={setScrub}
        height={280}
        xDomain={xDomain}
        liveEndpoint={live}
        baseline={0}
        compactX={isWeeklyHourly}
      />

      <RangeTabs value={range} onChange={setRange} accent={leader.color} />

      {/* Briefing sits ABOVE the leaderboard now — it's the narrative
          context for what the rankings below show, so reading top-down
          flows chart → range tabs → "what happened" → standings. */}
      <DigestPanel
        digest={getGameDigest(range)}
        loading={digestsLoading}
        range={range}
      />

      <div className="px-4 mt-2">
        <div className="rounded-2xl bg-zinc-900/70 border border-zinc-800 divide-y divide-zinc-800 overflow-hidden">
          {stats.map((s, i) => {
            // Gap = how far behind the leader in $ gain over the active range
            // (not raw portfolio diff — that would mix range performance with
            // permanent wealth, which is misleading when the sort is by range
            // pct). Matches the same definition used by the headline "leads
            // by" number at the top of the page.
            const rangeGain = s.value - s.baseline;
            const leaderGain = leader.value - leader.baseline;
            const gap = i === 0 ? 0 : leaderGain - rangeGain;
            return (
              <UserRow
                key={s.id}
                name={s.name}
                color={s.color}
                value={s.value}
                pct={s.pct}
                gap={gap}
                place={i + 1}
                href={s.href}
              />
            );
          })}
        </div>
      </div>

      <InsightsCard analysis={analyses[range]} />

      <div className="px-4 mt-6">
        <h2 className="text-[15px] font-semibold text-zinc-300 mb-2">Game rules</h2>
        <div className="text-[13px] text-zinc-500 leading-relaxed">
          Each portfolio started with $100,000 split evenly across each player's
          picks at the Feb 5, 2026 close. Partial shares allowed. Updated daily.
        </div>
      </div>
    </div>
  );
}

// Sports-standings style row. Stacks vertically inside the bordered card so
// the leaderboard scales to N players without the 2x2 grid breaking. Each
// row reads at a glance: rank → color dot → name + gap-to-leader (or
// "Leader" on row 1) on the left, current portfolio value + range pct on
// the right. Whole row taps through to /portfolio/{user}.
function UserRow({
  name,
  color,
  value,
  pct,
  gap,
  place,
  href,
}: {
  name: string;
  color: string;
  value: number;
  pct: number;
  gap: number; // $ behind the leader in this range's gain; 0 when place === 1
  place: number;
  // Null for the S&P 500 baseline row — it has no drill-down page so we
  // render a plain div instead of a tappable Link.
  href: string | null;
}) {
  const positive = pct >= 0;
  const deltaColor = positive ? "#00C805" : "#FF453A";
  const isLeader = place === 1;
  const inner = (
    <>
      <div className="w-6 text-center text-[14px] font-semibold text-zinc-500 tabular-nums shrink-0">
        {place}
      </div>
      <div
        className="w-2.5 h-2.5 rounded-full shrink-0"
        style={{ backgroundColor: color }}
      />
      <div className="flex flex-col min-w-0 flex-1">
        <div className="text-[15px] font-semibold text-zinc-200 truncate">
          {name}
        </div>
        <div className="text-[11px] text-zinc-500 tabular-nums mt-0.5">
          {isLeader ? (
            <span
              className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
              style={{ backgroundColor: color, color: "#000" }}
            >
              Leader
            </span>
          ) : (
            <>{fmtUSD(gap, 0)} back</>
          )}
        </div>
      </div>
      <div className="flex flex-col items-end shrink-0">
        <div className="text-[16px] font-semibold text-white tabular-nums">
          {fmtUSD(value, 0)}
        </div>
        <div
          className="text-[12px] font-medium tabular-nums mt-0.5"
          style={{ color: deltaColor }}
        >
          {fmtPct(pct)}
        </div>
      </div>
    </>
  );
  if (href == null) {
    return (
      <div className="flex items-center gap-3 px-3 py-3">{inner}</div>
    );
  }
  return (
    <Link
      href={href}
      className="flex items-center gap-3 px-3 py-3 active:bg-zinc-900/40 transition-colors"
    >
      {inner}
    </Link>
  );
}
