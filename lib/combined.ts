// "Combined Players" fund — a synthetic, roster-derived fund that pools every
// player's picks into one $100k book.
//
// The mechanic the user asked for: imagine all N players' picks dumped into a
// single basket, then $100k spread evenly across every pick "slot." With 5
// players × 10 picks that's 50 slots at $2,000 each. A stock picked by more
// than one player occupies one slot per pick, so it carries proportionally
// more weight (AAPL picked by two players = two slots = 2/50 of the fund).
//
// We express that as a normal Fund whose holdings dedupe to unique tickers,
// each weighted by (times-picked / total-picks). fundSeries / fundHoldingRows
// in lib/portfolio.ts then value it exactly like any user-created fund.
//
// It's `synthetic: true` so the Manage-Funds sheet hides it (there's no
// config/funds.json entry to edit or archive) — it auto-derives from the
// roster, so a pick change reshapes it on the next render with no extra work.

import { START_DATE, USER_LIST } from "./picks";
import type { Fund } from "./types";

export const COMBINED_FUND_ID = "combined-players";
export const COMBINED_FUND_NAME = "Combined Players";
// Neutral slate so it reads as "the whole group" rather than any one player,
// and stays legible against both the dark default and the light theme.
export const COMBINED_FUND_COLOR = "#94A3B8";

/** Build the Combined Players fund from the current roster. Pure + cheap, so
 *  callers just invoke it per request rather than caching. */
export function combinedPlayersFund(): Fund {
  const counts = new Map<string, number>();
  let totalPicks = 0;
  for (const u of USER_LIST) {
    for (const t of u.tickers) {
      counts.set(t, (counts.get(t) ?? 0) + 1);
      totalPicks += 1;
    }
  }
  const holdings =
    totalPicks === 0
      ? []
      : [...counts.entries()].map(([ticker, count]) => ({
          ticker,
          weight: count / totalPicks,
        }));
  // createdAt anchored to the game start so the fund's curve runs the full
  // history, matching the players it pools.
  const startIso = `${START_DATE}T00:00:00.000Z`;
  return {
    id: COMBINED_FUND_ID,
    name: COMBINED_FUND_NAME,
    creator: null,
    color: COMBINED_FUND_COLOR,
    createdAt: startIso,
    updatedAt: startIso,
    deletedAt: null,
    synthetic: true,
    holdings,
  };
}

/** Total number of pick slots across the roster (duplicates counted) — the
 *  denominator behind the even allocation. */
export function totalPickSlots(): number {
  return USER_LIST.reduce((sum, u) => sum + u.tickers.length, 0);
}
