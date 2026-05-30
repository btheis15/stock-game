import "server-only";
import type { FundamentalsData, PriceData, TickerSeries } from "./types";
import { STARTING_PORTFOLIO_DOLLARS, TICKER_NAMES, USER_LIST } from "./picks";
import { dividendsReceived, fmtUSD, lastKnownClose } from "./portfolio";
import {
  detectThemes,
  playerStyleLabel,
  type CompositionSlice,
  type PortfolioAnalysis,
} from "./portfolio-composition";
import { totalPickSlots } from "./combined";

// Builds the game-wide "Participant breakdown" — the Combined Players fund
// ($100k spread evenly across every pick slot) sliced by which player each
// slot belongs to. A stock two players picked contributes one slot's value to
// each of their slices, so shared names split cleanly across owners.
//
// Mirrors lib/portfolio-composition.ts in shape (CompositionSlice[] +
// PortfolioAnalysis) so the same donut + about-card renders both. Runs on the
// server at request time.

export interface ParticipantBreakdown {
  totalValue: number;
  /** One slice per player, value = current worth of that player's pick slots
   *  within the combined fund. */
  participants: CompositionSlice[];
  analysis: PortfolioAnalysis;
}

/** Current value of a single equal-weight pick slot of `ticker`. Returns null
 *  when the ticker isn't in the snapshot yet. */
function slotValue(series: TickerSeries, slotDollars: number): number {
  const last = series.closes[series.closes.length - 1];
  if (!last) return 0;
  const shares = slotDollars / series.startClose;
  return shares * last.close + dividendsReceived(series, shares, last.date);
}

export function buildParticipantBreakdown(
  data: PriceData,
  fundamentals: FundamentalsData | null
): ParticipantBreakdown {
  const fmap = fundamentals?.tickers ?? {};
  const slots = totalPickSlots();
  const slotDollars = slots === 0 ? 0 : STARTING_PORTFOLIO_DOLLARS / slots;
  const nameOf = (t: string) => fmap[t]?.name ?? TICKER_NAMES[t] ?? t;

  // First pass: per-player slot values so we know each player's total and the
  // grand total before computing within-slice / within-fund percentages.
  const perPlayer = USER_LIST.map((u) => {
    const rows = u.tickers
      .map((t) => {
        const s = data.tickers[t];
        if (!s || s.closes.length === 0) return null;
        return { ticker: t, name: nameOf(t), value: slotValue(s, slotDollars) };
      })
      .filter((r): r is { ticker: string; name: string; value: number } => r != null);
    const value = rows.reduce((sum, r) => sum + r.value, 0);
    return { user: u, rows, value };
  });

  const totalValue = perPlayer.reduce((sum, p) => sum + p.value, 0);

  const participants: CompositionSlice[] = perPlayer
    .map((p) => ({
      key: p.user.name,
      value: p.value,
      pct: totalValue === 0 ? 0 : p.value / totalValue,
      color: p.user.color,
      tickers: p.rows
        .map((r) => ({
          ticker: r.ticker,
          name: r.name,
          value: r.value,
          pct: p.value === 0 ? 0 : r.value / p.value,
          portfolioPct: totalValue === 0 ? 0 : r.value / totalValue,
        }))
        .sort((a, b) => b.value - a.value),
    }))
    .sort((a, b) => b.value - a.value);

  const analysis = writePlayersAnalysis(slotDollars);

  return { totalValue, participants, analysis };
}

// --- About the players (Claude analysis) ----------------------------------
//
// Static + structural, matching the per-player "About this portfolio" card:
// describes the mechanic and how the field's styles overlap, never anything
// price-dependent (the donut + leaderboard above carry the live numbers).

function writePlayersAnalysis(slotDollars: number): PortfolioAnalysis {
  const n = USER_LIST.length;
  const slots = totalPickSlots();

  // Tickers more than one player chose — the names that carry extra weight in
  // the pooled fund.
  const counts = new Map<string, number>();
  for (const u of USER_LIST) for (const t of u.tickers) counts.set(t, (counts.get(t) ?? 0) + 1);
  const shared = [...counts.entries()]
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([t]) => t);

  const allTickers = USER_LIST.flatMap((u) => u.tickers);
  const themes = detectThemes(allTickers).slice(0, 4);

  // Per-player style rundown, e.g. "Kevin (AI buildout — picks and shovels)".
  // Labels are kept verbatim so acronyms like "AI" stay capitalized. Players
  // without a hand-written label are skipped.
  const styleBits = USER_LIST.map((u) => {
    const label = playerStyleLabel(u.id);
    return label ? `${u.name} (${label})` : null;
  }).filter((x): x is string => x != null);

  const sharedSentence =
    shared.length > 0
      ? ` The names more than one player picked — ${joinList(shared)} — hold a slot apiece for each pick, so they carry the heaviest weight.`
      : "";

  const paragraphs: string[] = [
    `The Combined Players fund melts every player's picks into a single $100,000 book. There are ${slots} pick slots in all, each funded with an equal ${fmtUSD(slotDollars, 0)} at the Feb 5, 2026 open.${sharedSentence}`,
  ];

  if (styleBits.length > 0) {
    paragraphs.push(
      `The field doesn't think alike — ${joinList(styleBits)}. Pooled together, those bets blend into one diversified book no single player would have built alone.`
    );
  }

  if (themes.length > 0) {
    paragraphs.push(
      `Across the whole roster the recurring threads are ${joinList(themes.map((t) => t.name))} — the structural ideas the group keeps returning to, even when they disagree on the specific names.`
    );
  }

  return {
    headline: `All ${n} players' picks, pooled into one equal-weight fund.`,
    styleLabel: "The field",
    paragraphs,
    themes,
  };
}

function joinList(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}
