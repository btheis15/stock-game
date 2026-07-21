"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { scaleLinear, scaleTime } from "@visx/scale";
import { LinePath, AreaClosed, Line } from "@visx/shape";
import { LinearGradient } from "@visx/gradient";
import { curveMonotoneX } from "@visx/curve";
import { ParentSize } from "@visx/responsive";
import { bisector } from "d3-array";

export interface ChartSeries {
  id: string;
  color: string;
  data: { date: string; value: number }[];
}

export interface ScrubState {
  index: number;
  date: string;
  values: { id: string; value: number }[];
}

interface Props {
  series: ChartSeries[];
  baseline?: number;
  height?: number;
  onScrub?: (s: ScrubState | null) => void;
  /** When set, force the x-axis to span this date range (used by 1D view). */
  xDomain?: [Date, Date];
  /** When true, draw a pulsing ring at the most recent data point. */
  liveEndpoint?: boolean;
  /**
   * When true, the x-axis is index-based (uniform spacing per data point)
   * instead of time-based. Use this for ranges where the bars are intraday
   * across multiple trading days (the 1W view) so overnight + weekend gaps
   * collapse and the line is continuous, Robinhood-style.
   */
  compactX?: boolean;
}

export function ScrubChart({
  series,
  baseline,
  height = 260,
  onScrub,
  xDomain,
  liveEndpoint,
  compactX,
}: Props) {
  return (
    <div style={{ height }} className="relative w-full select-none">
      <ParentSize debounceTime={20}>
        {({ width, height: h }) =>
          width > 0 && h > 0 ? (
            <ScrubChartInner
              width={width}
              height={h}
              series={series}
              baseline={baseline}
              onScrub={onScrub}
              xDomain={xDomain}
              liveEndpoint={liveEndpoint}
              compactX={compactX}
            />
          ) : null
        }
      </ParentSize>
    </div>
  );
}

const PAD_TOP = 24;
// Bottom padding now reserves room for x-axis tick labels (date / time markers).
// The line itself draws within yScale's range = [height - PAD_BOTTOM, PAD_TOP];
// labels render in the strip below at y = height - LABEL_BASELINE_OFFSET.
const PAD_BOTTOM = 28;
const LABEL_BASELINE_OFFSET = 8;
// Inset for tick labels at the very edges of the chart so "Fri" and "Thu"
// don't hug the screen border. Applied only to label positioning — the data
// line / area / scrub still extend edge-to-edge.
const LABEL_EDGE_PAD = 12;

