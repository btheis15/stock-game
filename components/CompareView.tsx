"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ScrubChart, type ChartSeries, type ScrubState } from "./ScrubChart";
import { RangeTabs } from "./RangeTabs";
import { InsightsCard } from "./InsightsCard";
import { DigestPanel } from "./DigestPanel";
import { CreateFundModal } from "./CreateFundModal";
import { ManageFundsSheet } from "./ManageFundsSheet";
import { FilterToolbar, FilterSheet, useFundsFilter, type FilterChipDef } from "./FundsFilter";
import { useDigests } from "@/lib/digests";
import {
  filterRange,
  fmtDateLong,
  fmtPct,
  fmtSignedUSD,
  fmtTimeOfDay,
  fmtUSD,
  sessionBoundsForDate,
} from "@/lib/portfolio";
import type { Fund, PortfolioPoint, Range, RangeAnalysis } from "@/lib/types";
import { BASELINE, USER_LIST, type UserId } from "@/lib/picks";
import { MarketStateBadge } from "./MarketStateBadge";
import { WhatsNew } from "./WhatsNew";
import { PortfolioComposition } from "./PortfolioComposition";
import { COMBINED_FUND_COLOR } from "@/lib/combined";
import type { PortfolioComposition as PortfolioCompositionData } from "@/lib/portfolio-composition";

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
  series: Record<UserId, PortfolioPoint[]>;
  intraday: Record<UserId, IntradayResult>;
  /** Past-week hourly bars per user; null falls back to filtered daily closes. */
  weekly: Record<UserId, PortfolioPoint[] | null>;
  /** S&P 500 (SPY) benchmark curves. Each may be null if SPY data isn't in
   *  the current snapshot yet — the view hides the baseline row + line in
   *  that case rather than blocking the page. */
  baselineDaily: PortfolioPoint[] | null;
  baselineIntraday: IntradayResult | null;
  baselineWeekly: PortfolioPoint[] | null;
  /** User-created funds. Empty array on first deploy or when all funds
   *  are archived. Each fund's series shapes match the player record
   *  above; intraday[] is null when SPY-style intraday data isn't ready. */
  funds: Fund[];
  fundSeries: Record<string, PortfolioPoint[]>;
  fundIntraday: Record<string, IntradayResult | null>;
  fundWeekly: Record<string, PortfolioPoint[] | null>;
  /** Per-fund holding tickers not yet in prices.json. While non-empty, the
   *  fund's value holds those holdings flat at their allocated principal and
   *  the live gain/loss is partial — the leaderboard row shows a note. */
  fundPending: Record<string, string[]>;
  intradayDate: string;
  generatedAt: string;
  analyses: Record<Range, RangeAnalysis>;
  /** Sector / industry / market-cap breakdown of the pooled Combined Players
   *  fund + a game-wide "About" narrative. Rendered at the bottom of the page. */
  combinedComposition: PortfolioCompositionData;
}

interface RankedEntry {
  id: string;
  name: string;
  color: string;
  href: string | null;
  value: number;
  pct: number;
  baseline: number;
  // Holding tickers not yet priced (funds only). When present, the row shows
  // a "value updates next refresh" note so a partial total doesn't look broken.
  pendingTickers?: string[];
}

