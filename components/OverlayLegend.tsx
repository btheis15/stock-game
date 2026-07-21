"use client";

// The little color-coded list under the chart on the player + fund drill-down
// pages. Names each line on the chart and shows its return for the active
// range, sorted best-to-worst. Rows with an href (other players, funds) are
// tappable and navigate to that entity's own page.

import Link from "next/link";
import { fmtPct } from "@/lib/portfolio";
import type { LegendRow } from "./comparisonOverlays";

export function OverlayLegend({
  legend,
  subjectLabel = "You",
}: {
  legend: LegendRow[];
  /** Tag shown next to the subject's own row ("You" on a portfolio, "This
   *  fund" on a fund page). */
  subjectLabel?: string;
}) {
  // Only the subject line is on the chart → nothing to compare, no legend.
  if (legend.length <= 1) return null;
  return (
    <div className="px-4 mt-1">
      <div className="rounded-2xl bg-card border border-hairline divide-y divide-hairline overflow-hidden">
        {legend.map((row) => {
          const inner = (
            <>
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: row.color }}
              />
              <span className="flex-1 min-w-0 text-[14px] font-medium text-ink-2 truncate">
                {row.name}
                {row.isSubject && (
                  <span className="ml-1.5 text-[10px] font-bold uppercase tracking-wider text-ink-faint">
                    {subjectLabel}
                  </span>
                )}
              </span>
              <span
                className="text-[13px] font-semibold tabular-nums"
                style={{ color: row.pct >= 0 ? "#00C805" : "#FF453A" }}
              >
                {fmtPct(row.pct)}
              </span>
              {row.href && (
                <span className="text-ink-ghost text-[13px] shrink-0">›</span>
              )}
            </>
          );
          return row.href ? (
            <Link
              key={row.id}
              href={row.href}
              className="flex items-center gap-3 px-3 py-2.5 active:bg-card-40 transition-colors"
            >
              {inner}
            </Link>
          ) : (
            <div key={row.id} className="flex items-center gap-3 px-3 py-2.5">
              {inner}
            </div>
          );
        })}
      </div>
    </div>
  );
}
