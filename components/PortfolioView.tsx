"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ScrubChart, type ChartSeries, type ScrubState } from "./ScrubChart";
import { RangeTabs } from "./RangeTabs";
import { PriceHeader } from "./PriceHeader";
import {
  filterRange,
  fmtDateLong,
  fmtPct,
  fmtSignedUSD,
  fmtTimeOfDay,
  fmtUSD,
  sessionBoundsForDate,
} from "@/lib/portfolio";
import type { HoldingRow, PortfolioPoint, Range } from "@/lib/types";
import { BASELINE, TICKER_NAMES, USERS, type UserId } from "@/lib/picks";
import { MarketStateBadge } from "./MarketStateBadge";
import { DigestPanel } from "./DigestPanel";
import { useDigests } from "@/lib/digests";

const LIVE_LAG_MS = 30 * 60 * 1000;
function lastPointIsLive(points: { date: string }[]): boolean {
  const last = points[points.length - 1];
  if (!last || last.date.length <= 10) return false;
  return Date.now() - new Date(last.date).getTime() < LIVE_LAG_MS;
}

interface IntradayResult {
  points: PortfolioPoint[];
  previousClose: number;
}

interface Props {
  userId: UserId;
  series: PortfolioPoint[];
  intraday: IntradayResult;
  /** Past-week hourly bars; null falls back to filtered daily closes for 1W. */
  weekly: PortfolioPoint[] | null;
  /** S&P 500 (SPY) benchmark curves — same shape as the player ones, drawn
   *  alongside the player line on the chart and summarized as "vs S&P 500
   *  +X.XX%" in PriceHeader. Null on any path → no overlay for that path. */
  baselineDaily: PortfolioPoint[] | null;
  baselineIntraday: IntradayResult | null;
  baselineWeekly: PortfolioPoint[] | null;
  intradayDate: string;
  generatedAt: string;
  holdings: HoldingRow[];
}

