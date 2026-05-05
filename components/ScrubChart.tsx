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
}

export function ScrubChart({
  series,
  baseline,
  height = 260,
  onScrub,
  xDomain,
  liveEndpoint,
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
            />
          ) : null
        }
      </ParentSize>
    </div>
  );
}

const PAD_TOP = 24;
const PAD_BOTTOM = 8;

function ScrubChartInner({
  width,
  height,
  series,
  baseline,
  onScrub,
  xDomain,
  liveEndpoint,
}: {
  width: number;
  height: number;
  series: ChartSeries[];
  baseline?: number;
  onScrub?: (s: ScrubState | null) => void;
  xDomain?: [Date, Date];
  liveEndpoint?: boolean;
}) {
  const dates = useMemo(() => {
    const longest = series.reduce(
      (acc, s) => (s.data.length > acc.data.length ? s : acc),
      series[0]
    );
    // Date strings here can be either "YYYY-MM-DD" (daily) or full ISO (intraday).
    return longest?.data.map((d) => new Date(d.date.length > 10 ? d.date : d.date + "T00:00:00Z")) ?? [];
  }, [series]);

  const xScale = useMemo(() => {
    if (xDomain) {
      return scaleTime({ domain: xDomain, range: [0, width] });
    }
    if (dates.length === 0) return null;
    return scaleTime({
      domain: [dates[0], dates[dates.length - 1]],
      range: [0, width],
    });
  }, [dates, width, xDomain]);

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
      if (!containerRef.current || !xScale || dates.length === 0) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = Math.max(0, Math.min(width, clientX - rect.left));
      const xDate = xScale.invert(x);
      const idx = Math.min(
        dates.length - 1,
        Math.max(0, dateBisect(dates, xDate))
      );
      const left = dates[Math.max(0, idx - 1)];
      const right = dates[idx];
      const finalIdx =
        idx > 0 &&
        Math.abs(left.getTime() - xDate.getTime()) <
          Math.abs(right.getTime() - xDate.getTime())
          ? idx - 1
          : idx;
      reportScrub(finalIdx);
    },
    [xScale, dates, width, dateBisect, reportScrub]
  );

  if (!xScale || !yScale || dates.length === 0) return null;

  const baselineY = baseline !== undefined ? yScale(baseline) : null;

  return (
    <svg
      ref={containerRef}
      width={width}
      height={height}
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
          stroke="rgba(255,255,255,0.12)"
          strokeWidth={1}
          strokeDasharray="3,4"
        />
      )}

      {series.map((s) => (
        <g key={`area-${s.id}`}>
          <AreaClosed
            data={s.data}
            x={(_, i) => xScale(dates[i])}
            y={(d) => yScale(d.value)}
            yScale={yScale}
            fill={`url(#grad-${s.id})`}
            curve={curveMonotoneX}
          />
        </g>
      ))}

      {series.map((s) => (
        <LinePath
          key={`line-${s.id}`}
          data={s.data}
          x={(_, i) => xScale(dates[i])}
          y={(d) => yScale(d.value)}
          stroke={s.color}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          curve={curveMonotoneX}
        />
      ))}

      {liveEndpoint && scrubIdx == null &&
        series.map((s) => {
          const last = s.data[s.data.length - 1];
          if (!last) return null;
          const cx = xScale(dates[s.data.length - 1]);
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
            from={{ x: xScale(dates[scrubIdx]), y: PAD_TOP - 8 }}
            to={{ x: xScale(dates[scrubIdx]), y: height - PAD_BOTTOM }}
            stroke="rgba(255,255,255,0.35)"
            strokeWidth={1}
          />
          {series.map((s) => {
            const v = s.data[scrubIdx]?.value;
            if (v == null) return null;
            return (
              <g key={`pt-${s.id}`}>
                <circle
                  cx={xScale(dates[scrubIdx])}
                  cy={yScale(v)}
                  r={6}
                  fill={s.color}
                  opacity={0.25}
                />
                <circle
                  cx={xScale(dates[scrubIdx])}
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
