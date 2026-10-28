"use client";

import { AnimatedNumber } from "./AnimatedNumber";
import clsx from "clsx";
import { useEffect, useState } from "react";
import { fmtPct, fmtSignedUSD, fmtUSD, getMarketSessionState } from "@/lib/portfolio";
import { lastMarketCloseDate } from "@/lib/market-calendar";

const STALE_MS = 30 * 60_000;

/** Muted data-freshness line, or null when nothing needs saying. */
function freshnessLine(dataAt?: string): string | null {
  const now = new Date();
  const state = getMarketSessionState(now);
  if (state === "closed") {
    const d = lastMarketCloseDate(now).toLocaleDateString("en-US", {
      timeZone: "UTC",
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    return `At close · ${d}`;
  }
  const t = dataAt ? new Date(dataAt) : null;
  if (state === "open" && t && !isNaN(+t) && now.getTime() - t.getTime() > STALE_MS) {
    const time = t.toLocaleTimeString("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      minute: "2-digit",
    });
    return `Prices as of ${time} ET`;
  }
  return null;
}

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
   * line. Used by PortfolioView to show the player's EXCESS return over a
   * benchmark — e.g. "+5.60% vs S&P 500" means the player is beating the
   * market by 5.60 percentage points. `pct` is signed (negative when
   * trailing). Sign-first labeling avoids the ambiguity where readers might
   * otherwise interpret the number as the benchmark's absolute return.
   * Hidden when null/undefined so other views (StockView, etc.) don't grow
   * an empty row.
   */
  compareTo?: { label: string; pct: number; color: string } | null;
  /** ISO timestamp of the latest price data; enables the "Prices as of" stale note. */
  dataAt?: string;
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
  dataAt,
}: Props) {
  // Client-only (after mount) so SSR markup never disagrees with the clock.
  const [freshness, setFreshness] = useState<string | null>(null);
  useEffect(() => {
    setFreshness(freshnessLine(dataAt));
    const id = window.setInterval(() => setFreshness(freshnessLine(dataAt)), 60_000);
    return () => window.clearInterval(id);
  }, [dataAt]);
  const delta = value - baseline;
  const pct = baseline === 0 ? 0 : delta / baseline;
  const positive = delta >= 0;
  const color = positive ? "var(--gain)" : "var(--loss)";
  return (
    <div data-price-header className="px-4 pt-1 pb-3">
      {(label || ticker) && (
        <div className="flex items-center gap-2 mb-1 text-[11px] font-bold tracking-[0.12em] uppercase text-ink-muted">
          {ticker && <span>{ticker}</span>}
          {label && <span>{label}</span>}
        </div>
      )}
      <h1 className="text-[22px] leading-tight font-semibold text-ink">{title}</h1>
      <div
        className="text-[34px] font-semibold tracking-tight text-ink mt-1"
        style={accent ? { color: accent } : undefined}
      >
        <AnimatedNumber
          value={value}
          format={(n) => fmtUSD(n, fractionDigits)}
          animate={scrubDate == null}
        />
      </div>
      <div className="flex items-center gap-2 mt-0.5 text-[14px] font-medium" style={{ color }}>
        <Triangle up={positive} />
        <span>{fmtSignedUSD(delta, fractionDigits)}</span>
        <span className="opacity-90">({fmtPct(pct)})</span>
        <span className={clsx("text-ink-faint font-normal", scrubDate ? "" : "hidden")}>
          • {scrubDate}
        </span>
      </div>
      {freshness && scrubDate == null && (
        <div className="mt-0.5 text-[11px] font-medium text-ink-faint">{freshness}</div>
      )}
      {compareTo && (
        <div className="flex items-center gap-2 mt-1 text-[12px] font-medium text-ink-muted">
          <div
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: compareTo.color }}
          />
          <span>
            <span
              className="tabular-nums"
              style={{ color: compareTo.pct >= 0 ? "var(--gain)" : "var(--loss)" }}
            >
              {fmtPct(compareTo.pct)}
            </span>{" "}
            vs {compareTo.label}
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
