"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ScrubChart, type ChartSeries, type ScrubState } from "./ScrubChart";
import { RangeTabs } from "./RangeTabs";
import { fmtPct, fmtSignedUSD, fmtUSD, filterRange, fmtDateLong } from "@/lib/portfolio";
import type { PortfolioPoint, Range } from "@/lib/types";
import { USERS } from "@/lib/picks";

interface Props {
  brian: PortfolioPoint[];
  kevin: PortfolioPoint[];
}

export function CompareView({ brian, kevin }: Props) {
  const [range, setRange] = useState<Range>("ALL");
  const [scrub, setScrub] = useState<ScrubState | null>(null);

  const brianRange = useMemo(() => filterRange(brian, range), [brian, range]);
  const kevinRange = useMemo(() => filterRange(kevin, range), [kevin, range]);

  const brianStart = brianRange[0]?.value ?? 0;
  const kevinStart = kevinRange[0]?.value ?? 0;

  const brianValue = scrub
    ? scrub.values.find((v) => v.id === "brian")?.value ?? brianRange[brianRange.length - 1]?.value ?? 0
    : brianRange[brianRange.length - 1]?.value ?? 0;
  const kevinValue = scrub
    ? scrub.values.find((v) => v.id === "kevin")?.value ?? kevinRange[kevinRange.length - 1]?.value ?? 0
    : kevinRange[kevinRange.length - 1]?.value ?? 0;

  const brianPct = brianStart === 0 ? 0 : (brianValue - brianStart) / brianStart;
  const kevinPct = kevinStart === 0 ? 0 : (kevinValue - kevinStart) / kevinStart;

  const leader = brianPct >= kevinPct ? USERS.brian : USERS.kevin;
  const trailer = leader.id === "brian" ? USERS.kevin : USERS.brian;
  const leaderPct = leader.id === "brian" ? brianPct : kevinPct;
  const trailerPct = trailer.id === "brian" ? brianPct : kevinPct;
  const gapPct = leaderPct - trailerPct;
  const gapDollars = (leader.id === "brian" ? brianValue : kevinValue) -
    (leader.id === "brian" ? kevinValue : brianValue);

  const scrubDate = scrub ? fmtDateLong(scrub.date) : null;

  const series: ChartSeries[] = [
    { id: "brian", color: USERS.brian.color, data: brianRange },
    { id: "kevin", color: USERS.kevin.color, data: kevinRange },
  ];

  return (
    <div className="pb-24">
      <div className="px-4 pt-2 pb-3">
        <div className="text-[11px] font-bold tracking-[0.12em] uppercase text-zinc-500 mb-1">
          Compare
        </div>
        <h1 className="text-[22px] leading-tight font-semibold text-white">
          {leader.name} {gapPct === 0 ? "is tied with" : "leads"} {trailer.name}
        </h1>
        <div
          className="text-[34px] font-semibold tracking-tight mt-1"
          style={{ color: leader.color }}
        >
          {fmtPct(gapPct)}
        </div>
        <div className="text-[14px] font-medium text-zinc-400 mt-0.5">
          {fmtSignedUSD(gapDollars)} gap
          {scrubDate && <span className="text-zinc-500"> • {scrubDate}</span>}
        </div>
      </div>

      <ScrubChart series={series} onScrub={setScrub} height={280} />

      <RangeTabs value={range} onChange={setRange} accent={leader.color} />

      <div className="px-4 mt-2 grid grid-cols-2 gap-3">
        <UserCard
          name={USERS.brian.name}
          color={USERS.brian.color}
          value={brianValue}
          pct={brianPct}
          href="/portfolio/brian"
          isLeader={leader.id === "brian"}
        />
        <UserCard
          name={USERS.kevin.name}
          color={USERS.kevin.color}
          value={kevinValue}
          pct={kevinPct}
          href="/portfolio/kevin"
          isLeader={leader.id === "kevin"}
        />
      </div>

      <div className="px-4 mt-6">
        <h2 className="text-[15px] font-semibold text-zinc-300 mb-2">Game rules</h2>
        <div className="text-[13px] text-zinc-500 leading-relaxed">
          Each portfolio started with $100,000 split evenly across 10 picks at the
          Feb 5, 2026 close. Partial shares allowed. Updated daily.
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
  isLeader,
}: {
  name: string;
  color: string;
  value: number;
  pct: number;
  href: string;
  isLeader: boolean;
}) {
  const positive = pct >= 0;
  const deltaColor = positive ? "#00C805" : "#FF453A";
  return (
    <Link
      href={href}
      className="rounded-2xl bg-zinc-900/70 border border-zinc-800 p-4 flex flex-col gap-1 active:bg-zinc-900 transition-colors"
    >
      <div className="flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
        <span className="text-[13px] font-semibold text-zinc-300">{name}</span>
        {isLeader && (
          <span className="ml-auto text-[10px] font-bold uppercase tracking-wider text-black px-1.5 py-0.5 rounded" style={{ backgroundColor: color }}>
            Leading
          </span>
        )}
      </div>
      <div className="text-[20px] font-semibold text-white tabular-nums">{fmtUSD(value)}</div>
      <div className="text-[12px] font-medium tabular-nums" style={{ color: deltaColor }}>
        {fmtPct(pct)}
      </div>
    </Link>
  );
}
