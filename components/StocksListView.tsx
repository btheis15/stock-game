"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { fmtPct, fmtUSD } from "@/lib/portfolio";
import { TICKER_NAMES, TICKER_OWNER, USERS, type UserId } from "@/lib/picks";
import type { TickerSeries } from "@/lib/types";

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
          owner: TICKER_OWNER[s.ticker],
        };
      })
      .filter((r) => filter === "all" || r.owner === filter)
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

      <div className="px-4 flex gap-2 mb-3">
        <Chip active={filter === "all"} onClick={() => setFilter("all")}>
          All
        </Chip>
        <Chip
          active={filter === "brian"}
          onClick={() => setFilter("brian")}
          color={USERS.brian.color}
        >
          Brian
        </Chip>
        <Chip
          active={filter === "kevin"}
          onClick={() => setFilter("kevin")}
          color={USERS.kevin.color}
        >
          Kevin
        </Chip>
      </div>

      <div className="px-4">
        <div className="rounded-2xl bg-zinc-900/70 border border-zinc-800 divide-y divide-zinc-800 overflow-hidden">
          {rows.map((r) => {
            const ownerColor = USERS[r.owner].color;
            return (
              <Link
                key={r.ticker}
                href={`/stock/${r.ticker}`}
                className="flex items-center gap-3 px-4 py-3 active:bg-zinc-800/60 transition-colors"
              >
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center text-[10px] font-bold"
                  style={{ backgroundColor: `${ownerColor}22`, color: ownerColor }}
                >
                  {r.ticker}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] font-semibold text-white truncate">{r.name}</div>
                  <div className="text-[11px] text-zinc-500 tabular-nums">
                    {fmtUSD(r.last, 2)}
                  </div>
                </div>
                <div
                  className="text-[14px] font-semibold tabular-nums"
                  style={{ color: r.plPct >= 0 ? "#00C805" : "#FF453A" }}
                >
                  {fmtPct(r.plPct)}
                </div>
              </Link>
            );
          })}
        </div>
      </div>
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
        "px-3 py-1.5 rounded-full text-[12px] font-semibold border transition-colors",
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