function ScrubChartInner({
  width,
  height,
  series,
  baseline,
  onScrub,
  xDomain,
  liveEndpoint,
  compactX,
}: {
  width: number;
  height: number;
  series: ChartSeries[];
  baseline?: number;
  onScrub?: (s: ScrubState | null) => void;
  xDomain?: [Date, Date];
  liveEndpoint?: boolean;
  compactX?: boolean;
}) {
  const dates = useMemo(() => {
    const longest = series.reduce(
      (acc, s) => (s.data.length > acc.data.length ? s : acc),
      series[0]
    );
    // Date strings here can be either "YYYY-MM-DD" (daily) or full ISO (intraday).
    return longest?.data.map((d) => new Date(d.date.length > 10 ? d.date : d.date + "T00:00:00Z")) ?? [];
  }, [series]);

  // Signature of the plotted window. Changes on a range switch (different
  // first date / point count / series set) but NOT on scrub or re-render —
  // used to key the path groups below so the draw-in replays exactly when
  // the user is looking at a new window.
  const drawKey = useMemo(
    () =>
      `${series.map((s) => s.id).join(",")}|${dates.length}|${
        dates[0]?.getTime() ?? 0
      }`,
    [series, dates]
  );

  // In compactX mode the x-axis is index-based (one slot per data point) so
  // overnight / weekend gaps disappear visually. Tick labels are placed at
  // day-boundary indices and labeled with the date there.
  const indexScale = useMemo(() => {
    if (!compactX || dates.length === 0) return null;
    return scaleLinear({
      domain: [0, Math.max(1, dates.length - 1)],
      range: [0, width],
    });
  }, [compactX, dates.length, width]);

  const timeScale = useMemo(() => {
    if (compactX) return null;
    if (xDomain) {
      return scaleTime({ domain: xDomain, range: [0, width] });
    }
    if (dates.length === 0) return null;
    return scaleTime({
      domain: [dates[0], dates[dates.length - 1]],
      range: [0, width],
    });
  }, [dates, width, xDomain, compactX]);

  // x-pixel for a given data-point index. Branches once at the top of the
  // render so the rest of the SVG is identical between modes.
  const xAt = (i: number): number => {
    if (compactX && indexScale) return indexScale(i);
    if (timeScale) return timeScale(dates[i]);
    return 0;
  };

  const yScale = useMemo(() => {
    if (series.length === 0) return null;
    let min = Infinity;
    let max = -Infinity;
    for (const s of series) {
      for (const d of s.data) {
        if (d.value < min) min = d.value;
        if (d.value > max) max = d.value;
      }
    }
    if (baseline !== undefined) {
      if (baseline < min) min = baseline;
      if (baseline > max) max = baseline;
    }
    const padding = (max - min) * 0.08 || 1;
    return scaleLinear({
      domain: [min - padding, max + padding],
      range: [height - PAD_BOTTOM, PAD_TOP],
    });
  }, [series, baseline, height]);

  const [scrubIdx, setScrubIdx] = useState<number | null>(null);
  const containerRef = useRef<SVGSVGElement>(null);

  const dateBisect = useMemo(() => bisector<Date, Date>((d) => d).left, []);
  const seriesRef = useRef(series);
  seriesRef.current = series;
  const onScrubRef = useRef(onScrub);
  onScrubRef.current = onScrub;

  const reportScrub = useCallback((idx: number | null) => {
    setScrubIdx(idx);
    const cb = onScrubRef.current;
    if (!cb) return;
    if (idx == null) {
      cb(null);
      return;
    }
    const s = seriesRef.current;
    const date = s[0]?.data[idx]?.date;
    if (!date) return;
    const values = s
      .map((ss) => ({ id: ss.id, value: ss.data[idx]?.value }))
      .filter((v) => v.value != null) as { id: string; value: number }[];
    cb({ index: idx, date, values });
  }, []);

  const handlePointer = useCallback(
    (clientX: number) => {
      if (!containerRef.current || dates.length === 0) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = Math.max(0, Math.min(width, clientX - rect.left));
      let finalIdx: number;
      if (compactX && indexScale) {
        // Index-based: pixel → fractional index → nearest integer.
        const fIdx = (indexScale.invert(x) as number) ?? 0;
        finalIdx = Math.min(
          dates.length - 1,
          Math.max(0, Math.round(fIdx))
        );
      } else if (timeScale) {
        const xDate = timeScale.invert(x);
        const idx = Math.min(
          dates.length - 1,
          Math.max(0, dateBisect(dates, xDate))
        );
        const left = dates[Math.max(0, idx - 1)];
        const right = dates[idx];
        finalIdx =
          idx > 0 &&
          Math.abs(left.getTime() - xDate.getTime()) <
            Math.abs(right.getTime() - xDate.getTime())
            ? idx - 1
            : idx;
      } else {
        return;
      }
      reportScrub(finalIdx);
    },
    [timeScale, indexScale, compactX, dates, width, dateBisect, reportScrub]
  );

  const haveScale = compactX ? indexScale != null : timeScale != null;
  if (!haveScale || !yScale || dates.length === 0) return null;

  const baselineY = baseline !== undefined ? yScale(baseline) : null;

  // X-axis tick labels. Two modes:
  //   • compactX (index-based, gap-collapsed): place a tick at each
  //     trading-day boundary. Format = weekday short ("Mon", "Tue").
  //   • time-based: 3–5 evenly distributed time positions. Format adapts
  //     to span (hour/weekday/month/year).
  const xTicks = compactX
    ? computeXTicksCompact(dates, xAt)
    : computeXTicksTime(timeScale!, width, dates);

  return (
    <svg
      ref={containerRef}
      width={width}
      height={height}
      role="img"
      aria-label={`Price chart, ${series.length} ${series.length === 1 ? "line" : "lines"}, ${dates.length} points`}
      style={{ touchAction: "none", overflow: "visible" }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        handlePointer(e.clientX);
      }}
      onPointerMove={(e) => {
        if (e.buttons === 0 && e.pointerType === "mouse") return;
        if (
          e.currentTarget.hasPointerCapture(e.pointerId) ||
          e.pointerType === "mouse"
        ) {
          handlePointer(e.clientX);
        }
      }}
      onPointerUp={() => reportScrub(null)}
      onPointerCancel={() => reportScrub(null)}
      onPointerLeave={() => reportScrub(null)}
      onMouseLeave={() => reportScrub(null)}
    >
      <defs>
        {series.map((s) => (
          <LinearGradient
            key={s.id}
            id={`grad-${s.id}`}
            from={s.color}
            to={s.color}
            fromOpacity={series.length > 1 ? 0.18 : 0.32}
            toOpacity={0}
          />
        ))}
      </defs>

      {baselineY != null && (
        <Line
          from={{ x: 0, y: baselineY }}
          to={{ x: width, y: baselineY }}
          stroke="var(--chart-baseline)"
          strokeWidth={1}
          strokeDasharray="3,4"
        />
      )}

      {/* drawKey remounts the area+line groups when the plotted window
          changes (range tab, new day), replaying the CSS draw-in. Scrub
          overlays and pointer handling live outside these groups — the §6
          contract (touch-action, pointer capture, no per-frame JS) is
          untouched, and the entrance finishes before a scrub can start. */}
      {series.map((s) => (
        <g key={`area-${drawKey}-${s.id}`} className="chart-area-in">
          <AreaClosed
            data={s.data}
            x={(_, i) => xAt(i)}
            y={(d) => yScale(d.value)}
            yScale={yScale}
            fill={`url(#grad-${s.id})`}
            curve={curveMonotoneX}
          />
        </g>
      ))}

      {series.map((s) => (
        <LinePath
          key={`line-${drawKey}-${s.id}`}
          data={s.data}
          x={(_, i) => xAt(i)}
          y={(d) => yScale(d.value)}
          stroke={s.color}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          curve={curveMonotoneX}
          pathLength={1}
          className="chart-line-draw"
        />
      ))}

      {/* X-axis tick labels — subtle date / time markers along the bottom.
          Edge labels are nudged inward by LABEL_EDGE_PAD so the text doesn't
          hug the screen border. The data line / area still extend full-width. */}
      {xTicks.map((tick, i) => {
        const isFirst = i === 0;
        const isLast = i === xTicks.length - 1;
        const anchor = isFirst ? "start" : isLast ? "end" : "middle";
        const cx = isFirst
          ? Math.max(tick.x, LABEL_EDGE_PAD)
          : isLast
            ? Math.min(tick.x, width - LABEL_EDGE_PAD)
            : tick.x;
        return (
          <text
            key={`tick-${i}`}
            x={cx}
            y={height - LABEL_BASELINE_OFFSET}
            textAnchor={anchor}
            fontSize={10}
            fontWeight={500}
            fill="var(--chart-axis-label)"
            pointerEvents="none"
          >
            {tick.label}
          </text>
        );
      })}

      {liveEndpoint && scrubIdx == null &&
        series.map((s) => {
          const last = s.data[s.data.length - 1];
          if (!last) return null;
          const cx = xAt(s.data.length - 1);
          const cy = yScale(last.value);
          return (
            <g key={`live-${s.id}`} pointerEvents="none">
              <circle
                cx={cx}
                cy={cy}
                r={4}
                fill={s.color}
                style={{ animation: "livePulseFill 1.6s ease-out infinite" }}
              />
              <circle
                cx={cx}
                cy={cy}
                r={4}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                style={{ animation: "livePulseRing 1.6s ease-out infinite" }}
                opacity={0.7}
              />
            </g>
          );
        })}

      {scrubIdx != null && (
        <g pointerEvents="none">
          <Line
            from={{ x: xAt(scrubIdx), y: PAD_TOP - 8 }}
            to={{ x: xAt(scrubIdx), y: height - PAD_BOTTOM }}
            stroke="var(--chart-scrub-line)"
            strokeWidth={1}
          />
          {series.map((s) => {
            const v = s.data[scrubIdx]?.value;
            if (v == null) return null;
            return (
              <g key={`pt-${s.id}`}>
                <circle
                  cx={xAt(scrubIdx)}
                  cy={yScale(v)}
                  r={6}
                  fill={s.color}
                  opacity={0.25}
                />
                <circle
                  cx={xAt(scrubIdx)}
                  cy={yScale(v)}
                  r={3.5}
                  fill={s.color}
                  stroke="#000"
                  strokeWidth={1.5}
                />
              </g>
            );
          })}
        </g>
      )}
    </svg>
  );
}

