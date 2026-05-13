"use client";

import { useMemo, useState } from "react";
import { Bar, Circle, LinePath } from "@visx/shape";
import { scaleBand, scaleLinear } from "@visx/scale";
import { curveMonotoneX } from "@visx/curve";
import { ParentSize } from "@visx/responsive";
import {
  fmtAxisMoney,
  fmtCount,
  fmtEPS,
  fmtMarketCap,
  fmtMoneyShort,
  fmtPctPoints,
  fmtPeriodLabel,
  fmtRatio,
} from "@/lib/fundamentals";
import type {
  EarningsRow,
  FinancialsRow,
  TickerFundamentals,
} from "@/lib/types";

const REVENUE_COLOR = "#00C805";        // Robinhood green
const GROSS_PROFIT_COLOR = "#F26B3A";   // dark orange
const NET_INCOME_COLOR = "#F4A87E";     // light orange
// The Net margin line + dots need to read on BOTH the dark and light theme
// backgrounds. Pure white worked on dark but vanished on light, and pure
// black does the opposite. globals.css already exposes --foreground (white
// in dark mode, near-black in light mode) and --background (the inverse),
// so the line uses --foreground for max contrast and the dot fills use
// --background so each dot reads as a hollow circle ringed by the line's
// color — same look in both themes.
const MARGIN_LINE_VAR = "var(--foreground, #71717a)";
const MARGIN_DOT_FILL_VAR = "var(--background, #0a0a0a)";
const EST_DOT_COLOR = "#7CCB80";        // light green = estimate
const ACT_DOT_COLOR = "#00C805";        // brand green = actual

interface Props {
  fundamentals: TickerFundamentals | null;
  accentColor: string;
}

/**
 * The full "About / Financials / Earnings" section for /stock/[ticker].
 * Renders three subsections — each is independently hidden when the
 * underlying data is missing, so a ticker with only a description still
 * shows the About card without empty chart slots below it.
 */
export function FundamentalsPanel({ fundamentals, accentColor }: Props) {
  if (!fundamentals) return null;
  const hasFinancials =
    fundamentals.financials.quarterly.length > 0 ||
    fundamentals.financials.annual.length > 0;
  const hasEarnings =
    fundamentals.earnings.quarterly.length > 0 ||
    fundamentals.earnings.annual.length > 0;
  return (
    <div className="space-y-6 mt-6">
      <AboutCard fundamentals={fundamentals} />
      {hasFinancials && (
        <FinancialsSection fundamentals={fundamentals} accentColor={accentColor} />
      )}
      {hasEarnings && (
        <EarningsSection fundamentals={fundamentals} accentColor={accentColor} />
      )}
    </div>
  );
}

// --------------------------------------------------------------------- About