export function CompareView({
  series,
  intraday,
  weekly,
  baselineDaily,
  baselineIntraday,
  baselineWeekly,
  funds,
  fundSeries,
  fundIntraday,
  fundWeekly,
  fundPending,
  intradayDate,
  generatedAt,
  analyses,
  combinedComposition,
}: Props) {
  const router = useRouter();
  const [range, setRange] = useState<Range>("1D");
  const { loading: digestsLoading, getGameDigest } = useDigests();
  const [scrub, setScrub] = useState<ScrubState | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [editing, setEditing] = useState<Fund | null>(null);
  const { isOn, setOn } = useFundsFilter();

  // Active funds = not soft-deleted. The Manage sheet shows archived too,
  // but the Compare chart + leaderboard only render active.
  const activeFunds = useMemo(
    () => funds.filter((f) => f.deletedAt === null),
    [funds]
  );

  // Filter entries grouped for the FilterSheet:
  //   - Players: every human player, default ON. (Legacy Auto used to be a
  //     default-OFF pseudo-player here; it's now a real comparison fund in
  //     config/funds.json and lands in the Funds group instead.)
  //   - Baseline: S&P 500, default ON when data is present.
  //   - Funds: user-created + the Legacy Auto comparison, default OFF so the
  //     chart doesn't get crowded as funds accumulate; users opt in their own.
  const filterChips: FilterChipDef[] = useMemo(() => {
    const chips: FilterChipDef[] = USER_LIST.map((u) => ({
      id: u.id,
      name: u.name,
      color: u.color,
      group: "Players" as const,
      defaultOn: true,
    }));
    if (baselineDaily != null) {
      chips.push({
        id: BASELINE.id,
        name: BASELINE.name,
        color: BASELINE.color,
        group: "Baseline" as const,
        defaultOn: true,
      });
    }
    for (const f of activeFunds) {
      chips.push({
        id: f.id,
        name: f.name,
        color: f.color,
        group: "Funds" as const,
        defaultOn: false,
      });
    }
    return chips;
  }, [activeFunds, baselineDaily]);

  // Helpers to honor the filter toggles.
  const userOn = (id: UserId) => isOn(id, true);
  const baselineOn = baselineDaily != null && isOn(BASELINE.id, true);
  const fundOn = (id: string) => isOn(id, false);
  const visibleFunds = useMemo(
    () => activeFunds.filter((f) => fundOn(f.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeFunds, isOn]
  );

  const isIntraday = range === "1D";
  // Whether we have SPY data at all in this snapshot. Drives an extra row in
  // the leaderboard and an extra line on the chart. If the baseline lacks the
  // path the active range needs (e.g. weekly hourly bars), we fall back to its
  // daily-close curve, matching the player-fallback behavior.
  const hasBaseline = baselineDaily != null;
  // Use the hourly weekly series for 1W when we have it. Falls back to
  // filtered daily closes when no weekly data is present (older snapshots
  // pre-dating the weekly-fetch addition). Baseline must also have weekly
  // data to enable the compactX chart — otherwise we'd mix hourly-spaced
  // player lines with a daily-spaced baseline line.
  const isWeeklyHourly =
    range === "1W" &&
    USER_LIST.every((u) => weekly[u.id] != null) &&
    (!hasBaseline || baselineWeekly != null);
  const live = useMemo(
    () => isIntraday && lastPointIsLive(intraday[USER_LIST[0].id].points),
    [isIntraday, intraday]
  );

  const ranged = useMemo(() => {
    const out = {} as Record<UserId, PortfolioPoint[]>;
    if (isIntraday) {
      for (const u of USER_LIST) out[u.id] = intraday[u.id].points;
    } else if (isWeeklyHourly) {
      for (const u of USER_LIST) out[u.id] = weekly[u.id]!;
    } else {
      for (const u of USER_LIST) out[u.id] = filterRange(series[u.id], range);
    }
    return out;
  }, [series, intraday, weekly, range, isIntraday, isWeeklyHourly]);

  // Same shape as `ranged` but for the SPY baseline. null when SPY data isn't
  // available, or when the intraday path is selected and SPY has no intraday
  // bars yet (rare — usually fetched in the same cron run as everyone else).
  const baselineRanged = useMemo<PortfolioPoint[] | null>(() => {
    if (!hasBaseline) return null;
    if (isIntraday) return baselineIntraday?.points ?? null;
    if (isWeeklyHourly) return baselineWeekly;
    return filterRange(baselineDaily!, range);
  }, [hasBaseline, isIntraday, isWeeklyHourly, baselineIntraday, baselineWeekly, baselineDaily, range]);

  // Per-fund range slicing. Mirrors the player path: 1D uses intraday, 1W
  // uses hourly bars when available + the baseline has them, everything
  // else filters the daily curve. Visible-only — funds filtered off stay
  // out of the ranged map entirely so they're never plotted or ranked.
  const fundRanged = useMemo(() => {
    const out: Record<string, PortfolioPoint[]> = {};
    for (const f of visibleFunds) {
      if (isIntraday) {
        out[f.id] = fundIntraday[f.id]?.points ?? [];
      } else if (isWeeklyHourly) {
        out[f.id] = fundWeekly[f.id] ?? filterRange(fundSeries[f.id] ?? [], range);
      } else {
        out[f.id] = filterRange(fundSeries[f.id] ?? [], range);
      }
    }
    return out;
  }, [visibleFunds, fundSeries, fundIntraday, fundWeekly, range, isIntraday, isWeeklyHourly]);

  const stats = useMemo(() => {
    const entries: RankedEntry[] = [];
    for (const u of USER_LIST) {
      if (!userOn(u.id)) continue;
      const pts = ranged[u.id];
      const baseline = isIntraday ? intraday[u.id].previousClose : pts[0]?.value ?? 0;
      const lastVal = pts[pts.length - 1]?.value ?? baseline;
      // The chart plots % change so scrub.values are pct fractions, not
      // dollar values. Rehydrate by indexing into the underlying $ points.
      const scrubIdx = scrub?.index;
      const scrubDollar =
        scrubIdx != null && pts[scrubIdx] ? pts[scrubIdx].value : undefined;
      const value = scrubDollar ?? lastVal;
      const pct = baseline === 0 ? 0 : (value - baseline) / baseline;
      entries.push({
        id: u.id,
        name: u.name,
        color: u.color,
        href: `/portfolio/${u.id}`,
        value,
        pct,
        baseline,
      });
    }
    if (baselineOn) {
      // Always include SPY in the leaderboard when we have its data, even if
      // the active range's points array is empty (e.g. 1D pre-market or on a
      // market-closed day — no intraday bars yet). Mirrors how players are
      // pushed unconditionally above so the row shows with +0.00% rather
      // than vanishing from the standings.
      const pts = baselineRanged ?? [];
      const baseline =
        isIntraday && baselineIntraday
          ? baselineIntraday.previousClose
          : pts[0]?.value ?? 0;
      const lastVal = pts[pts.length - 1]?.value ?? baseline;
      const scrubIdx = scrub?.index;
      const scrubDollar =
        scrubIdx != null && pts[scrubIdx] ? pts[scrubIdx].value : undefined;
      const value = scrubDollar ?? lastVal;
      const pct = baseline === 0 ? 0 : (value - baseline) / baseline;
      entries.push({
        id: BASELINE.id,
        name: BASELINE.name,
        color: BASELINE.color,
        href: null,
        value,
        pct,
        baseline,
      });
    }
    for (const f of visibleFunds) {
      const pts = fundRanged[f.id] ?? [];
      const baseline =
        isIntraday && fundIntraday[f.id]
          ? fundIntraday[f.id]!.previousClose
          : pts[0]?.value ?? 0;
      const lastVal = pts[pts.length - 1]?.value ?? baseline;
      const scrubIdx = scrub?.index;
      const scrubDollar =
        scrubIdx != null && pts[scrubIdx] ? pts[scrubIdx].value : undefined;
      const value = scrubDollar ?? lastVal;
      const pct = baseline === 0 ? 0 : (value - baseline) / baseline;
      entries.push({
        id: f.id,
        name: f.name,
        color: f.color,
        // Tap through to the fund's drill-down page (holdings + chart),
        // same as a player row.
        href: `/fund/${f.id}`,
        value,
        pct,
        baseline,
        pendingTickers: fundPending[f.id] ?? [],
      });
    }
    return entries.sort((a, b) => b.pct - a.pct);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ranged, baselineRanged, fundRanged, visibleFunds, scrub, intraday, baselineIntraday, fundIntraday, fundPending, isIntraday, isOn]);

  // Empty-state guard: if every chip is toggled off, stats is empty and
  // leader/second below would crash. Use safe defaults so the page still
  // renders (headline collapses to "Nothing visible" + a hint), then the
  // user can re-open the Filter sheet to enable something.
  const hasAny = stats.length > 0;
  const leader = hasAny ? stats[0] : { id: "_none", name: "Nothing visible", color: "#71717A", href: null, value: 0, pct: 0, baseline: 0 };
  const second = stats.length > 1 ? stats[1] : leader;
  const gapPct = hasAny ? leader.pct - second.pct : 0;
  // Gap in dollars = difference in gain over the active range (not total
  // portfolio diff), so it's consistent with the % comparison.
  const gapDollars = hasAny
    ? (leader.value - leader.baseline) - (second.value - second.baseline)
    : 0;
  const scrubLabel = scrub
    ? scrub.date.length > 10
      ? fmtTimeOfDay(scrub.date)
      : fmtDateLong(scrub.date)
    : null;

  const xDomain = isIntraday ? sessionBoundsForDate(intradayDate) : undefined;

  // Normalize all lines to % change from the range's baseline so the chart
  // visually matches the leaderboard ranking (highest line = 1st place).
  // Without this, lines would plot raw $ at different starting points and a
  // player with a lower portfolio value but higher gain would look "lowest"
  // even though they're winning the range. Filter off players toggled OFF
  // in the chip row.
  const chartSeries: ChartSeries[] = USER_LIST.filter((u) => userOn(u.id)).map((u) => {
    const pts = ranged[u.id];
    const baseline = isIntraday ? intraday[u.id].previousClose : pts[0]?.value ?? 0;
    return {
      id: u.id,
      color: u.color,
      data: pts.map((p) => ({
        date: p.date,
        value: baseline === 0 ? 0 : (p.value - baseline) / baseline,
      })),
    };
  });
  if (baselineOn && baselineRanged && baselineRanged.length > 0) {
    const pts = baselineRanged;
    const baseline =
      isIntraday && baselineIntraday
        ? baselineIntraday.previousClose
        : pts[0]?.value ?? 0;
    chartSeries.push({
      id: BASELINE.id,
      color: BASELINE.color,
      data: pts.map((p) => ({
        date: p.date,
        value: baseline === 0 ? 0 : (p.value - baseline) / baseline,
      })),
    });
  }
  // Visible-fund chart lines. We skip funds whose ranged points array is
  // empty (e.g. just created, before the next refresh has built history)
  // rather than plotting a degenerate flat line at 0.
  for (const f of visibleFunds) {
    const pts = fundRanged[f.id] ?? [];
    if (pts.length === 0) continue;
    const baseline =
      isIntraday && fundIntraday[f.id]
        ? fundIntraday[f.id]!.previousClose
        : pts[0]?.value ?? 0;
    chartSeries.push({
      id: f.id,
      color: f.color,
      data: pts.map((p) => ({
        date: p.date,
        value: baseline === 0 ? 0 : (p.value - baseline) / baseline,
      })),
    });
  }

  function refreshAfterSave() {
    // Router refresh re-runs the server component (app/page.tsx), which
    // re-reads funds.json with the just-committed entry and pipes the new
    // fund through to this view as a fresh prop. revalidatePath('/') on
    // the server side already busts the Next.js cache; this finishes the
    // round-trip on the client.
    router.refresh();
  }

  return (
    <div className="pb-24">
      <div className="px-4 pt-2 pb-3">
        <div className="flex items-start justify-between">
          <div className="text-[11px] font-bold tracking-[0.12em] uppercase text-zinc-500 mb-1">
            Compare
          </div>
          <WhatsNew />
        </div>
        <h1 className="text-[22px] leading-tight font-semibold text-white">
          {!hasAny
            ? "Nothing visible"
            : gapPct === 0
            ? "It's a tie"
            : `${leader.name} leads`}
        </h1>
        {hasAny ? (
          <>
            <div
              className="text-[34px] font-semibold tracking-tight mt-1"
              style={{ color: leader.color }}
            >
              {fmtPct(gapPct)}
            </div>
            <div className="text-[14px] font-medium text-zinc-400 mt-0.5">
              {fmtSignedUSD(gapDollars)} gap
              {scrubLabel && <span className="text-zinc-500"> • {scrubLabel}</span>}
            </div>
          </>
        ) : (
          <div className="text-[14px] font-medium text-zinc-400 mt-1">
            Tap <span className="text-zinc-200">Show 0 of {filterChips.length}</span> above to enable a player or fund.
          </div>
        )}
      </div>

      {isIntraday && <MarketStateBadge generatedAt={generatedAt} />}

      <FilterToolbar
        chips={filterChips}
        isOn={isOn}
        onOpenFilter={() => setFilterOpen(true)}
        onCreate={() => {
          setEditing(null);
          setCreateOpen(true);
        }}
        onManage={() => setManageOpen(true)}
      />

      <ScrubChart
        series={chartSeries}
        onScrub={setScrub}
        height={280}
        xDomain={xDomain}
        liveEndpoint={live}
        baseline={0}
        compactX={isWeeklyHourly}
      />

      <RangeTabs value={range} onChange={setRange} accent={leader.color} />

      {/* Briefing sits ABOVE the leaderboard now — it's the narrative
          context for what the rankings below show, so reading top-down
          flows chart → range tabs → "what happened" → standings. */}
      <DigestPanel
        digest={getGameDigest(range)}
        loading={digestsLoading}
        range={range}
      />

      <div className="px-4 mt-2">
        <div className="rounded-2xl bg-zinc-900/70 border border-zinc-800 divide-y divide-zinc-800 overflow-hidden">
          {stats.map((s, i) => {
            // Gap = how far behind the leader in $ gain over the active range
            // (not raw portfolio diff — that would mix range performance with
            // permanent wealth, which is misleading when the sort is by range
            // pct). Matches the same definition used by the headline "leads
            // by" number at the top of the page.
            const rangeGain = s.value - s.baseline;
            const leaderGain = leader.value - leader.baseline;
            const gap = i === 0 ? 0 : leaderGain - rangeGain;
            return (
              <UserRow
                key={s.id}
                name={s.name}
                color={s.color}
                value={s.value}
                pct={s.pct}
                gap={gap}
                place={i + 1}
                href={s.href}
                pendingTickers={s.pendingTickers}
              />
            );
          })}
        </div>
      </div>

      <InsightsCard analysis={analyses[range]} />

      <PortfolioComposition
        composition={combinedComposition}
        accentColor={COMBINED_FUND_COLOR}
        title="Combined breakdown"
        aboutTitle="About the combined portfolio"
      />

      <div className="px-4 mt-6">
        <h2 className="text-[15px] font-semibold text-zinc-300 mb-2">Game rules</h2>
        <div className="text-[13px] text-zinc-500 leading-relaxed">
          Each portfolio started with $100,000 split evenly across each player's
          picks at the Feb 5, 2026 close. Partial shares allowed. Updated daily.
        </div>
      </div>

      <FilterSheet
        open={filterOpen}
        chips={filterChips}
        isOn={isOn}
        setOn={setOn}
        onClose={() => setFilterOpen(false)}
      />
      <CreateFundModal
        open={createOpen}
        editing={editing}
        onClose={() => {
          setCreateOpen(false);
          setEditing(null);
        }}
        onSaved={() => {
          refreshAfterSave();
          // Auto-enable the filter chip for a fund you just created so it
          // shows up on the chart immediately. Edits don't touch the
          // toggle — the fund is already in whatever state the user had it.
          if (!editing) {
            // Best-effort: the fresh fund's id isn't known on the client
            // yet (it's returned in the POST response, but we router.refresh
            // immediately). The chip will appear OFF by default; the user
            // can flip it on. Acceptable tradeoff for keeping refresh + save
            // decoupled.
          }
        }}
      />
      <ManageFundsSheet
        open={manageOpen}
        funds={funds}
        onClose={() => setManageOpen(false)}
        onChanged={refreshAfterSave}
        onEdit={(f) => {
          setEditing(f);
          setManageOpen(false);
          setCreateOpen(true);
        }}
      />
    </div>
  );
}

// Sports-standings style row. Stacks vertically inside the bordered card so
// the leaderboard scales to N players without the 2x2 grid breaking. Each
// row reads at a glance: rank → color dot → name + gap-to-leader (or
// "Leader" on row 1) on the left, current portfolio value + range pct on
// the right. Whole row taps through to /portfolio/{user}.
function UserRow({
  name,
  color,
  value,
  pct,
  gap,
  place,
  href,
  pendingTickers,
}: {
  name: string;
  color: string;
  value: number;
  pct: number;
  gap: number; // $ behind the leader in this range's gain; 0 when place === 1
  place: number;
  // Null for the S&P 500 baseline row — it has no drill-down page so we
  // render a plain div instead of a tappable Link.
  href: string | null;
  // Fund holdings still awaiting their first price fetch. Non-empty → the
  // shown value counts those at flat principal, so we flag it as partial.
  pendingTickers?: string[];
}) {
  const positive = pct >= 0;
  const deltaColor = positive ? "#00C805" : "#FF453A";
  const isLeader = place === 1;
  const pending = pendingTickers ?? [];
  const inner = (
    <>
      <div className="w-6 text-center text-[14px] font-semibold text-zinc-500 tabular-nums shrink-0">
        {place}
      </div>
      <div
        className="w-2.5 h-2.5 rounded-full shrink-0"
        style={{ backgroundColor: color }}
      />
      <div className="flex flex-col min-w-0 flex-1">
        <div className="text-[15px] font-semibold text-zinc-200 truncate">
          {name}
        </div>
        <div className="text-[11px] text-zinc-500 tabular-nums mt-0.5">
          {isLeader ? (
            <span
              className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
              style={{ backgroundColor: color, color: "#000" }}
            >
              Leader
            </span>
          ) : (
            <>{fmtUSD(gap, 0)} back</>
          )}
        </div>
      </div>
      <div className="flex flex-col items-end shrink-0">
        <div className="text-[16px] font-semibold text-white tabular-nums">
          {fmtUSD(value, 0)}
        </div>
        <div
          className="text-[12px] font-medium tabular-nums mt-0.5"
          style={{ color: deltaColor }}
        >
          {fmtPct(pct)}
        </div>
      </div>
    </>
  );
  // Awaiting-prices note. A just-created fund whose ticker(s) haven't been
  // fetched yet has those holdings parked at flat principal, so the value +
  // pct shown are partial. Spell that out so an "off" number reads as
  // "still loading" rather than "broken."
  const note =
    pending.length > 0 ? (
      <div className="text-[11px] text-amber-600 leading-snug mt-1.5">
        {pending.join(", ")} {pending.length === 1 ? "is" : "are"} still
        loading — full value updates at the next refresh.
      </div>
    ) : null;
  if (href == null) {
    return (
      <div className="px-3 py-3">
        <div className="flex items-center gap-3">{inner}</div>
        {note}
      </div>
    );
  }
  return (
    <Link
      href={href}
      className="block px-3 py-3 active:bg-zinc-900/40 transition-colors"
    >
      <div className="flex items-center gap-3">{inner}</div>
      {note}
    </Link>
  );
}
