"use client";

// The golf side bet — Brian vs Kevin only, not the whole group. Every year
// on the Feb 5 anniversary of game start, whichever of the two has the worse
// TOTAL return since Feb 5, 2026 (the running aggregate, not that year's
// return alone) buys a round of golf. It repeats every year the game runs,
// not just once at the far end — so this shows the countdown to the NEXT
// annual reckoning, not a single game-end date. Client component with a
// mounted guard so the day count can't cause a hydration mismatch across a
// midnight boundary (same pattern as RelativeTime).
import { useEffect, useState } from "react";
import { fmtPct } from "@/lib/portfolio";
import { USERS } from "@/lib/picks";

const GAME_START_MS = Date.parse("2026-02-05T00:00:00-05:00");
const DAY_MS = 24 * 60 * 60 * 1000;

// Feb 5 recurs at the same local wall-clock instant every year; -05:00 (EST)
// is right for Feb regardless of the current year's DST state.
function feb5(year: number): number {
  return Date.parse(`${year}-02-05T00:00:00-05:00`);
}

export function GolfCountdown({
  brianPct,
  kevinPct,
}: {
  brianPct?: number;
  kevinPct?: number;
}) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => setNow(Date.now()), []);
  if (now == null) return null;

  const startYear = new Date(GAME_START_MS).getUTCFullYear();
  let cycleStart = GAME_START_MS;
  let nextCheckpoint = feb5(startYear + 1);
  while (nextCheckpoint <= now) {
    cycleStart = nextCheckpoint;
    nextCheckpoint = feb5(new Date(nextCheckpoint).getUTCFullYear() + 1);
  }

  const elapsed = Math.min(
    1,
    Math.max(0, (now - cycleStart) / (nextCheckpoint - cycleStart))
  );
  const daysLeft = Math.max(0, Math.ceil((nextCheckpoint - now) / DAY_MS));
  const checkpointLabel = new Date(nextCheckpoint).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const gap =
    brianPct != null && kevinPct != null ? brianPct - kevinPct : null;
  const onTheHook =
    gap == null || gap === 0 ? null : gap < 0 ? "brian" : "kevin";

  return (
    <div className="mt-4">
      <div className="flex items-baseline justify-between text-[11px] text-ink-faint">
        <span className="font-bold tracking-[0.12em] uppercase">The golf bet</span>
        <span className="tabular-nums">
          {daysLeft.toLocaleString()} days to the next reckoning ⛳
        </span>
      </div>
      <div className="mt-1.5 h-[3px] rounded-full bg-raised overflow-hidden">
        <div
          className="h-full rounded-full bg-gain"
          style={{ width: `${(elapsed * 100).toFixed(2)}%` }}
        />
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-ink-ghost tabular-nums">
        <span>{new Date(cycleStart).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</span>
        <span>{checkpointLabel}</span>
      </div>
      <p className="mt-2 text-[12px] text-ink-faint leading-relaxed">
        Brian vs Kevin, just the two of them: every Feb 5, whoever's behind on
        total return since game start buys the round. It's the running score
        since Feb 5, 2026, not just that year — and it happens again the
        following Feb 5, and the one after that.
      </p>
      {brianPct != null && kevinPct != null && (
        <div className="mt-1.5 flex items-center gap-3 text-[12px] tabular-nums">
          <span style={{ color: USERS.brian.color }}>
            Brian {fmtPct(brianPct)}
          </span>
          <span className="text-ink-ghost">·</span>
          <span style={{ color: USERS.kevin.color }}>
            Kevin {fmtPct(kevinPct)}
          </span>
          {onTheHook && (
            <span className="text-ink-faint">
              — {USERS[onTheHook].name} is on the hook right now
            </span>
          )}
        </div>
      )}
    </div>
  );
}
