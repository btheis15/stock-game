"use client";

import { useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import { ScrubChart, type ScrubState } from "./ScrubChart";
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
import { accentFor, useP3 } from "@/lib/color";
import { MarketStateBadge } from "./MarketStateBadge";
import { DigestPanel } from "./DigestPanel";
import { useDigests } from "@/lib/digests";
import { PortfolioComposition } from "./PortfolioComposition";
import type { PortfolioComposition as PortfolioCompositionData } from "@/lib/portfolio-composition";
import { PortfolioThesis } from "./PortfolioThesis";
import type { Thesis } from "@/lib/thesis-types";
import { useFundsFilter, FilterToolbar, FilterSheet } from "./FundsFilter";
import { OverlayLegend } from "./OverlayLegend";
import {
  useComparisonOverlays,
  type CompSeries,
  type CompEntity,
  type IntradayResult,
} from "./comparisonOverlays";
import { spinoffRowSuffix } from "./SpinoffNote";

export type { CompSeries } from "./comparisonOverlays";

const LIVE_LAG_MS = 30 * 60 * 1000;
function lastPointIsLive(points: { date: string }[]): boolean {
  const last = points[points.length - 1];
  if (!last || last.date.length <= 10) return false;
  return Date.now() - new Date(last.date).getTime() < LIVE_LAG_MS;
}

// Storage key distinct from the Compare page so portfolio overlays and the
// Compare filter don't share toggles (you usually want fewer overlays here).
const PORTFOLIO_FILTER_KEY = "stockgame.portfolio.filter";

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
  /** Other players, available as toggle-on comparison overlays (default off). */
  players: CompSeries[];
  /** Active funds (incl. Legacy Auto), comparison overlays (default off). */
  funds: CompSeries[];
  intradayDate: string;
  generatedAt: string;
  holdings: HoldingRow[];
  composition: PortfolioCompositionData;
  /** The player's own "why these picks" reasoning. Null → section is hidden. */
  thesis: Thesis | null;
}

