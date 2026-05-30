"use client";

// Shared donut + slice list/detail used by both the per-player "Portfolio
// breakdown" (sliced by sector / industry / market cap) and the game-wide
// "Participant breakdown" (sliced by player). Same visual language; the
// wording is parameterized so a slice can read as "of portfolio" / "of slice"
// or "of combined fund" / "of participant" without forking the markup.

import { useId, useMemo } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import type { CompositionSlice } from "@/lib/portfolio-composition";
import { fmtPct, fmtUSD } from "@/lib/portfolio";

const TAU = Math.PI * 2;

function arcPath(
  cx: number,
  cy: number,
  rOuter: number,
  rInner: number,
  start: number,
  end: number
): string {
  // Guard against full-circle case (a single slice == 100%): SVG won't draw a
  // 360° arc with sweep so we cheat with two half-arcs.
  if (end - start >= TAU - 1e-6) {
    return [
      `M ${cx + rOuter} ${cy}`,
      `A ${rOuter} ${rOuter} 0 1 1 ${cx - rOuter} ${cy}`,
      `A ${rOuter} ${rOuter} 0 1 1 ${cx + rOuter} ${cy}`,
      `M ${cx + rInner} ${cy}`,
      `A ${rInner} ${rInner} 0 1 0 ${cx - rInner} ${cy}`,
      `A ${rInner} ${rInner} 0 1 0 ${cx + rInner} ${cy}`,
      "Z",
    ].join(" ");
  }
  const largeArc = end - start > Math.PI ? 1 : 0;
  const x1 = cx + rOuter * Math.cos(start);
  const y1 = cy + rOuter * Math.sin(start);
  const x2 = cx + rOuter * Math.cos(end);
  const y2 = cy + rOuter * Math.sin(end);
  const x3 = cx + rInner * Math.cos(end);
  const y3 = cy + rInner * Math.sin(end);
  const x4 = cx + rInner * Math.cos(start);
  const y4 = cy + rInner * Math.sin(start);
  return [
    `M ${x1} ${y1}`,
    `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${x2} ${y2}`,
    `L ${x3} ${y3}`,
    `A ${rInner} ${rInner} 0 ${largeArc} 0 ${x4} ${y4}`,
    "Z",
  ].join(" ");
}

interface DonutProps {
  width: number;
  height: number;
  slices: CompositionSlice[];
  selected: string | null;
  onSelect: (key: string) => void;
  total: number;
  accentColor: string;
  /** Center subtitle when nothing's selected. Defaults to "{n} positions". */
  centerSubtitle?: string;
  /** Center subtitle when a wedge is selected. Defaults to "{pct} of portfolio". */
  selectedSubtitle?: (slice: CompositionSlice) => string;
}

export function BreakdownDonut({
  width,
  height,
  slices,
  selected,
  onSelect,
  total,
  accentColor,
  centerSubtitle,
  selectedSubtitle,
}: DonutProps) {
  const gradId = useId();
  const cx = width / 2;
  const cy = height / 2;
  const r = Math.max(40, Math.min(width, height) / 2 - 18);
  const rInner = r * 0.62;

  // Build slice geometry, starting at 12 o'clock (− π/2) and sweeping CW.
  const pieces = useMemo(() => {
    let acc = -Math.PI / 2;
    return slices.map((s) => {
      const angle = s.pct * TAU;
      const start = acc;
      const end = acc + angle;
      acc = end;
      const mid = (start + end) / 2;
      return { slice: s, start, end, mid };
    });
  }, [slices]);

  const selectedSlice = selected
    ? pieces.find((p) => p.slice.key === selected) ?? null
    : null;

  const defaultPositions = `${slices.reduce((s, x) => s + x.tickers.length, 0)} positions`;
  const centerTop = selectedSlice ? selectedSlice.slice.key : "Total";
  const centerMid = selectedSlice
    ? fmtUSD(selectedSlice.slice.value)
    : fmtUSD(total);
  const centerBot = selectedSlice
    ? selectedSubtitle
      ? selectedSubtitle(selectedSlice.slice)
      : `${fmtPct(selectedSlice.slice.pct)} of portfolio`
    : centerSubtitle ?? defaultPositions;

  return (
    <div className="relative">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        aria-label="Breakdown donut chart"
        style={{ touchAction: "manipulation" }}
      >
        <defs>
          <radialGradient id={`${gradId}-shade`} cx="50%" cy="50%" r="50%">
            <stop offset="60%" stopColor="rgba(255,255,255,0)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0.18)" />
          </radialGradient>
        </defs>

        {pieces.map(({ slice, start, end, mid }) => {
          const isSelected = selected === slice.key;
          const isDimmed = selected != null && !isSelected;
          const popDist = isSelected ? 8 : 0;
          const dx = Math.cos(mid) * popDist;
          const dy = Math.sin(mid) * popDist;
          const path = arcPath(cx, cy, r, rInner, start, end);
          return (
            <motion.g
              key={slice.key}
              initial={false}
              animate={{ x: dx, y: dy, opacity: isDimmed ? 0.32 : 1 }}
              transition={{ type: "spring", stiffness: 220, damping: 22 }}
              onClick={() => onSelect(slice.key)}
              style={{ cursor: "pointer" }}
            >
              <path
                d={path}
                fill={slice.color}
                stroke="var(--background, #000)"
                strokeWidth={2}
              />
              <path d={path} fill={`url(#${gradId}-shade)`} pointerEvents="none" />
            </motion.g>
          );
        })}

        <circle
          cx={cx}
          cy={cy}
          r={rInner}
          fill="var(--background, #000)"
          pointerEvents="none"
        />

        <g pointerEvents="none">
          <text
            x={cx}
            y={cy - 18}
            textAnchor="middle"
            fontSize={11}
            fontWeight={600}
            style={{ letterSpacing: "0.08em", textTransform: "uppercase" }}
            fill="var(--chart-axis-label, #a1a1aa)"
          >
            {centerTop}
          </text>
          <text
            x={cx}
            y={cy + 6}
            textAnchor="middle"
            fontSize={22}
            fontWeight={700}
            fill="var(--foreground, #fff)"
            className="tabular-nums"
          >
            {centerMid}
          </text>
          <text
            x={cx}
            y={cy + 24}
            textAnchor="middle"
            fontSize={11}
            fill={selectedSlice ? accentColor : "var(--chart-axis-label, #a1a1aa)"}
            className="tabular-nums"
          >
            {centerBot}
          </text>
        </g>
      </svg>
    </div>
  );
}

