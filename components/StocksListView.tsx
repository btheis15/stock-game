"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { fmtPct, fmtUSD } from "@/lib/portfolio";
import { TICKER_OWNERS, USER_LIST, USERS, type UserId } from "@/lib/picks";
import type { TickerSeries } from "@/lib/types";
import { spinoffRowSuffix } from "./SpinoffNote";

interface Props {
  series: TickerSeries[];
}

type Filter = "all" | UserId;

export function StocksListView({ series }: Props) {
  const [filter, setFilter] = useState<Filter>("all");

  const rows = useMemo(() => {
    return series
      .map((s) => {
        const last = s.closes[s.closes.length - 1].close;
        const plPct = (last - s.startClose) / s.startClose;
        return {
          ticker: s.ticker,
          name: s.name,
          last,
          plPct,
          owners: TICKER_OWNERS[s.ticker] ?? [],
        };
      })
      .filter((r) => filter === "all" || r.owners.includes(filter))
      .sort((a, b) => b.plPct - a.plPct);
  }, [series, filter]);

  return (
    <div className="pb-24">
      <div className="px-4 pt-2 pb-3">
        <div className="text-[11px] font-bold tracking-[0.12em] uppercase text-zinc-500 mb-1">
          All picks
        </div>
        <h1 className="text-[22px] leading-tight font-semibold text-white">Stocks</h1>
      </div>

      <div className="px-4 flex gap-2 mb-3 overflow-x-auto -mx-4 px-4 pb-1">
        <Chip active={filter === "all"} onClick={() => setFilter("all")}>
          All
        </Chip>
        {USER_LIST.map((u) => (
          <Chip
            key={u.id}
            active={filter === u.id}
            onClick={() => setFilter(u.id)}
            color={u.color}
          >
            {u.name}
          </Chip>
        ))}
      </div>

      <div className="px-4">
        <div className="rounded-2xl bg-zinc-900/70 border border-zinc-800 divide-y divide-zinc-800 overflow-hidden">
          {rows.map((r) => (
            <Link
              key={r.ticker}
              href={`/stock/${r.ticker}`}
              className="flex items-center gap-3 px-4 py-3 active:bg-zinc-800/60 transition-colors"
            >
              <OwnerSwatch owners={r.owners} />
              <div className="flex-1 min-w-0">
                <div className="text-[14px] font-semibold text-white truncate">
                  {r.ticker}{" "}
                  <span className="text-zinc-500 font-normal">{r.name}</span>
                </div>
                <div className="text-[11px] text-zinc-500 tabular-nums">
                  {fmtUSD(r.last, 2)}
                  {spinoffRowSuffix(r.ticker) && (
                    <span style={{ color: "#F5A623" }}> · {spinoffRowSuffix(r.ticker)}</span>
                  )}
                </div>
              </div>
              <div
                className="text-[14px] font-semibold tabular-nums"
                style={{ color: r.plPct >= 0 ? "#00C805" : "#FF453A" }}
              >
                {fmtPct(r.plPct)}
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

function OwnerSwatch({ owners }: { owners: UserId[] }) {
  if (owners.length === 0) {
    return <div className="w-9 h-9 rounded-full bg-zinc-800 shrink-0" />;
  }
  return (
    <div className="w-9 h-9 rounded-full bg-zinc-800 shrink-0 flex items-center justify-center gap-0.5">
      {owners.map((id) => (
        <span
          key={id}
          className="w-2 h-2 rounded-full"
          style={{ backgroundColor: USERS[id].color }}
        />
      ))}
    </div>
  );
}

function Chip({
  active,
  onClick,
  color,
  children,
}: {
  active: boolean;
  onClick: () => void;
  color?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "px-3 py-1.5 rounded-full text-[12px] font-semibold border transition-colors shrink-0",
        active
          ? "text-black"
          : "text-zinc-400 border-zinc-800 bg-zinc-900/50 hover:text-zinc-200"
      )}
      style={
        active
          ? { backgroundColor: color ?? "#fff", borderColor: color ?? "#fff" }
          : undefined
      }
    >
      {children}
    </button>
  );
}