export function PortfolioView({
  userId,
  series,
  intraday,
  weekly,
  baselineDaily,
  baselineIntraday,
  baselineWeekly,
  players,
  funds,
  intradayDate,
  generatedAt,
  holdings,
  composition,
  thesis,
}: Props) {
  const user = USERS[userId];
  const p3 = useP3();
  // This player's accent, P3-upgraded on wide-gamut screens. Also published
  // as --accent on the page root so CSS consumers (the deep-link holding
  // flash, accent-aware chrome) inherit the page's identity.
  const accent = accentFor(user, p3);
  const [range, setRange] = useState<Range>("1D");
  const [scrub, setScrub] = useState<ScrubState | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const { isOn, setOn } = useFundsFilter(PORTFOLIO_FILTER_KEY);
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

  // Excess return shown in PriceHeader's "vs S&P 500" sub-row — the player's
  // range pct MINUS the S&P 500's range pct over the same window, so it
  // answers "am I beating the market, and by how much?" Each player sees a
  // different number (not SPY's absolute pct). Read both the player and the
  // baseline values from the raw $ series via scrub.index, since the chart
  // scales the baseline line — scaling cancels in pct calculations but
  // reading the raw series sidesteps the indirection entirely.
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
  const playerPct =
    baselineValue === 0 ? 0 : (value - baselineValue) / baselineValue;
  const baselinePct =
    baselineStartValue === 0
      ? 0
      : (baselineCurrent - baselineStartValue) / baselineStartValue;
  const excessVsBaselinePct = playerPct - baselinePct;

  const xDomain = isIntraday ? sessionBoundsForDate(intradayDate) : undefined;

  // Every line that CAN be overlaid: the other players (default off), the
  // S&P 500 baseline (default on — preserves the historical "vs market"
  // overlay), and the funds (default off). The current player is never in
  // this list; it's always drawn. href makes each legend row click-through.
  const comparisonEntities = useMemo<CompEntity[]>(() => {
    const list: CompEntity[] = players.map((p) => ({
      ...p,
      group: "Players",
      defaultOn: false,
      href: `/portfolio/${p.id}`,
    }));
    if (hasBaseline) {
      list.push({
        id: BASELINE.id,
        name: BASELINE.name,
        color: BASELINE.color,
        daily: baselineDaily!,
        intraday: baselineIntraday,
        weekly: baselineWeekly,
        group: "Baseline",
        defaultOn: true,
        href: null,
      });
    }
    for (const f of funds)
      list.push({ ...f, group: "Funds", defaultOn: false, href: `/fund/${f.id}` });
    return list;
  }, [players, funds, hasBaseline, baselineDaily, baselineIntraday, baselineWeekly]);

  const baselineOn = hasBaseline && isOn(BASELINE.id, true);

  const { filterChips, chartSeries, legend } = useComparisonOverlays({
      subjectId: userId,
      subjectName: user.name,
      subjectColor: accent,
      ranged,
      baselineValue,
      isIntraday,
      isWeeklyHourly,
      range,
      entities: comparisonEntities,
      isOn,
      scrub,
    });

  const sorted = useMemo(
    () =>
      [...holdings].sort(
        (a, b) => (b.rangeStats[range]?.pct ?? 0) - (a.rangeStats[range]?.pct ?? 0)
      ),
    [holdings, range]
  );

  return (
    <div className="pb-24" style={{ "--accent": accent } as CSSProperties}>
      <PriceHeader
        ticker={user.name.toUpperCase()}
        title={`${user.name}'s portfolio`}
        value={value}
        baseline={baselineValue}
        scrubDate={scrubLabel}
        compareTo={
          baselineOn && baselineRanged && baselineRanged.length > 0
            ? { label: BASELINE.name, pct: excessVsBaselinePct, color: BASELINE.color }
            : null
        }
      />

      {isIntraday && <MarketStateBadge generatedAt={generatedAt} />}

      <FilterToolbar
        chips={filterChips}
        isOn={isOn}
        onOpenFilter={() => setFilterOpen(true)}
        label="Compare"
      />

      <ScrubChart
        series={chartSeries}
        onScrub={setScrub}
        height={260}
        xDomain={xDomain}
        liveEndpoint={live}
        baseline={baselineValue}
        compactX={isWeeklyHourly}
      />

      <OverlayLegend legend={legend} subjectLabel="You" />

      <RangeTabs value={range} onChange={setRange} accent={accent} />

      <DigestPanel
        digest={getPortfolioDigest(userId, range)}
        loading={digestsLoading}
        range={range}
      />

      <div className="px-4 mt-3">
        <h2 className="text-[15px] font-semibold text-ink-3 mb-2">Holdings</h2>
        <div className="rounded-2xl bg-card border border-hairline divide-y divide-hairline overflow-hidden stagger-in">
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
                className="target:bg-raised-80 target:animate-[holdingFlash_1.6s_ease]"
              >
                <Link
                  href={`/stock/${h.ticker}`}
                  className="press flex items-center gap-3 px-4 py-3 active:bg-pressed"
                >
                  <div className="w-9 h-9 rounded-full bg-raised flex items-center justify-center text-[10px] font-bold text-ink-3">
                    {h.ticker}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[14px] font-semibold text-ink truncate">
                      {TICKER_NAMES[h.ticker] ?? h.ticker}
                    </div>
                    <div className="text-[11px] text-ink-faint tabular-nums">
                      {h.shares.toFixed(2)} shares • {fmtUSD(h.currentClose, 2)}
                      {spinoffRowSuffix(h.ticker) && (
                        <span style={{ color: "#F5A623" }}> · {spinoffRowSuffix(h.ticker)}</span>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[14px] font-semibold text-ink tabular-nums">
                      {fmtUSD(h.currentValue)}
                    </div>
                    <div
                      className="text-[11px] font-medium tabular-nums"
                      style={{ color: rangePct >= 0 ? "var(--gain)" : "var(--loss)" }}
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

      <PortfolioComposition composition={composition} accentColor={accent} />

      <PortfolioThesis
        thesis={thesis}
        userId={user.id}
        userName={user.name}
        tickers={user.tickers}
        accentColor={accent}
      />

      <FilterSheet
        open={filterOpen}
        chips={filterChips}
        isOn={isOn}
        setOn={setOn}
        onClose={() => setFilterOpen(false)}
      />
    </div>
  );
}
