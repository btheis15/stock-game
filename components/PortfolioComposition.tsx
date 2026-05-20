"use client";

import { useId, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ParentSize } from "@visx/responsive";
import Link from "next/link";
import type {
  CompositionSlice,
  PortfolioAnalysis,
  PortfolioComposition,
} from "@/lib/portfolio-composition";
import { fmtPct, fmtUSD } from "@/lib/portfolio";

type ViewKey = "sector" | "industry" | "marketcap";

const VIEW_LABEL: Record<ViewKey, string> = {
  sector: "Sector",
  industry: "Industry",
  marketcap: "Market cap",
};

interface Props {
  composition: PortfolioComposition;
  accentColor: string;
}

export function PortfolioComposition({ composition, accentColor }: Props) {
  const [view, setView] = useState<ViewKey>("sector");
  const [selected, setSelected] = useState<string | null>(null);

  const slices = useMemo<CompositionSlice[]>(() => {
    if (view === "sector") return composition.bySector;
    if (view === "industry") return composition.byIndustry;
    return composition.byMarketCap;
  }, [view, composition]);

  const selectedSlice = useMemo(
    () => slices.find((s) => s.key === selected) ?? null,
    [selected, slices]
  );

  return (
    <div className="px-4 mt-8">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[15px] font-semibold text-zinc-300">Portfolio breakdown</h2>
        <ViewTabs value={view} onChange={(v) => { setView(v); setSelected(null); }} />
      </div>

      <div className="rounded-2xl bg-zinc-900/70 border border-zinc-800 p-4">
        <ParentSize debounceTime={50}>
          {({ width }) => (
            <DonutChart
              width={width}
              height={300}
              slices={slices}
              selected={selected}
              onSelect={(k) => setSelected((cur) => (cur === k ? null : k))}
              total={composition.totalValue}
              accentColor={accentColor}
            />
          )}
        </ParentSize>

        <div className="mt-4 divide-y divide-zinc-800/70">
          <AnimatePresence mode="wait">
            <motion.div
              key={view + (selectedSlice?.key ?? "all")}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18 }}
            >
              {selectedSlice ? (
                <SliceDetail slice={selectedSlice} />
              ) : (
                <SliceList
                  slices={slices}
                  onSelect={(k) => setSelected(k)}
                  viewLabel={VIEW_LABEL[view]}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      <AboutThisPortfolio analysis={composition.analysis} accentColor={accentColor} />
    </div>
  );
}

// --- View tabs (pill toggle) ----------------------------------------------