interface XTick {
  /** Pre-resolved x-pixel position. */
  x: number;
  label: string;
}

/**
 * Time-mode ticks: 3–5 evenly distributed positions across the time domain.
 * Format adapts to the span (hour / weekday / month / year).
 */
function computeXTicksTime(
  timeScale: ReturnType<typeof scaleTime>,
  width: number,
  dates: Date[]
): XTick[] {
  if (dates.length === 0) return [];
  const domain = timeScale.domain();
  const start = domain[0] as Date;
  const end = domain[1] as Date;
  const spanMs = end.getTime() - start.getTime();
  const spanDays = spanMs / 86_400_000;

  const targetCount = Math.max(2, Math.min(5, Math.floor(width / 90)));

  // Generate evenly spaced positions across [start, end]. Using xScale.ticks()
  // would also work but produces non-uniform spacing for sub-day domains.
  const ticks: { date: Date; x: number }[] = [];
  for (let i = 0; i < targetCount; i++) {
    const t = start.getTime() + (spanMs * i) / (targetCount - 1);
    const date = new Date(t);
    ticks.push({ date, x: Number(timeScale(date)) });
  }

  return ticks.map((tk) => ({ x: tk.x, label: formatXTick(tk.date, spanDays) }));
}

/**
 * Compact-mode ticks: place a label at each trading-day boundary in the
 * data-point array. Used when the x-axis is index-based (overnight + weekend
 * gaps are collapsed) so the labels still tell you which day each segment
 * of the line belongs to.
 */