export function PortfolioView({
  userId,
  series,
  intraday,
  weekly,
  baselineDaily,
  baselineIntraday,
  baselineWeekly,
  intradayDate,
  generatedAt,
  holdings,
}: Props) {
  const user = USERS[userId];
  const [range, setRange] = useState<Range>("1D");
  const [scrub, setScrub] = useState<ScrubState | null>(null);
  const { loading: digestsLoading, getPortfolioDigest } = useDigests();

  const isIntraday = range === "1D";
  const hasBaseline = baselineDaily != null;
  // Keep compactX consistent: only enable it when the baseline has weekly data
  // too, otherwise we'd mix hourly-spaced player points with daily-spaced
  // baseline points. Mirrors the same guard in CompareView.
  const isWeeklyHourly =
    range === "1W" && weekly != null && (!hasBaseline || baselineWeekly != null);
  const live = useMemo(
    () => isIntraday && lastPointIsLive(intraday.points),
    [isIntraday, intraday]
  );

  const ranged = useMemo(() => {
    if (isIntraday) return intraday.points;
    if (isWeeklyHourly) return weekly!;
    return filterRange(series, range);
  }, [series, intraday, weekly, range, isIntraday, isWeeklyHourly]);

  // Raw baseline series for the active range (unscaled $). Null if SPY data
  // isn't present in this snapshot OR the active range's baseline path is
  // empty.
  const baselineRanged = useMemo<PortfolioPoint[] | null>(() => {
    if (!hasBaseline) return null;
    if (isIntraday) return baselineIntraday?.points ?? null;
    if (isWeeklyHourly) return baselineWeekly;
    return filterRange(baselineDaily!, range);
  }, [hasBaseline, isIntraday, isWeeklyHourly, baselineIntraday, baselineWeekly, baselineDaily, range]);

  const baselineValue = isIntraday
    ? intraday.previousClose
    : ranged[0]?.value ?? 0;
  const lastValue = ranged[ranged.length - 1]?.value ?? baselineValue;
  const scrubVal = scrub?.values.find((v) => v.id === userId)?.value;
  const value = scrubVal ?? lastValue;
  const scrubLabel = scrub
    ? scrub.date.length > 10
      ? fmtTimeOfDay(scrub.date)
      : fmtDateLong(scrub.date)
    : null;

  // Baseline pct used by PriceHeader's "vs S&P 500" sub-row. Compares the
  // baseline's value at the scrub index (or its last point) against its range
  // start. Read from baselineRanged (raw $) rather than scrub.values, since
  // the chart series scales the baseline line — that scaling cancels in a pct
  // calc but reading the raw series avoids the indirection.
  const baselineStartValue =
    isIntraday && baselineIntraday
      ? baselineIntraday.previousClose
      : baselineRanged?.[0]?.value ?? 0;
  const baselineLastValue =
    baselineRanged?.[baselineRanged.length - 1]?.value ?? baselineStartValue;
  const baselineCurrent = (() => {
    if (!baselineRanged) return baselineLastValue;
    const idx = scrub?.index;
    if (idx != null && baselineRanged[idx]) return baselineRanged[idx].value;
    return baselineLastValue;
  })();
  const baselinePct =
    baselineStartValue === 0
      ? 0
      : (baselineCurrent - baselineStartValue) / baselineStartValue;

  const xDomain = isIntraday ? sessionBoundsForDate(intradayDate) : undefined;

  // Chart series: the player's raw $ line, plus (when SPY data is available)
  // a scaled S&P 500 line that starts at the SAME range-start $ as the
  // player. Scaling = playerStart / baselineStart, so the baseline line
  // visually answers "if you'd invested this much in SPY at range start,
  // where would it be now?" — divergence from the player line is exactly
  // relative performance. Without scaling, the two lines would start at
  // different $ values and the y-extents wouldn't be comparable.
  const chartSeries = useMemo<ChartSeries[]>(() => {
    const out: ChartSeries[] = [
      { id: userId, color: user.color, data: ranged },
    ];
    if (
      baselineRanged &&
      baselineRanged.length > 0 &&
      baselineStartValue > 0 &&
      baselineValue > 0
    ) {
      const scale = baselineValue / baselineStartValue;
      out.push({
        id: BASELINE.id,
        color: BASELINE.color,
        data: baselineRanged.map((p) => ({ date: p.date, value: p.value * scale })),
      });
    }
    return out;
  }, [userId, user.color, ranged, baselineRanged, baselineValue, baselineStartValue]);

  const sorted = useMemo(
    () =>
      [...holdings].sort(
        (a, b) => (b.rangeStats[range]?.pct ?? 0) - (a.rangeStats[range]?.pct ?? 0)
      ),
    [holdings, range]
  );

  return (
    <div className="pb-24">
      <PriceHeader
        ticker={user.name.toUpperCase()}
        title={`${user.name}'s portfolio`}
        value={value}
        baseline={baselineValue}
        scrubDate={scrubLabel}
        compareTo={
          baselineRanged && baselineRanged.length > 0
            ? { label: BASELINE.name, pct: baselinePct, color: BASELINE.color }
            : null
        }
      />

      {isIntraday && <MarketStateBadge generatedAt={generatedAt} />}

      <ScrubChart
        series={chartSeries}
        onScrub={setScrub}
        height={260}
        xDomain={xDomain}
        liveEndpoint={live}
        baseline={baselineValue}
        compactX={isWeeklyHourly}
      />

      <RangeTabs value={range} onChange={setRange} accent={user.color} />

      <DigestPanel
        digest={getPortfolioDigest(userId, range)}
        loading={digestsLoading}
        range={range}
      />

      <div className="px-4 mt-3">
        <h2 className="text-[15px] font-semibold text-zinc-300 mb-2">Holdings</h2>
        <div className="rounded-2xl bg-zinc-900/70 border border-zinc-800 divide-y divide-zinc-800 overflow-hidden">
          {sorted.map((h) => {
            const stat = h.rangeStats[range];
            const rangePct = stat?.pct ?? 0;
            const rangeDollars = stat?.dollars ?? 0;
            // Anchor id + scroll-margin live on the WRAPPER, not the Link.
            // When iOS Safari focuses a tapped link, any scroll-margin-top
            // on that link can offset the page before navigation completes
            // and the offset leaks into the new page's initial scroll
            // position — visible as ~80px of empty space above the back
            // button on /stock/{ticker}. Wrapping decouples the deep-link
            // target (incoming `/portfolio/{user}#TICKER` jump-scroll +
            // green flash) from the click handler (outgoing nav, which
            // should always land at top).
            return (
              <div
                key={h.ticker}
                id={h.ticker}
                style={{ scrollMarginTop: 80, scrollMarginBottom: 100 }}
                className="target:bg-zinc-800/80 target:animate-[holdingFlash_1.6s_ease]"
              >
                <Link
                  href={`/stock/${h.ticker}`}
                  className="flex items-center gap-3 px-4 py-3 active:bg-zinc-800/60 transition-colors"
                >
                  <div className="w-9 h-9 rounded-full bg-zinc-800 flex items-center justify-center text-[10px] font-bold text-zinc-300">
                    {h.ticker}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[14px] font-semibold text-white truncate">
                      {TICKER_NAMES[h.ticker] ?? h.ticker}
                    </div>
                    <div className="text-[11px] text-zinc-500 tabular-nums">
                      {h.shares.toFixed(2)} shares • {fmtUSD(h.currentClose, 2)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[14px] font-semibold text-white tabular-nums">
                      {fmtUSD(h.currentValue)}
                    </div>
                    <div
                      className="text-[11px] font-medium tabular-nums"
                      style={{ color: rangePct >= 0 ? "#00C805" : "#FF453A" }}
                    >
                      {fmtPct(rangePct)} • {fmtSignedUSD(rangeDollars, 0)}
                    </div>
                  </div>
                </Link>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
