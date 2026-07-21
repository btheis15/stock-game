"use client";

// Fund drill-down (/fund/[id]). Mirrors PortfolioView: a big chart with
// comparison overlays (players, S&P 500, other funds), then the fund's
// holdings listed individually — each tappable through to its stock page —
// so a fund reads exactly like an individual account. Shares come from the
// fund's weights rather than an equal per-pick split.

import { useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import { ScrubChart, type ScrubState } from "./ScrubChart";
import { RangeTabs } from "./RangeTabs";
import { PriceHeader } from "./PriceHeader";
import { MarketStateBadge } from "./MarketStateBadge";
import { DigestPanel } from "./DigestPanel";
import { useDigests } from "@/lib/digests";
import { useFundsFilter, FilterToolbar, FilterSheet } from "./FundsFilter";
import { OverlayLegend } from "./OverlayLegend";
import {
  useComparisonOverlays,
  type CompSeries,
  type CompEntity,
  type IntradayResult,
} from "./comparisonOverlays";
import {
  filterRange,
  fmtDateLong,
  fmtPct,
  fmtShares,
  fmtSignedUSD,
  fmtTimeOfDay,
  fmtUSD,
  sessionBoundsForDate,
} from "@/lib/portfolio";
import type { HoldingRow, PortfolioPoint, Range } from "@/lib/types";
import { BASELINE, STARTING_PORTFOLIO_DOLLARS } from "@/lib/picks";

const LIVE_LAG_MS = 30 * 60 * 1000;
function lastPointIsLive(points: { date: string }[]): boolean {
  const last = points[points.length - 1];
  if (!last || last.date.length <= 10) return false;
  return Date.now() - new Date(last.date).getTime() < LIVE_LAG_MS;
}

// Distinct from the portfolio + compare filters so fund overlays don't share
// toggle state with those pages.
const FUND_FILTER_KEY = "stockgame.fund.filter";

interface Props {
  fundId: string;
  name: string;
  color: string;
  creator: string | null;
  series: PortfolioPoint[];
  intraday: IntradayResult;
  weekly: PortfolioPoint[] | null;
  baselineDaily: PortfolioPoint[] | null;
  baselineIntraday: IntradayResult | null;
  baselineWeekly: PortfolioPoint[] | null;
  /** All players, available as comparison overlays (default off). */
  players: CompSeries[];
  /** The OTHER active funds (excludes this one), comparison overlays. */
  funds: CompSeries[];
  intradayDate: string;
  generatedAt: string;
  holdings: HoldingRow[];
  /** Holding tickers not yet in the snapshot — shown as a "loading" note. */
  pending: string[];
}

export function FundView({
  fundId,
  name,
  color,
  creator,
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
  pending,
}: Props) {
  const [range, setRange] = useState<Range>("1D");
  const [scrub, setScrub] = useState<ScrubState | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const { isOn, setOn } = useFundsFilter(FUND_FILTER_KEY);
  const { loading: digestsLoading, getFundDigest } = useDigests();

  const isIntraday = range === "1D";
  const hasBaseline = baselineDaily != null;
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
  const scrubVal = scrub?.values.find((v) => v.id === fundId)?.value;
  const value = scrubVal ?? lastValue;
  const scrubLabel = scrub
    ? scrub.date.length > 10
      ? fmtTimeOfDay(scrub.date)
      : fmtDateLong(scrub.date)
    : null;

  // "vs S&P 500" excess return — same math as PortfolioView.
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
  const fundPct =
    baselineValue === 0 ? 0 : (value - baselineValue) / baselineValue;
  const baselinePct =
    baselineStartValue === 0
      ? 0
      : (baselineCurrent - baselineStartValue) / baselineStartValue;
  const excessVsBaselinePct = fundPct - baselinePct;

  const xDomain = isIntraday ? sessionBoundsForDate(intradayDate) : undefined;

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
    subjectId: fundId,
    subjectName: name,
    subjectColor: color,
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
    <div className="pb-24" style={{ "--accent": color } as CSSProperties}>
      <PriceHeader
        ticker={creator ? `FUND · BY ${creator.toUpperCase()}` : "COMPARISON FUND"}
        title={name}
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

      <OverlayLegend legend={legend} subjectLabel="This fund" />

      <RangeTabs value={range} onChange={setRange} accent={color} />

      <DigestPanel
        digest={getFundDigest(fundId, range)}
        loading={digestsLoading}
        range={range}
      />

      <div className="px-4 mt-3">
        <h2 className="text-[15px] font-semibold text-ink-3 mb-2">Holdings</h2>
        {pending.length > 0 && (
          <div className="text-[11px] text-amber-600 leading-snug mb-2">
            {pending.join(", ")} {pending.length === 1 ? "is" : "are"} still
            loading — full value updates at the next refresh.
          </div>
        )}
        <div className="rounded-2xl bg-card border border-hairline divide-y divide-hairline overflow-hidden">
          {sorted.map((h) => {
            const stat = h.rangeStats[range];
            const rangePct = stat?.pct ?? 0;
            const rangeDollars = stat?.dollars ?? 0;
            const weightPct = h.costBasis / STARTING_PORTFOLIO_DOLLARS;
            return (
              <div
                key={h.ticker}
                id={h.ticker}
                style={{ scrollMarginTop: 80, scrollMarginBottom: 100 }}
                className="target:bg-raised-80 target:animate-[holdingFlash_1.6s_ease]"
              >
                <Link
                  href={`/stock/${h.ticker}`}
                  className="flex items-center gap-3 px-4 py-3 active:bg-pressed transition-colors"
                >
                  <div className="w-9 h-9 rounded-full bg-raised flex items-center justify-center text-[10px] font-bold text-ink-3">
                    {h.ticker}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[14px] font-semibold text-ink truncate">
                      {h.name}
                    </div>
                    <div className="text-[11px] text-ink-faint tabular-nums">
                      {fmtPct(weightPct)} • {fmtShares(h.shares)} shares •{" "}
                      {fmtUSD(h.currentClose, 2)}
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
