"use client";

// Head-to-head mode: pick any two players and get a focused comparison —
// a two-line since-inception chart, the per-range win record, each side's
// best pick, and the holdings they share. Pure recomposition of props the
// Compare page already holds (daily series + precomputed range analyses);
// presented in a full <Sheet> because it's a view of Compare's data, not
// navigation (DESIGN.md §11).
import { useMemo, useState } from "react";
import { Sheet } from "./Sheet";
import { ScrubChart, type ChartSeries } from "./ScrubChart";
import { USERS, USER_LIST, type UserId } from "@/lib/picks";
import { accentFor, useP3 } from "@/lib/color";
import { fmtPct } from "@/lib/portfolio";
import type { PortfolioPoint, Range, RangeAnalysis } from "@/lib/types";
import clsx from "clsx";

const H2H_RANGES: Range[] = ["1D", "1W", "1M", "3M", "1YR", "ALL"];

export function HeadToHead({
  open,
  onClose,
  series,
  analyses,
}: {
  open: boolean;
  onClose: () => void;
  series: Record<UserId, PortfolioPoint[]>;
  analyses: Record<Range, RangeAnalysis>;
}) {
  const p3 = useP3();
  const [aId, setAId] = useState<UserId>(USER_LIST[0].id);
  const [bId, setBId] = useState<UserId>(USER_LIST[1]?.id ?? USER_LIST[0].id);
  const a = USERS[aId];
  const b = USERS[bId];
  const aColor = accentFor(a, p3);
  const bColor = accentFor(b, p3);

  // Two normalized-%-since-inception lines, same normalization the Compare
  // chart uses so the visual order matches the standings.
  const chartSeries: ChartSeries[] = useMemo(() => {
    return [
      { id: aId, color: aColor, user: a },
      { id: bId, color: bColor, user: b },
    ].map(({ id, color }) => {
      const pts = series[id] ?? [];
      const base = pts[0]?.value ?? 0;
      return {
        id,
        color,
        data: pts.map((pt) => ({
          date: pt.date,
          value: base === 0 ? 0 : (pt.value - base) / base,
        })),
      };
    });
  }, [aId, bId, aColor, bColor, series, a, b]);

  // Per-range win record + each side's best pick for the ALL window.
  const record = useMemo(() => {
    const rows = H2H_RANGES.map((r) => {
      const pa = analyses[r]?.perUser[aId]?.pct ?? 0;
      const pb = analyses[r]?.perUser[bId]?.pct ?? 0;
      return { range: r, a: pa, b: pb, winner: pa === pb ? null : pa > pb ? aId : bId };
    });
    const aWins = rows.filter((r) => r.winner === aId).length;
    const bWins = rows.filter((r) => r.winner === bId).length;
    return { rows, aWins, bWins };
  }, [analyses, aId, bId]);

  const bestPick = (id: UserId) =>
    (analyses.ALL?.perUser[id]?.movers ?? [])
      .slice()
      .sort((m, n) => n.pct - m.pct)[0] ?? null;

  const shared = useMemo(
    () => a.tickers.filter((t) => b.tickers.includes(t)),
    [a, b]
  );

  return (
    <Sheet open={open} onClose={onClose} eyebrow="Head to head" title={`${a.name} vs ${b.name}`} full>
      <div className="flex gap-2 mb-3">
        <PickerRow current={aId} exclude={bId} onPick={setAId} />
      </div>
      <div className="flex gap-2 mb-4">
        <PickerRow current={bId} exclude={aId} onPick={setBId} />
      </div>

      <div className="-mx-5">
        <ScrubChart series={chartSeries} height={200} baseline={0} />
      </div>

      <div className="mt-4 rounded-2xl bg-card border border-hairline overflow-hidden">
        <div className="px-4 py-2.5 text-[12px] font-semibold text-ink-2 border-b border-hairline">
          {record.aWins === record.bWins
            ? `Dead even — ${record.aWins} ranges each`
            : `${record.aWins > record.bWins ? a.name : b.name} leads ${Math.max(record.aWins, record.bWins)} of ${H2H_RANGES.length} ranges`}
        </div>
        <div className="divide-y divide-hairline">
          {record.rows.map((r) => (
            <div key={r.range} className="flex items-center px-4 py-2 text-[12px] tabular-nums">
              <span className="w-10 text-ink-faint font-semibold">{r.range}</span>
              <span
                className={clsx("flex-1 text-right font-medium")}
                style={{ color: r.winner === aId ? aColor : "var(--ink-muted)" }}
              >
                {fmtPct(r.a)}
              </span>
              <span className="w-8 text-center text-ink-ghost">·</span>
              <span
                className={clsx("flex-1 text-left font-medium")}
                style={{ color: r.winner === bId ? bColor : "var(--ink-muted)" }}
              >
                {fmtPct(r.b)}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
        {[{ u: a, c: aColor }, { u: b, c: bColor }].map(({ u, c }) => {
          const best = bestPick(u.id);
          return (
            <div key={u.id} className="rounded-2xl bg-card border border-hairline px-3 py-2.5">
              <div className="text-[10px] font-bold tracking-[0.12em] uppercase text-ink-faint">
                {u.name}'s best pick
              </div>
              {best ? (
                <div className="mt-1 font-semibold text-ink">
                  {best.ticker}{" "}
                  <span className="tabular-nums font-medium" style={{ color: c }}>
                    {fmtPct(best.pct)}
                  </span>
                </div>
              ) : (
                <div className="mt-1 text-ink-faint">—</div>
              )}
            </div>
          );
        })}
      </div>

      {shared.length > 0 && (
        <div className="mt-3 mb-2 text-[12px] text-ink-faint">
          Shared holdings:{" "}
          <span className="text-ink-2 font-medium">{shared.join(", ")}</span>
        </div>
      )}
    </Sheet>
  );
}

function PickerRow({
  current,
  exclude,
  onPick,
}: {
  current: UserId;
  exclude: UserId;
  onPick: (id: UserId) => void;
}) {
  const p3 = useP3();
  return (
    <div className="flex gap-1.5 overflow-x-auto">
      {USER_LIST.map((u) => {
        const active = u.id === current;
        const disabled = u.id === exclude;
        return (
          <button
            key={u.id}
            disabled={disabled}
            onClick={() => onPick(u.id)}
            className={clsx(
              "press px-2.5 py-1 rounded-full text-[12px] font-semibold border shrink-0 transition-colors",
              active ? "text-black" : "text-ink-muted border-hairline",
              disabled && "opacity-35"
            )}
            style={
              active
                ? { backgroundColor: accentFor(u, p3), borderColor: accentFor(u, p3) }
                : undefined
            }
          >
            {u.name}
          </button>
        );
      })}
    </div>
  );
}
