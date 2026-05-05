"use client";

import { useMemo, useState } from "react";
import { ScrubChart, type ScrubState } from "./ScrubChart";
import { RangeTabs } from "./RangeTabs";
import { PriceHeader } from "./PriceHeader";
import {
  dividendsReceived,
  filterRange,
  fmtDateLong,
  fmtDateShort,
  fmtPct,
  fmtUSD,
  sharesFor,
} from "@/lib/portfolio";
import type { Range, TickerSeries } from "@/lib/types";
import { TICKER_OWNERS, USERS, type UserId } from "@/lib/picks";

interface Props {
  series: TickerSeries;
}

export function StockView({ series }: Props) {
  const [range, setRange] = useState<Range>("ALL");
  const [scrub, setScrub] = useState<ScrubState | null>(null);

  const owners: UserId[] = TICKER_OWNERS[series.ticker] ?? [];
  const accentColor = owners.length > 0 ? USERS[owners[0]].color : "#888";

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
  const lastDate = series.closes[series.closes.length - 1].date;
  const dividends = series.dividends ?? [];

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
        series={[{ id: series.ticker, color: accentColor, data: ranged }]}
        onScrub={setScrub}
        height={260}
      />

      <RangeTabs value={range} onChange={setRange} accent={accentColor} />

      {owners.length === 0 ? (
        <div className="px-4 mt-3 text-[12px] text-zinc-500">
          Not held by any player.
        </div>
      ) : (
        <div className="px-4 mt-3 space-y-3">
          {owners.map((ownerId) => (
            <PositionCard
              key={ownerId}
              ownerId={ownerId}
              series={series}
              currentPrice={price}
              lastDate={lastDate}
            />
          ))}
        </div>
      )}

      {dividends.length > 0 && (
        <div className="px-4 mt-5">
          <h2 className="text-[15px] font-semibold text-zinc-300 mb-2">Dividends per share</h2>
          <div className="rounded-2xl bg-zinc-900/70 border border-zinc-800 divide-y divide-zinc-800">
            {dividends.map((d) => (
              <div
                key={d.date}
                className="flex items-center justify-between px-4 py-3"
              >
                <span className="text-[13px] text-zinc-400">{fmtDateShort(d.date)}</span>
                <span className="text-[14px] tabular-nums text-white">
                  {fmtUSD(d.amount, 4)} per share
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PositionCard({
  ownerId,
  series,
  currentPrice,
  lastDate,
}: {
  ownerId: UserId;
  series: TickerSeries;
  currentPrice: number;
  lastDate: string;
}) {
  const owner = USERS[ownerId];
  const shares = sharesFor(ownerId, series);
  const divCash = dividendsReceived(series, shares, lastDate);
  const positionValue = shares * currentPrice + divCash;
  const costBasis = shares * series.startClose;
  const pl = positionValue - costBasis;
  const plPct = costBasis === 0 ? 0 : pl / costBasis;

  return (
    <div className="rounded-2xl bg-zinc-900/70 border border-zinc-800 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800">
        <span
          className="w-2.5 h-2.5 rounded-full"
          style={{ backgroundColor: owner.color }}
        />
        <span className="text-[13px] font-semibold text-white">
          {owner.name}'s position
        </span>
      </div>
      <div className="divide-y divide-zinc-800">
        <Row label="Shares" value={shares.toFixed(4)} />
        <Row label="Cost basis" value={fmtUSD(costBasis)} />
        <Row label="Bought at" value={fmtUSD(series.startClose, 2)} />
        <Row label="Last close" value={fmtUSD(series.closes[series.closes.length - 1].close, 2)} />
        {divCash > 0 && (
          <Row
            label="Dividends received"
            valueNode={
              <span className="text-white tabular-nums font-semibold">
                {fmtUSD(divCash)}
              </span>
            }
          />
        )}
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
