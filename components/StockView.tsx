"use client";

import { useMemo, useState } from "react";
import { ScrubChart, type ScrubState } from "./ScrubChart";
import { RangeTabs } from "./RangeTabs";
import { PriceHeader } from "./PriceHeader";
import { filterRange, fmtDateLong, fmtPct, fmtUSD } from "@/lib/portfolio";
import type { Range, TickerSeries } from "@/lib/types";
import { TICKER_OWNER, USERS } from "@/lib/picks";

interface Props {
  series: TickerSeries;
}

export function StockView({ series }: Props) {
  const [range, setRange] = useState<Range>("ALL");
  const [scrub, setScrub] = useState<ScrubState | null>(null);

  const owner = USERS[TICKER_OWNER[series.ticker]];

  const closesAsPoints = useMemo(
    () => series.closes.map((c) => ({ date: c.date, value: c.close })),
    [series]
  );

  const ranged = useMemo(() => filterRange(closesAsPoints, range), [closesAsPoints, range]);
  const baseline = ranged[0]?.value ?? 0;
  const last = ranged[ranged.length - 1]?.value ?? 0;
  const scrubVal = scrub?.values.find((v) => v.id === series.ticker)?.value;
  const price = scrubVal ?? last;
  const scrubDate = scrub ? fmtDateLong(scrub.date) : null;

  const positionValue = series.shares * price;
  const costBasis = series.shares * series.startClose;
  const pl = positionValue - costBasis;
  const plPct = costBasis === 0 ? 0 : pl / costBasis;

  return (
    <div className="pb-24">
      <PriceHeader
        ticker={series.ticker}
        title={series.name}
        value={price}
        baseline={baseline}
        scrubDate={scrubDate}
        fractionDigits={2}
      />

      <ScrubChart
        series={[{ id: series.ticker, color: owner.color, data: ranged }]}
        onScrub={setScrub}
        height={260}
      />

      <RangeTabs value={range} onChange={setRange} accent={owner.color} />

      <div className="px-4 mt-3">
        <h2 className="text-[15px] font-semibold text-zinc-300 mb-2">Position</h2>
        <div className="rounded-2xl bg-zinc-900/70 border border-zinc-800 divide-y divide-zinc-800">
          <Row label="Picked by" valueNode={
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: owner.color }} />
              <span className="font-semibold">{owner.name}</span>
            </span>
          } />
          <Row label="Shares" value={series.shares.toFixed(4)} />
          <Row label="Cost basis" value={fmtUSD(costBasis)} />
          <Row label="Bought at" value={fmtUSD(series.startClose, 2)} />
          <Row label="Last close" value={fmtUSD(series.closes[series.closes.length - 1].close, 2)} />
          <Row label="Current value" value={fmtUSD(positionValue)} bold />
          <Row
            label="Total return"
            valueNode={
              <span style={{ color: pl >= 0 ? "#00C805" : "#FF453A" }} className="font-semibold tabular-nums">
                {fmtPct(plPct)}
              </span>
            }
          />
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  valueNode,
  bold,
}: {
  label: string;
  value?: string;
  valueNode?: React.ReactNode;
  bold?: boolean;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <span className="text-[13px] text-zinc-400">{label}</span>
      <span className={`text-[14px] tabular-nums text-white ${bold ? "font-semibold" : ""}`}>
        {valueNode ?? value}
      </span>
    </div>
  );
}
