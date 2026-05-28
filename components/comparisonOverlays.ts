"use client";

// Shared comparison-overlay machinery for the player drill-down
// (PortfolioView) and the fund drill-down (FundView). Both pages plot one
// "subject" line ($) and let the user overlay other entities (players, the
// S&P 500, funds) scaled to start at the subject's range-start dollar value,
// so divergence reads as relative performance. The math is identical for both
// pages, so it lives here once.

import { useMemo } from "react";
import { filterRange } from "@/lib/portfolio";
import type { PortfolioPoint, Range } from "@/lib/types";
import type { ChartSeries, ScrubState } from "./ScrubChart";
import type { FilterChipDef } from "./FundsFilter";

export interface IntradayResult {
  points: PortfolioPoint[];
  previousClose: number;
}

/** A line that can be overlaid for comparison — another player, the S&P 500
 *  baseline, or a fund. Same three curves the Compare page builds. */
export interface CompSeries {
  id: string;
  name: string;
  color: string;
  daily: PortfolioPoint[];
  intraday: IntradayResult | null;
  weekly: PortfolioPoint[] | null;
}

export type CompGroup = FilterChipDef["group"];

export interface CompEntity extends CompSeries {
  group: CompGroup;
  defaultOn: boolean;
  /** Where the legend row links (player → /portfolio/{id}, fund → /fund/{id});
   *  null for the S&P 500 baseline, which has no drill-down. */
  href: string | null;
}

export interface LegendRow {
  id: string;
  name: string;
  color: string;
  pct: number;
  isSubject: boolean;
  href: string | null;
}

export function useComparisonOverlays(params: {
  subjectId: string;
  subjectName: string;
  subjectColor: string;
  /** Subject's $ series for the active range (intraday / weekly / daily). */
  ranged: PortfolioPoint[];
  /** Subject's range-start value (previousClose on 1D, else first point). */
  baselineValue: number;
  isIntraday: boolean;
  isWeeklyHourly: boolean;
  range: Range;
  entities: CompEntity[];
  isOn: (id: string, defaultOn: boolean) => boolean;
  scrub: ScrubState | null;
}): {
  filterChips: FilterChipDef[];
  visibleComparisons: CompEntity[];
  chartSeries: ChartSeries[];
  legend: LegendRow[];
} {
  const {
    subjectId,
    subjectName,
    subjectColor,
    ranged,
    baselineValue,
    isIntraday,
    isWeeklyHourly,
    range,
    entities,
    isOn,
    scrub,
  } = params;

  const filterChips = useMemo<FilterChipDef[]>(
    () =>
      entities.map((e) => ({
        id: e.id,
        name: e.name,
        color: e.color,
        group: e.group,
        defaultOn: e.defaultOn,
      })),
    [entities]
  );

  const visibleComparisons = useMemo(
    () => entities.filter((e) => isOn(e.id, e.defaultOn)),
    [entities, isOn]
  );

  // Subject's raw $ line + each visible comparison scaled to share the
  // subject's range-start $ (scale = subjectStart / entityStart). lineMeta
  // carries name/color/href for the legend.
  const { chartSeries, lineMeta } = useMemo(() => {
    const out: ChartSeries[] = [
      { id: subjectId, color: subjectColor, data: ranged },
    ];
    const meta: Record<string, { name: string; color: string; href: string | null }> = {
      [subjectId]: { name: subjectName, color: subjectColor, href: null },
    };
    for (const e of visibleComparisons) {
      const r = isIntraday
        ? e.intraday?.points ?? []
        : isWeeklyHourly
          ? e.weekly ?? filterRange(e.daily, range)
          : filterRange(e.daily, range);
      if (r.length === 0) continue;
      const eStart = isIntraday
        ? e.intraday?.previousClose ?? r[0]?.value ?? 0
        : r[0]?.value ?? 0;
      if (eStart <= 0 || baselineValue <= 0) continue;
      const scale = baselineValue / eStart;
      out.push({
        id: e.id,
        color: e.color,
        data: r.map((p) => ({ date: p.date, value: p.value * scale })),
      });
      meta[e.id] = { name: e.name, color: e.color, href: e.href };
    }
    return { chartSeries: out, lineMeta: meta };
  }, [
    subjectId,
    subjectColor,
    subjectName,
    ranged,
    visibleComparisons,
    isIntraday,
    isWeeklyHourly,
    range,
    baselineValue,
  ]);

  // Every chart line starts at baselineValue by construction, so each line's
  // range pct is (v − baselineValue) / baselineValue — scrub-aware. Sorted
  // best-to-worst.
  const legend = useMemo<LegendRow[]>(() => {
    const rows = chartSeries.map((s) => {
      const scrubV = scrub?.values.find((v) => v.id === s.id)?.value;
      const lastV = s.data[s.data.length - 1]?.value ?? baselineValue;
      const v = scrubV ?? lastV;
      const m = lineMeta[s.id];
      return {
        id: s.id,
        name: m.name,
        color: m.color,
        href: m.href,
        pct: baselineValue > 0 ? (v - baselineValue) / baselineValue : 0,
        isSubject: s.id === subjectId,
      };
    });
    return rows.sort((a, b) => b.pct - a.pct);
  }, [chartSeries, lineMeta, scrub, baselineValue, subjectId]);

  return { filterChips, visibleComparisons, chartSeries, legend };
}
