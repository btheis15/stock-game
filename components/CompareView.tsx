"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ScrubChart, type ChartSeries, type ScrubState } from "./ScrubChart";
import { RangeTabs } from "./RangeTabs";
import { InsightsCard } from "./InsightsCard";
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
import { USER_LIST, type UserId } from "@/lib/picks";
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
  intradayDate: string;
  generatedAt: string;
  analyses: Record<Range, RangeAnalysis>;
}

export function CompareView({ series, intraday, weekly, intradayDate, generatedAt, analyses }: Props) {
  const [range, setRange] = useState<Range>("1D");
  const [scrub, setScrub] = useState<ScrubState | null>(null);

  const isIntraday = range === "1D";
  // Use the hourly weekly series for 1W when we have it. Falls back to
  // filtered daily closes when no weekly data is present (older snapshots
  // pre-dating the weekly-fetch addition).
  const isWeeklyHourly =
    range === "1W" && USER_LIST.every((u) => weekly[u.id] != null);
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

  const stats = useMemo(() => {
    return USER_LIST.map((u) => {
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
      return { user: u, value, pct, baseline };
    }).sort((a, b) => b.pct - a.pct);
  }, [ranged, scrub, intraday, isIntraday]);

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

  return (
    <div className="pb-24">
      <div className="px-4 pt-2 pb-3">
        <div className="text-[11px] font-bold tracking-[0.12em] uppercase text-zinc-500 mb-1">
          Compare
        </div>
        <h1 className="text-[22px] leading-tight font-semibold text-white">
          {gapPct === 0 ? "It's a tie" : `${leader.user.name} leads`}
        </h1>
        <div
          className="text-[34px] font-semibold tracking-tight mt-1"
          style={{ color: leader.user.color }}
        >
          {fmtPct(gapPct)}
        </div>
        <div className="text-[14px] font-medium text-zinc-400 mt-0.5">
          {fmtSignedUSD(gapDollars)} gap
          {scrubLabel && <span className="text-zinc-500"> • {scrubLabel}</span>}
        </div>
      </div>

      {isIntraday && <MarketStateBadge live={live} generatedAt={generatedAt} />}

      <ScrubChart
        series={chartSeries}
        onScrub={setScrub}
        height={280}
        xDomain={xDomain}
        liveEndpoint={live}
        baseline={0}
      />

      <RangeTabs value={range} onChange={setRange} accent={leader.user.color} />

      <div className="px-4 mt-2 grid grid-cols-2 gap-3">
        {stats.map((s, i) => (
          <UserCard
            key={s.user.id}
            name={s.user.name}
            color={s.user.color}
            value={s.value}
            pct={s.pct}
            href={`/portfolio/${s.user.id}`}
            place={i + 1}
          />
        ))}
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

function UserCard({
  name,
  color,
  value,
  pct,
  href,
  place,
}: {
  name: string;
  color: string;
  value: number;
  pct: number;
  href: string;
  place: number;
}) {
  const positive = pct >= 0;
  const deltaColor = positive ? "#00C805" : "#FF453A";
  const placeLabel = ["1st", "2nd", "3rd", "4th"][place - 1] ?? `${place}th`;
  return (
    <Link
      href={href}
      className="rounded-2xl bg-zinc-900/70 border border-zinc-800 p-3 flex flex-col gap-1 active:bg-zinc-900 transition-colors"
    >
      <div className="flex items-center gap-1.5">
        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
        <span className="text-[13px] font-semibold text-zinc-300">{name}</span>
        <span
          className="ml-auto text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
          style={
            place === 1
              ? { backgroundColor: color, color: "#000" }
              : { color: "#999", borderColor: "#3f3f46", border: "1px solid #3f3f46" }
          }
        >
          {placeLabel}
        </span>
      </div>
      <div className="text-[17px] font-semibold text-white tabular-nums">
        {fmtUSD(value, 0)}
      </div>
      <div className="text-[12px] font-medium tabular-nums" style={{ color: deltaColor }}>
        {fmtPct(pct)}
      </div>
    </Link>
  );
}
