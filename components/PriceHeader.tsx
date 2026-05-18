"use client";

import clsx from "clsx";
import { fmtPct, fmtSignedUSD, fmtUSD } from "@/lib/portfolio";

interface Props {
  label?: string;
  ticker?: string;
  title: string;
  value: number;
  baseline: number;
  scrubDate?: string | null;
  accent?: string;
  fractionDigits?: number;
  /**
   * Optional secondary comparison row, rendered below the primary delta/pct
   * line. Used by PortfolioView to show "vs S&P 500 +X.XX%" so the gray
   * baseline line on the chart has a label + a precise number at a glance.
   * Hidden when null/undefined so other views (StockView, etc.) don't grow
   * an empty row.
   */
  compareTo?: { label: string; pct: number; color: string } | null;
}

export function PriceHeader({
  label,
  ticker,
  title,
  value,
  baseline,
  scrubDate,
  accent,
  fractionDigits = 2,
  compareTo,
}: Props) {
  const delta = value - baseline;
  const pct = baseline === 0 ? 0 : delta / baseline;
  const positive = delta >= 0;
  const color = positive ? "#00C805" : "#FF453A";
  return (
    <div className="px-4 pt-1 pb-3">
      {(label || ticker) && (
        <div className="flex items-center gap-2 mb-1 text-[11px] font-bold tracking-[0.12em] uppercase text-zinc-400">
          {ticker && <span>{ticker}</span>}
          {label && <span>{label}</span>}
        </div>
      )}
      <h1 className="text-[22px] leading-tight font-semibold text-white">{title}</h1>
      <div
        className="text-[34px] font-semibold tracking-tight text-white mt-1"
        style={accent ? { color: accent } : undefined}
      >
        {fmtUSD(value, fractionDigits)}
      </div>
      <div className="flex items-center gap-2 mt-0.5 text-[14px] font-medium" style={{ color }}>
        <Triangle up={positive} />
        <span>{fmtSignedUSD(delta, fractionDigits)}</span>
        <span className="opacity-90">({fmtPct(pct)})</span>
        <span className={clsx("text-zinc-500 font-normal", scrubDate ? "" : "hidden")}>
          • {scrubDate}
        </span>
      </div>
      {compareTo && (
        <div className="flex items-center gap-2 mt-1 text-[12px] font-medium text-zinc-400">
          <div
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: compareTo.color }}
          />
          <span>
            vs {compareTo.label}{" "}
            <span
              className="tabular-nums"
              style={{ color: compareTo.pct >= 0 ? "#00C805" : "#FF453A" }}
            >
              {fmtPct(compareTo.pct)}
            </span>
          </span>
        </div>
      )}
    </div>
  );
}

function Triangle({ up }: { up: boolean }) {
  return (
    <svg viewBox="0 0 12 10" className="w-3 h-3" style={{ transform: up ? undefined : "rotate(180deg)" }}>
      <path d="M6 0L12 10H0L6 0Z" fill="currentColor" />
    </svg>
  );
}