function ViewTabs({
  value,
  onChange,
}: {
  value: ViewKey;
  onChange: (v: ViewKey) => void;
}) {
  const tabs: ViewKey[] = ["sector", "industry", "marketcap"];
  return (
    <div className="inline-flex rounded-full bg-zinc-900/70 border border-zinc-800 p-0.5">
      {tabs.map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => onChange(t)}
          className={`px-3 py-1.5 rounded-full text-[11px] font-semibold transition-colors ${
            value === t
              ? "bg-zinc-100 text-zinc-900"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          {VIEW_LABEL[t]}
        </button>
      ))}
    </div>
  );
}

// --- Donut chart ----------------------------------------------------------

interface DonutProps {
  width: number;
  height: number;
  slices: CompositionSlice[];
  selected: string | null;
  onSelect: (key: string) => void;
  total: number;
  accentColor: string;
}

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

function DonutChart({
  width,
  height,
  slices,
  selected,
  onSelect,
  total,
  accentColor,
}: DonutProps) {
  const gradId = useId();
  // Layout. Donut sits centered horizontally; we leave a touch of head/foot
  // room so the popped-out selected slice has somewhere to grow.
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

  // Center readout: selected slice's stats, or aggregate total.
  const centerTop = selectedSlice ? selectedSlice.slice.key : "Total";
  const centerMid = selectedSlice
    ? fmtUSD(selectedSlice.slice.value)
    : fmtUSD(total);
  const centerBot = selectedSlice
    ? `${fmtPct(selectedSlice.slice.pct)} of portfolio`
    : `${slices.reduce((s, x) => s + x.tickers.length, 0)} positions`;

  return (
    <div className="relative">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        aria-label="Portfolio breakdown donut chart"
        style={{ touchAction: "manipulation" }}
      >
        <defs>
          {/* Subtle radial gradient overlay we paint on top of each slice for
              depth — keeps the chart from looking like a flat pie. */}
          <radialGradient id={`${gradId}-shade`} cx="50%" cy="50%" r="50%">
            <stop offset="60%" stopColor="rgba(255,255,255,0)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0.18)" />
          </radialGradient>
        </defs>

        {pieces.map(({ slice, start, end, mid }) => {
          const isSelected = selected === slice.key;
          const isDimmed = selected != null && !isSelected;
          // Selected slice "pops out" a few px along its midpoint axis.
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

        {/* Inner ring border for crispness against either theme. */}
        <circle
          cx={cx}
          cy={cy}
          r={rInner}
          fill="var(--background, #000)"
          pointerEvents="none"
        />

        {/* Center readout */}
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

function SliceList({
  slices,
  onSelect,
  viewLabel,
}: {
  slices: CompositionSlice[];
  onSelect: (k: string) => void;
  viewLabel: string;
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
                {s.tickers.length} position{s.tickers.length === 1 ? "" : "s"}
              </div>
            </div>
            {/* Mini bar showing portfolio share */}
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

function SliceDetail({ slice }: { slice: CompositionSlice }) {
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
                {fmtPct(t.portfolioPct)} of portfolio
              </div>
            </div>
            <div className="text-right">
              <div className="text-[13px] font-semibold text-zinc-100 tabular-nums">
                {fmtUSD(t.value)}
              </div>
              <div className="text-[11px] text-zinc-500 tabular-nums">
                {fmtPct(t.pct)} of slice
              </div>
            </div>
          </Link>
        ))}
      </div>
      <div className="text-[11px] text-zinc-500 mt-2 px-2">
        Tap the slice again to clear.
      </div>
    </div>
  );
}

// --- About this portfolio (Claude analysis) ------------------------------

function AboutThisPortfolio({
  analysis,
  accentColor,
}: {
  analysis: PortfolioAnalysis;
  accentColor: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const showParagraphs = expanded ? analysis.paragraphs : analysis.paragraphs.slice(0, 1);

  return (
    <div className="mt-5">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-[15px] font-semibold text-zinc-300">About this portfolio</h2>
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-zinc-500">
          <span style={{ color: accentColor }}>✦</span>
          <span>Claude analysis</span>
        </div>
      </div>
      <div className="rounded-2xl bg-zinc-900/70 border border-zinc-800 p-4 space-y-3 relative overflow-hidden">
        {/* Faint accent gradient in the corner — gives the card a touch of
            "this was synthesized" energy without being shouty. */}
        <div
          aria-hidden
          className="absolute -top-12 -right-12 w-40 h-40 rounded-full pointer-events-none"
          style={{
            background: `radial-gradient(circle, ${accentColor}1f, transparent 70%)`,
          }}
        />

        <div className="relative">
          <div
            className="inline-flex items-center gap-2 px-2 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wide"
            style={{
              backgroundColor: `${accentColor}1f`,
              color: accentColor,
            }}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: accentColor }} />
            {analysis.styleLabel}
          </div>
          <p className="mt-3 text-[14px] leading-snug font-semibold text-zinc-100">
            {analysis.headline}
          </p>
        </div>

        <div className="relative space-y-3">
          {showParagraphs.map((p, i) => (
            <p key={i} className="text-[13px] leading-relaxed text-zinc-300">
              {p}
            </p>
          ))}
          {analysis.paragraphs.length > 1 && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="text-[12px] text-zinc-500 hover:text-zinc-300"
            >
              {expanded ? "Show less" : "Read full analysis"}
            </button>
          )}
        </div>

        {analysis.themes.length > 0 && (
          <div className="relative pt-1">
            <div className="text-[11px] uppercase tracking-wide text-zinc-500 mb-2">
              Themes
            </div>
            <div className="flex flex-wrap gap-1.5">
              {analysis.themes.map((t) => (
                <div
                  key={t.name}
                  className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-zinc-800/70 border border-zinc-700/60"
                >
                  <span className="text-[11px] font-medium text-zinc-200">
                    {t.name}
                  </span>
                  <span className="text-[10px] text-zinc-500">
                    {t.tickers.length}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="relative grid grid-cols-2 sm:grid-cols-3 gap-2 pt-2">
          {analysis.highlights.map((h) => (
            <div
              key={h.label}
              className="rounded-lg bg-zinc-800/40 border border-zinc-800 px-2.5 py-1.5"
            >
              <div className="text-[10px] uppercase tracking-wide text-zinc-500">
                {h.label}
              </div>
              <div
                className="text-[12px] font-semibold tabular-nums truncate"
                style={{ color: h.tone === "accent" ? accentColor : undefined }}
              >
                {h.value}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