function computeXTicksCompact(
  dates: Date[],
  xAt: (i: number) => number
): XTick[] {
  if (dates.length === 0) return [];
  // Find the index of every distinct trading day's first bar.
  const dayBoundaries: number[] = [0];
  for (let i = 1; i < dates.length; i++) {
    const prev = dates[i - 1];
    const cur = dates[i];
    if (
      prev.getUTCFullYear() !== cur.getUTCFullYear() ||
      prev.getUTCMonth() !== cur.getUTCMonth() ||
      prev.getUTCDate() !== cur.getUTCDate()
    ) {
      dayBoundaries.push(i);
    }
  }
  // Place the tick a hair to the right of the boundary (i.e., at the first
  // bar of that day) so labels don't visually clip with the previous day.
  return dayBoundaries.map((i) => ({
    x: xAt(i),
    label: dates[i].toLocaleDateString("en-US", { weekday: "short" }),
  }));
}

function formatXTick(d: Date, spanDays: number): string {
  if (spanDays < 1) {
    // Intraday: "10am" / "2:30pm"
    return d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: d.getMinutes() === 0 ? undefined : "2-digit",
      hour12: true,
    }).toLowerCase().replace(/\s+/g, "");
  }
  if (spanDays < 14) {
    // ~Week: weekday short
    return d.toLocaleDateString("en-US", { weekday: "short" });
  }
  if (spanDays < 100) {
    // ~Month / quarter: "May 7"
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  if (spanDays < 366) {
    // ~Year: "May"
    return d.toLocaleDateString("en-US", { month: "short" });
  }
  // Multi-year: "May '26"
  const m = d.toLocaleDateString("en-US", { month: "short" });
  const y = String(d.getFullYear()).slice(-2);
  return `${m} '${y}`;
}
