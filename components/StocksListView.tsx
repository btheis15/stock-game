"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AnimatedRow } from "./AnimatedList";
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
        <div className="text-[11px] font-bold tracking-[0.12em] uppercase text-ink-faint mb-1">
          All picks
        </div>
        <h1 className="text-[22px] leading-tight font-semibold text-ink">Stocks</h1>
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
        <div className="rounded-2xl bg-card border border-hairline divide-y divide-hairline overflow-hidden stagger-in">
          {rows.map((r) => (
            <AnimatedRow key={r.ticker}>
            <Link
              href={`/stock/${r.ticker}`}
              className="press flex items-center gap-3 px-4 py-3 active:bg-pressed"
            >
              <OwnerSwatch owners={r.owners} />
              <div className="flex-1 min-w-0">
                <div className="text-[14px] font-semibold text-ink truncate">
                  {r.ticker}{" "}
                  <span className="text-ink-faint font-normal">{r.name}</span>
                </div>
                <div className="text-[11px] text-ink-faint tabular-nums">
                  {fmtUSD(r.last, 2)}
                  {spinoffRowSuffix(r.ticker) && (
                    <span style={{ color: "#F5A623" }}> · {spinoffRowSuffix(r.ticker)}</span>
                  )}
                </div>
              </div>
              <div
                className="text-[14px] font-semibold tabular-nums"
                style={{ color: r.plPct >= 0 ? "var(--gain)" : "var(--loss)" }}
              >
                {fmtPct(r.plPct)}
              </div>
            </Link>
            </AnimatedRow>
          ))}
        </div>
      </div>
    </div>
  );
}

function OwnerSwatch({ owners }: { owners: UserId[] }) {
  if (owners.length === 0) {
    return <div className="w-9 h-9 rounded-full bg-raised shrink-0" />;
  }
  return (
    <div className="w-9 h-9 rounded-full bg-raised shrink-0 flex items-center justify-center gap-0.5">
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
          : "text-ink-muted border-hairline bg-card-50 hover:text-ink-2"
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
