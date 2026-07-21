"use client";

// The stakes, made visible: a progress bar from game start (Feb 5, 2026) to
// game end (Feb 5, 2031) with "N days until someone pays for golf." Client
// component with a mounted guard so the day count can't cause a hydration
// mismatch across a midnight boundary (same pattern as RelativeTime).
import { useEffect, useState } from "react";

const GAME_START_MS = Date.parse("2026-02-05T00:00:00-05:00");
const GAME_END_MS = Date.parse("2031-02-05T00:00:00-05:00");
const DAY_MS = 24 * 60 * 60 * 1000;

export function GolfCountdown() {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => setNow(Date.now()), []);
  if (now == null) return null;

  const elapsed = Math.min(1, Math.max(0, (now - GAME_START_MS) / (GAME_END_MS - GAME_START_MS)));
  const daysLeft = Math.max(0, Math.ceil((GAME_END_MS - now) / DAY_MS));

  return (
    <div className="mt-4">
      <div className="flex items-baseline justify-between text-[11px] text-ink-faint">
        <span className="font-bold tracking-[0.12em] uppercase">The long game</span>
        <span className="tabular-nums">
          {daysLeft.toLocaleString()} days until someone pays for golf ⛳
        </span>
      </div>
      <div className="mt-1.5 h-[3px] rounded-full bg-raised overflow-hidden">
        <div
          className="h-full rounded-full bg-gain"
          style={{ width: `${(elapsed * 100).toFixed(2)}%` }}
        />
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-ink-ghost tabular-nums">
        <span>Feb 5, 2026</span>
        <span>Feb 5, 2031</span>
      </div>
    </div>
  );
}