// --- Slice list (default view below donut) -------------------------------

export function SliceList({
  slices,
  onSelect,
  viewLabel,
  /** Renders the per-slice count line. Defaults to "{n} position(s)". */
  countLabel,
}: {
  slices: CompositionSlice[];
  onSelect: (k: string) => void;
  viewLabel: string;
  countLabel?: (n: number) => string;
}) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-zinc-500 mt-2 mb-2">
        By {viewLabel.toLowerCase()}
      </div>
      <div className="space-y-1.5">
        {slices.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => onSelect(s.key)}
            className="w-full flex items-center gap-3 py-2 active:bg-zinc-800/40 rounded-lg transition-colors text-left"
          >
            <span
              className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
              style={{ backgroundColor: s.color }}
            />
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-semibold text-zinc-200 truncate">
                {s.key}
              </div>
              <div className="text-[11px] text-zinc-500 tabular-nums">
                {countLabel
                  ? countLabel(s.tickers.length)
                  : `${s.tickers.length} position${s.tickers.length === 1 ? "" : "s"}`}
              </div>
            </div>
            <div className="w-20 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{ width: `${s.pct * 100}%`, backgroundColor: s.color }}
              />
            </div>
            <div className="text-[12px] font-semibold tabular-nums text-zinc-200 w-12 text-right">
              {fmtPct(s.pct)}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// --- Slice detail (when a wedge is selected) -----------------------------

export function SliceDetail({
  slice,
  /** Noun for the whole book: "portfolio" (default) or "combined fund". */
  totalNoun = "portfolio",
  /** Noun for this wedge: "slice" (default) or "participant". */
  sliceNoun = "slice",
}: {
  slice: CompositionSlice;
  totalNoun?: string;
  sliceNoun?: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mt-2 mb-3">
        <span
          className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
          style={{ backgroundColor: slice.color }}
        />
        <div className="text-[12px] font-semibold uppercase tracking-wide text-zinc-400">
          {slice.key}
        </div>
        <div className="ml-auto text-[11px] text-zinc-500 tabular-nums">
          {fmtUSD(slice.value)} · {fmtPct(slice.pct)}
        </div>
      </div>
      <div className="space-y-1">
        {slice.tickers.map((t) => (
          <Link
            key={t.ticker}
            href={`/stock/${t.ticker}`}
            className="flex items-center gap-3 px-2 py-2 rounded-lg active:bg-zinc-800/60 transition-colors"
          >
            <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center text-[10px] font-bold text-zinc-300">
              {t.ticker}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-semibold text-zinc-200 truncate">
                {t.name}
              </div>
              <div className="text-[11px] text-zinc-500 tabular-nums">
                {fmtPct(t.portfolioPct)} of {totalNoun}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[13px] font-semibold text-zinc-100 tabular-nums">
                {fmtUSD(t.value)}
              </div>
              <div className="text-[11px] text-zinc-500 tabular-nums">
                {fmtPct(t.pct)} of {sliceNoun}
              </div>
            </div>
          </Link>
        ))}
      </div>
      <div className="text-[11px] text-zinc-500 mt-2 px-2">
        Tap the {sliceNoun} again to clear.
      </div>
    </div>
  );
}
