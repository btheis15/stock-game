"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ScrubChart, type ChartSeries, type ScrubState } from "./ScrubChart";
import { RangeTabs } from "./RangeTabs";
import { PriceHeader } from "./PriceHeader";
import { filterRange, fmtDateLong, fmtPct, fmtUSD } from "@/lib/portfolio";
import type { HoldingRow, PortfolioPoint, Range } from "@/lib/types";
import { TICKER_NAMES, USERS, type UserId } from "@/lib/picks";

interface Props {
  userId: UserId;
  series: PortfolioPoint[];
  holdings: HoldingRow[];
}

export function PortfolioView({ userId, series, holdings }: Props) {
  const user = USERS[userId];
  const [range, setRange] = useState<Range>("ALL");
  const [scrub, setScrub] = useState<ScrubState | null>(null);

  const ranged = useMemo(() => filterRange(series, range), [series, range]);

  const baselineValue = ranged[0]?.value ?? 0;
  const lastValue = ranged[ranged.length - 1]?.value ?? 0;
  const scrubVal = scrub?.values.find((v) => v.id === userId)?.value;
  const value = scrubVal ?? lastValue;
  const scrubDate = scrub ? fmtDateLong(scrub.date) : null;

  const sorted = useMemo(
    () => [...holdings].sort((a, b) => b.plPct - a.plPct),
    [holdings]
  );

  return (
    <div className="pb-24">
      <PriceHeader
        ticker={user.name.toUpperCase()}
        title={`${user.name}'s portfolio`}
        value={value}
        baseline={baselineValue}
        scrubDate={scrubDate}
      />

      <ScrubChart
        series={[{ id: userId, color: user.color, data: ranged }]}
        onScrub={setScrub}
        height={260}
      />

      <RangeTabs value={range} onChange={setRange} accent={user.color} />

      <div className="px-4 mt-3">
        <h2 className="text-[15px] font-semibold text-zinc-300 mb-2">Holdings</h2>
        <div className="rounded-2xl bg-zinc-900/70 border border-zinc-800 divide-y divide-zinc-800 overflow-hidden">
          {sorted.map((h) => (
            <Link
              key={h.ticker}
              href={`/stock/${h.ticker}`}
              id={h.ticker}
              className="flex items-center gap-3 px-4 py-3 active:bg-zinc-800/60 transition-colors target:bg-zinc-800/80 target:animate-[holdingFlash_1.6s_ease]"
              style={{ scrollMarginTop: 80, scrollMarginBottom: 100 }}
            >
              <div className="w-9 h-9 rounded-full bg-zinc-800 flex items-center justify-center text-[10px] font-bold text-zinc-300">
                {h.ticker}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[14px] font-semibold text-white truncate">
                  {TICKER_NAMES[h.ticker] ?? h.ticker}
                </div>
                <div className="text-[11px] text-zinc-500 tabular-nums">
                  {h.shares.toFixed(2)} sh • {fmtUSD(h.currentClose, 2)}
                </div>
              </div>
              <div className="text-right">
                <div className="text-[14px] font-semibold text-white tabular-nums">
                  {fmtUSD(h.currentValue)}
                </div>
                <div
                  className="text-[11px] font-medium tabular-nums"
                  style={{ color: h.plPct >= 0 ? "#00C805" : "#FF453A" }}
                >
                  {fmtPct(h.plPct)}
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

