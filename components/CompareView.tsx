"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ScrubChart, type ChartSeries, type ScrubState } from "./ScrubChart";
import { RangeTabs } from "./RangeTabs";
import { InsightsCard } from "./InsightsCard";
import { fmtPct, fmtSignedUSD, fmtUSD, filterRange, fmtDateLong } from "@/lib/portfolio";
import type { PortfolioPoint, Range, RangeAnalysis } from "@/lib/types";
import { USER_LIST, USERS, type UserId } from "@/lib/picks";

interface Props {
  series: Record<UserId, PortfolioPoint[]>;
  analyses: Record<Range, RangeAnalysis>;
}

export function CompareView({ series, analyses }: Props) {
  const [range, setRange] = useState<Range>("ALL");
  const [scrub, setScrub] = useState<ScrubState | null>(null);

  const ranged = useMemo(() => {
    const out = {} as Record<UserId, PortfolioPoint[]>;
    for (const u of USER_LIST) out[u.id] = filterRange(series[u.id], range);
    return out;
  }, [series, range]);

  const stats = useMemo(() => {
    return USER_LIST.map((u) => {
      const pts = ranged[u.id];
      const startVal = pts[0]?.value ?? 0;
      const lastVal = pts[pts.length - 1]?.value ?? 0;
      const scrubVal = scrub?.values.find((v) => v.id === u.id)?.value;
      const value = scrubVal ?? lastVal;
      const pct = startVal === 0 ? 0 : (value - startVal) / startVal;
      return { user: u, value, pct, startVal };
    }).sort((a, b) => b.pct - a.pct);
  }, [ranged, scrub]);

  const leader = stats[0];
  const second = stats[1];
  const gapPct = leader.pct - second.pct;
  const gapDollars = leader.value - second.value;
  const scrubDate = scrub ? fmtDateLong(scrub.date) : null;

  const chartSeries: ChartSeries[] = USER_LIST.map((u) => ({
    id: u.id,
    color: u.color,
    data: ranged[u.id],
  }));

  return (
    <div className="pb-24">
      <div className="px-4 pt-2 pb-3">
        <div className="text-[11px] font-bold tracking-[0.12em] uppercase text-zinc-500 mb-1">
          Compare
        </div>
        <h1 className="text-[22px] leading-tight font-semibold text-white">
          {leader.user.name} {gapPct === 0 ? "is tied with" : "leads"} {second.user.name}
        </h1>
        <div
          className="text-[34px] font-semibold tracking-tight mt-1"
          style={{ color: leader.user.color }}
        >
          {fmtPct(gapPct)}
        </div>
        <div className="text-[14px] font-medium text-zinc-400 mt-0.5">
          {fmtSignedUSD(gapDollars)} gap
          {scrubDate && <span className="text-zinc-500"> • {scrubDate}</span>}
        </div>
      </div>

      <ScrubChart series={chartSeries} onScrub={setScrub} height={280} />

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