function AboutCard({ fundamentals: f }: { fundamentals: TickerFundamentals }) {
  const [expanded, setExpanded] = useState(false);
  const description = f.description;
  const stats: Array<[string, string]> = [
    ["Market cap", fmtMarketCap(f.marketCap)],
    ["P/E ratio", fmtRatio(f.peRatio)],
    ["Forward P/E", fmtRatio(f.forwardPE)],
    ["EPS (TTM)", fmtEPS(f.eps)],
    [
      "52-week range",
      f.fiftyTwoWeekRange &&
      f.fiftyTwoWeekRange[0] != null &&
      f.fiftyTwoWeekRange[1] != null
        ? `$${f.fiftyTwoWeekRange[0].toFixed(2)} – $${f.fiftyTwoWeekRange[1].toFixed(2)}`
        : "—",
    ],
    ["Beta", fmtRatio(f.beta)],
    ["Dividend yield", fmtPctPoints(f.dividendYield)],
    ["Sector", f.sector ?? "—"],
    ["Industry", f.industry ?? "—"],
    ["Headquarters", f.headquarters ?? "—"],
    ["Employees", fmtCount(f.employees)],
    ["Exchange", f.exchange ?? "—"],
  ];
  // Hide rows where the value is "—" so unsupported tickers don't show a
  // wall of empty stats.
  const populated = stats.filter(([, v]) => v !== "—");
  const showAbout = description || populated.length > 0;
  if (!showAbout) return null;

  // First two short paragraphs of the description; user can expand.
  const truncated =
    description && description.length > 400 && !expanded
      ? description.slice(0, 400).trimEnd() + "…"
      : description;

  return (
    <div className="px-4">
      <h2 className="text-[15px] font-semibold text-zinc-300 mb-2">About</h2>
      <div className="rounded-2xl bg-zinc-900/70 border border-zinc-800 p-4 space-y-4">
        {description && (
          <div>
            <p className="text-[13px] leading-relaxed text-zinc-300 whitespace-pre-line">
              {truncated}
            </p>
            {description.length > 400 && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="mt-2 text-[12px] text-zinc-500 hover:text-zinc-300"
              >
                {expanded ? "Show less" : "Show more"}
              </button>
            )}
          </div>
        )}
        {populated.length > 0 && (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 pt-1">
            {populated.map(([label, value]) => (
              <div key={label} className="flex flex-col">
                <dt className="text-[11px] uppercase tracking-wide text-zinc-500">
                  {label}
                </dt>
                <dd className="text-[13px] tabular-nums text-zinc-200">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        )}
        {f.website && (
          <a
            href={f.website}
            target="_blank"
            rel="noreferrer"
            className="inline-block text-[12px] text-zinc-400 hover:text-zinc-200 underline"
          >
            {f.website.replace(/^https?:\/\//, "").replace(/\/$/, "")} ↗
          </a>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Financials

type Granularity = "quarterly" | "annual";

function GranularityTabs({
  value,
  onChange,
}: {
  value: Granularity;
  onChange: (v: Granularity) => void;
}) {
  return (
    <div className="inline-flex rounded-full bg-zinc-900/70 border border-zinc-800 p-0.5">
      {(["quarterly", "annual"] as const).map((g) => (
        <button
          key={g}
          type="button"
          onClick={() => onChange(g)}
          className={`px-4 py-1.5 rounded-full text-[12px] font-semibold transition-colors ${
            value === g
              ? "bg-zinc-100 text-zinc-900"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          {g === "quarterly" ? "Quarterly" : "Annual"}
        </button>
      ))}
    </div>
  );
}

function FinancialsSection({
  fundamentals: f,
}: {
  fundamentals: TickerFundamentals;
  accentColor: string;
}) {
  const [g, setG] = useState<Granularity>("quarterly");
  const [showTable, setShowTable] = useState(false);
  const rows = g === "quarterly" ? f.financials.quarterly : f.financials.annual;
  // Limit to 5 most recent periods (matches Robinhood's display density).
  const recent = rows.slice(-5);
  return (
    <div className="px-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[15px] font-semibold text-zinc-300">Financials</h2>
        <GranularityTabs value={g} onChange={setG} />
      </div>
      <div className="rounded-2xl bg-zinc-900/70 border border-zinc-800 p-4">
        <FinancialsLegend />
        {recent.length === 0 ? (
          <p className="text-[12px] text-zinc-500 mt-4">
            No {g} data available.
          </p>
        ) : (
          <>
            <div className="mt-3">
              <ParentSize debounceTime={50}>
                {({ width }) => (
                  <FinancialsChart
                    width={width}
                    height={260}
                    rows={recent}
                    granularity={g}
                  />
                )}
              </ParentSize>
            </div>
            <button
              type="button"
              onClick={() => setShowTable((v) => !v)}
              className="mt-3 text-[12px] text-zinc-500 hover:text-zinc-300"
            >
              {showTable ? "Hide numbers" : "Show numbers"}
            </button>
            {showTable && <FinancialsTable rows={recent} granularity={g} />}
          </>
        )}
      </div>
    </div>
  );
}

function FinancialsTable({
  rows,
  granularity,
}: {
  rows: FinancialsRow[];
  granularity: Granularity;
}) {
  // Show one card per period (mobile-first; horizontal table would overflow
  // narrow widths and the net-margin column especially can be thousands of %
  // for unprofitable companies). Reverse so the most recent period is on top.
  const ordered = [...rows].reverse();
  return (
    <div className="mt-3 space-y-2">
      {ordered.map((r) => {
        const { primary, secondary } = fmtPeriodLabel(r.date, granularity);
        const label = secondary ? `${primary} ${secondary}` : primary;
        const fields: Array<[string, string]> = [
          ["Revenue", fmtMoneyShort(r.revenue)],
          ["Gross profit", fmtMoneyShort(r.grossProfit)],
          ["Net income", fmtMoneyShort(r.netIncome)],
          ["Net margin", fmtPctPoints(r.netMargin)],
        ];
        return (
          <div
            key={r.date}
            className="rounded-lg bg-zinc-800/40 border border-zinc-800 px-3 py-2"
          >
            <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400 mb-1">
              {label}
            </div>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
              {fields.map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between">
                  <dt className="text-[11px] text-zinc-500">{k}</dt>
                  <dd className="text-[12px] tabular-nums text-zinc-200">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        );
      })}
    </div>
  );
}

function FinancialsLegend() {
  const items: Array<[string, string, "square" | "line"]> = [
    ["Revenue", REVENUE_COLOR, "square"],
    ["Gross profit", GROSS_PROFIT_COLOR, "square"],
    ["Net income", NET_INCOME_COLOR, "square"],
    ["Net margin", MARGIN_LINE_VAR, "line"],
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-zinc-400">
      {items.map(([label, color, shape]) => (
        <div key={label} className="flex items-center gap-1.5">
          {shape === "square" ? (
            <span
              className="inline-block w-2.5 h-2.5 rounded-sm"
              style={{ backgroundColor: color }}
            />
          ) : (
            <span
              className="inline-block w-2.5 h-2.5 rounded-full border-2"
              style={{ borderColor: color }}
            />
          )}
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
}

function FinancialsChart({
  width,
  height,
  rows,
  granularity,
}: {
  width: number;
  height: number;
  rows: FinancialsRow[];
  granularity: Granularity;
}) {
  const PAD_LEFT = 44;
  const PAD_RIGHT = 8;
  const PAD_TOP = 8;
  const PAD_BOTTOM = 36;
  const innerW = Math.max(width - PAD_LEFT - PAD_RIGHT, 50);
  const innerH = Math.max(height - PAD_TOP - PAD_BOTTOM, 50);

  // Y domain — dollars from min of all three series to max, padded ±10%.
  // Always includes 0 so the zero-line stays visible.
  const { yMin, yMax } = useMemo(() => {
    let lo = 0,
      hi = 0;
    for (const r of rows) {
      for (const v of [r.revenue, r.grossProfit, r.netIncome]) {
        if (v == null) continue;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    if (lo === hi) {
      lo = -1;
      hi = 1;
    }
    const pad = (hi - lo) * 0.1;
    return { yMin: lo - pad, yMax: hi + pad };
  }, [rows]);

  // Net margin range — scale separately so the line fits inside the same
  // chart area regardless of its magnitude. Robinhood does the same thing
  // visually; the line is a trend indicator, not a ruler.
  const { marginMin, marginMax } = useMemo(() => {
    let lo = Infinity,
      hi = -Infinity;
    for (const r of rows) {
      if (r.netMargin == null) continue;
      if (r.netMargin < lo) lo = r.netMargin;
      if (r.netMargin > hi) hi = r.netMargin;
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
      return { marginMin: -1, marginMax: 1 };
    }
    if (lo === hi) {
      lo -= Math.abs(lo) * 0.5 + 0.1;
      hi += Math.abs(hi) * 0.5 + 0.1;
    }
    const pad = (hi - lo) * 0.15;
    return { marginMin: lo - pad, marginMax: hi + pad };
  }, [rows]);

  const xScale = useMemo(
    () =>
      scaleBand<number>({
        domain: rows.map((_, i) => i),
        range: [0, innerW],
        padding: 0.3,
      }),
    [rows, innerW]
  );

  const yScale = useMemo(
    () =>
      scaleLinear<number>({
        domain: [yMin, yMax],
        range: [innerH, 0],
      }),
    [yMin, yMax, innerH]
  );

  const marginScale = useMemo(
    () =>
      scaleLinear<number>({
        domain: [marginMin, marginMax],
        range: [innerH, 0],
      }),
    [marginMin, marginMax, innerH]
  );

  const groupBandWidth = xScale.bandwidth();
  const barWidth = groupBandWidth / 3.5;

  const zeroY = yScale(0);

  // 4 horizontal grid lines, evenly distributed across the y-domain.
  const yTicks = useMemo(() => {
    const ticks: number[] = [];
    for (let i = 0; i <= 3; i++) {
      const v = yMin + (i / 3) * (yMax - yMin);
      ticks.push(v);
    }
    return ticks;
  }, [yMin, yMax]);

  const zeroInRange = yMin <= 0 && yMax >= 0;

  return (
    <svg width={width} height={height} aria-hidden>
      <g transform={`translate(${PAD_LEFT}, ${PAD_TOP})`}>
        {/* Horizontal grid lines (dashed, subtle). Skip the tick nearest to
            zero — the dedicated zero line below will sit there instead. */}
        {yTicks.map((v, i) => (
          <g key={i}>
            <line
              x1={0}
              x2={innerW}
              y1={yScale(v)}
              y2={yScale(v)}
              stroke="var(--chart-baseline)"
              strokeWidth={1}
              strokeDasharray="2 3"
            />
            <text
              x={-6}
              y={yScale(v)}
              dy="0.32em"
              textAnchor="end"
              fontSize={10}
              fill="#71717a"
            >
              {fmtAxisMoney(v)}
            </text>
          </g>
        ))}

        {/* Zero reference line — solid, theme-aware, more prominent than the
            grid so positive vs. negative bars read clearly. */}
        {zeroInRange && (
          <g>
            <line
              x1={0}
              x2={innerW}
              y1={zeroY}
              y2={zeroY}
              stroke="var(--chart-axis-label)"
              strokeWidth={1.25}
            />
            <text
              x={-6}
              y={zeroY}
              dy="0.32em"
              textAnchor="end"
              fontSize={10}
              fill="var(--chart-axis-label)"
              fontWeight={600}
            >
              0
            </text>
          </g>
        )}

        {/* Bars per period */}
        {rows.map((r, i) => {
          const groupX = xScale(i) ?? 0;
          return (
            <g key={i}>
              {r.revenue != null && (
                <Bar
                  x={groupX}
                  y={r.revenue >= 0 ? yScale(r.revenue) : zeroY}
                  width={barWidth}
                  height={Math.abs(yScale(r.revenue) - zeroY)}
                  fill={REVENUE_COLOR}
                  rx={1}
                />
              )}
              {r.grossProfit != null && (
                <Bar
                  x={groupX + barWidth + 2}
                  y={r.grossProfit >= 0 ? yScale(r.grossProfit) : zeroY}
                  width={barWidth}
                  height={Math.abs(yScale(r.grossProfit) - zeroY)}
                  fill={GROSS_PROFIT_COLOR}
                  rx={1}
                />
              )}
              {r.netIncome != null && (
                <Bar
                  x={groupX + 2 * (barWidth + 2)}
                  y={r.netIncome >= 0 ? yScale(r.netIncome) : zeroY}
                  width={barWidth}
                  height={Math.abs(yScale(r.netIncome) - zeroY)}
                  fill={NET_INCOME_COLOR}
                  rx={1}
                />
              )}
            </g>
          );
        })}

        {/* Net margin overlay line, scaled to its own y-range (visual trend
            indicator, not read off the dollar axis). */}
        {rows.some((r) => r.netMargin != null) && (
          <LinePath
            data={rows.filter((r) => r.netMargin != null)}
            x={(r) =>
              (xScale(rows.indexOf(r)) ?? 0) + groupBandWidth / 2
            }
            y={(r) => marginScale(r.netMargin as number)}
            stroke={MARGIN_LINE_VAR}
            strokeWidth={1.5}
            curve={curveMonotoneX}
          />
        )}
        {rows.map((r, i) =>
          r.netMargin != null ? (
            <Circle
              key={`mg-${i}`}
              cx={(xScale(i) ?? 0) + groupBandWidth / 2}
              cy={marginScale(r.netMargin)}
              r={3}
              fill={MARGIN_DOT_FILL_VAR}
              stroke={MARGIN_LINE_VAR}
              strokeWidth={1.5}
            />
          ) : null
        )}

        {/* X-axis labels (period) */}
        {rows.map((r, i) => {
          const { primary, secondary } = fmtPeriodLabel(r.date, granularity);
          const cx = (xScale(i) ?? 0) + groupBandWidth / 2;
          return (
            <g key={`x-${i}`}>
              <text
                x={cx}
                y={innerH + 14}
                textAnchor="middle"
                fontSize={11}
                fill="#a1a1aa"
              >
                {primary}
              </text>
              {secondary && (
                <text
                  x={cx}
                  y={innerH + 28}
                  textAnchor="middle"
                  fontSize={10}
                  fill="#71717a"
                >
                  {secondary}
                </text>
              )}
            </g>
          );
        })}
      </g>
    </svg>
  );
}

// ------------------------------------------------------------------ Earnings

function EarningsSection({
  fundamentals: f,
}: {
  fundamentals: TickerFundamentals;
  accentColor: string;
}) {
  const [showTable, setShowTable] = useState(false);
  // Quarterly-only (annual rollup was ambiguous when companies have partial
  // years and the user didn't want the toggle here — earnings cadence is
  // quarterly anyway).
  const recent = f.earnings.quarterly.slice(-5);
  return (
    <div className="px-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[15px] font-semibold text-zinc-300">Earnings</h2>
      </div>
      <div className="rounded-2xl bg-zinc-900/70 border border-zinc-800 p-4">
        <EarningsLegend />
        {recent.length === 0 ? (
          <p className="text-[12px] text-zinc-500 mt-4">
            No quarterly earnings data available.
          </p>
        ) : (
          <>
            <div className="mt-3">
              <ParentSize debounceTime={50}>
                {({ width }) => (
                  <EarningsChart width={width} height={220} rows={recent} />
                )}
              </ParentSize>
            </div>
            <button
              type="button"
              onClick={() => setShowTable((v) => !v)}
              className="mt-3 text-[12px] text-zinc-500 hover:text-zinc-300"
            >
              {showTable ? "Hide numbers" : "Show numbers"}
            </button>
            {showTable && <EarningsTable rows={recent} />}
          </>
        )}
      </div>
    </div>
  );
}

function EarningsTable({ rows }: { rows: EarningsRow[] }) {
  const ordered = [...rows].reverse();
  return (
    <div className="mt-3 space-y-2">
      {ordered.map((r) => {
        const { primary, secondary } = fmtPeriodLabel(r.date, "quarterly");
        const label = secondary ? `${primary} ${secondary}` : primary;
        const fields: Array<[string, string]> = [
          ["Estimate", fmtEPS(r.epsEstimate)],
          ["Actual", fmtEPS(r.epsActual)],
          ["Surprise", r.surprise == null ? "—" : fmtEPS(r.surprise)],
        ];
        return (
          <div
            key={r.date}
            className="rounded-lg bg-zinc-800/40 border border-zinc-800 px-3 py-2"
          >
            <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400 mb-1">
              {label}
            </div>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
              {fields.map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between">
                  <dt className="text-[11px] text-zinc-500">{k}</dt>
                  <dd className="text-[12px] tabular-nums text-zinc-200">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        );
      })}
    </div>
  );
}

function EarningsLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-zinc-400">
      <div className="flex items-center gap-1.5">
        <span
          className="inline-block w-2.5 h-2.5 rounded-full"
          style={{ backgroundColor: EST_DOT_COLOR }}
        />
        <span>Estimate</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span
          className="inline-block w-2.5 h-2.5 rounded-full"
          style={{ backgroundColor: ACT_DOT_COLOR }}
        />
        <span>Actual</span>
      </div>
    </div>
  );
}

function EarningsChart({
  width,
  height,
  rows,
}: {
  width: number;
  height: number;
  rows: EarningsRow[];
}) {
  const PAD_LEFT = 44;
  const PAD_RIGHT = 8;
  const PAD_TOP = 8;
  const PAD_BOTTOM = 36;
  const innerW = Math.max(width - PAD_LEFT - PAD_RIGHT, 50);
  const innerH = Math.max(height - PAD_TOP - PAD_BOTTOM, 50);

  const { yMin, yMax } = useMemo(() => {
    let lo = Infinity,
      hi = -Infinity;
    for (const r of rows) {
      for (const v of [r.epsActual, r.epsEstimate]) {
        if (v == null) continue;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
      return { yMin: -1, yMax: 1 };
    }
    // Always include 0 in the y-domain — for companies with all-negative EPS
    // (most growth-stage tickers in the roster), this puts a visible
    // breakeven reference line at the top of the chart so the user can see
    // how far below profitability the dots are sitting.
    lo = Math.min(lo, 0);
    hi = Math.max(hi, 0);
    if (lo === hi) {
      lo -= Math.abs(lo) * 0.5 + 0.1;
      hi += Math.abs(hi) * 0.5 + 0.1;
    }
    const pad = (hi - lo) * 0.2;
    return { yMin: lo - pad, yMax: hi + pad };
  }, [rows]);

  const xScale = useMemo(
    () =>
      scaleBand<number>({
        domain: rows.map((_, i) => i),
        range: [0, innerW],
        padding: 0.2,
      }),
    [rows, innerW]
  );
  const yScale = useMemo(
    () =>
      scaleLinear<number>({
        domain: [yMin, yMax],
        range: [innerH, 0],
      }),
    [yMin, yMax, innerH]
  );
  const groupBandWidth = xScale.bandwidth();

  const yTicks = useMemo(() => {
    const ticks: number[] = [];
    for (let i = 0; i <= 3; i++) {
      ticks.push(yMin + (i / 3) * (yMax - yMin));
    }
    return ticks;
  }, [yMin, yMax]);

  const zeroInRange = yMin <= 0 && yMax >= 0;

  return (
    <svg width={width} height={height} aria-hidden>
      <g transform={`translate(${PAD_LEFT}, ${PAD_TOP})`}>
        {yTicks.map((v, i) => (
          <g key={i}>
            <line
              x1={0}
              x2={innerW}
              y1={yScale(v)}
              y2={yScale(v)}
              stroke="var(--chart-baseline)"
              strokeWidth={1}
              strokeDasharray="2 3"
            />
            <text
              x={-6}
              y={yScale(v)}
              dy="0.32em"
              textAnchor="end"
              fontSize={10}
              fill="#71717a"
            >
              {v < 0 ? `-$${Math.abs(v).toFixed(2)}` : `$${v.toFixed(2)}`}
            </text>
          </g>
        ))}
        {/* Breakeven (zero) reference line — same treatment as the financials
            chart so the "above/below zero" read is consistent. */}
        {zeroInRange && (
          <g>
            <line
              x1={0}
              x2={innerW}
              y1={yScale(0)}
              y2={yScale(0)}
              stroke="var(--chart-axis-label)"
              strokeWidth={1.25}
            />
            <text
              x={-6}
              y={yScale(0)}
              dy="0.32em"
              textAnchor="end"
              fontSize={10}
              fill="var(--chart-axis-label)"
              fontWeight={600}
            >
              $0
            </text>
          </g>
        )}
        {/* Dots — estimate and actual at the SAME x position so the user can
            read the surprise at a glance: stacked vertically when the actual
            missed/beat by a lot, overlapping (concentric) when the actual
            landed near consensus. No connector line — earlier draft used
            one but it added visual noise without conveying meaning beyond
            what dot positions already show. Estimate drawn first so the
            actual sits on top; estimate is slightly larger so when they
            overlap the lighter estimate's ring frames the darker actual. */}
        {rows.map((r, i) => {
          const cx = (xScale(i) ?? 0) + groupBandWidth / 2;
          return (
            <g key={`d-${i}`}>
              {r.epsEstimate != null && (
                <Circle
                  cx={cx}
                  cy={yScale(r.epsEstimate)}
                  r={6}
                  fill={EST_DOT_COLOR}
                  fillOpacity={0.7}
                />
              )}
              {r.epsActual != null && (
                <Circle
                  cx={cx}
                  cy={yScale(r.epsActual)}
                  r={5}
                  fill={ACT_DOT_COLOR}
                />
              )}
            </g>
          );
        })}
        {/* X-axis labels */}
        {rows.map((r, i) => {
          const { primary, secondary } = fmtPeriodLabel(r.date, "quarterly");
          const cx = (xScale(i) ?? 0) + groupBandWidth / 2;
          return (
            <g key={`x-${i}`}>
              <text
                x={cx}
                y={innerH + 14}
                textAnchor="middle"
                fontSize={11}
                fill="#a1a1aa"
              >
                {primary}
              </text>
              {secondary && (
                <text
                  x={cx}
                  y={innerH + 28}
                  textAnchor="middle"
                  fontSize={10}
                  fill="#71717a"
                >
                  {secondary}
                </text>
              )}
            </g>
          );
        })}
      </g>
    </svg>
  );
}

