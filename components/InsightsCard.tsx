"use client";

import Link from "next/link";
import { fmtPct, fmtSignedUSD, fmtUSD } from "@/lib/portfolio";
import type { RangeAnalysis, RangeMover } from "@/lib/types";
import { TICKER_NAMES, USER_LIST, USERS, type UserId } from "@/lib/picks";

const MAX_PER_LIST = 3;

export function InsightsCard({ analysis }: { analysis: RangeAnalysis }) {
  const ranked = [...USER_LIST].sort(
    (a, b) => (analysis.perUser[b.id]?.pct ?? 0) - (analysis.perUser[a.id]?.pct ?? 0)
  );
  return (
    <div className="px-4 mt-5">
      <h2 className="text-[15px] font-semibold text-zinc-300 mb-2">What's driving it</h2>
      <div className="space-y-3">
        {ranked.map((u, i) => (
          <UserPerformersCard
            key={u.id}
            userId={u.id}
            movers={analysis.perUser[u.id]?.movers ?? []}
            place={i + 1}
            rangePct={analysis.perUser[u.id]?.pct ?? 0}
          />
        ))}
      </div>
    </div>
  );
}

function UserPerformersCard({
  userId,
  movers,
  place,
  rangePct,
}: {
  userId: UserId;
  movers: RangeMover[];
  place: number;
  rangePct: number;
}) {
  const user = USERS[userId];
  const top = [...movers]
    .filter((m) => m.pct > 0)
    .sort((a, b) => b.pct - a.pct)
    .slice(0, MAX_PER_LIST);
  const bottom = [...movers]
    .filter((m) => m.pct < 0)
    .sort((a, b) => a.pct - b.pct)
    .slice(0, MAX_PER_LIST);
  const placeLabel = ["1st", "2nd", "3rd", "4th"][place - 1] ?? `${place}th`;
  const pctColor = rangePct >= 0 ? "#00C805" : "#FF453A";

  return (
    <div className="rounded-2xl bg-zinc-900/70 border border-zinc-800 p-4">
      <Link
        href={`/portfolio/${userId}`}
        className="flex items-center gap-2 mb-3 -mx-1 px-1 py-1 rounded-md active:bg-zinc-800/40 transition-colors"
      >
        <span
          className="w-2.5 h-2.5 rounded-full"
          style={{ backgroundColor: user.color }}
        />
        <span className="font-semibold text-[14px] text-white">{user.name}</span>
        <span className="text-[12px] tabular-nums font-semibold ml-1" style={{ color: pctColor }}>
          {fmtPct(rangePct)}
        </span>
        <span
          className="ml-auto text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
          style={
            place === 1
              ? { backgroundColor: user.color, color: "#000" }
              : { color: "#a1a1aa", border: "1px solid #3f3f46" }
          }
        >
          {placeLabel}
        </span>
      </Link>

      {top.length === 0 && bottom.length === 0 ? (
        <p className="text-[12px] text-zinc-500">Flat across the board this range.</p>
      ) : (
        <div className="space-y-3">
          {top.length > 0 && <Section label="Top performers" items={top} />}
          {bottom.length > 0 && (
            <Section label="Bottom performers" items={bottom} />
          )}
        </div>
      )}
    </div>
  );
}

function Section({
  label,
  items,
}: {
  label: string;
  items: RangeMover[];
}) {
  return (
    <div>
      <h3 className="text-[10px] font-bold tracking-[0.12em] uppercase text-zinc-500 mb-1.5">
        {label}
      </h3>
      <div className="divide-y divide-zinc-800/70">
        {items.map((m) => (
          <MoverRow key={m.ticker} mover={m} />
        ))}
      </div>
    </div>
  );
}

function MoverRow({ mover }: { mover: RangeMover }) {
  const positive = mover.pct >= 0;
  const color = positive ? "#00C805" : "#FF453A";
  return (
    <Link
      href={`/stock/${mover.ticker}`}
      className="flex items-center gap-3 py-2 active:bg-zinc-800/40 transition-colors -mx-1 px-1 rounded-md"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-1.5">
          <span className="text-[13px] font-semibold text-white">{mover.ticker}</span>
          <span className="text-[11px] text-zinc-500 tabular-nums">
            {fmtUSD(mover.price, 2)}
          </span>
        </div>
        <div className="text-[11px] text-zinc-500 truncate">
          {TICKER_NAMES[mover.ticker] ?? ""}
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className="text-[13px] font-semibold tabular-nums" style={{ color }}>
          {fmtPct(mover.pct)}
        </div>
        <div className="text-[11px] tabular-nums" style={{ color }}>
          {fmtSignedUSD(mover.points, 2)}
        </div>
      </div>
    </Link>
  );
}
