"use client";

import { useEffect, useState } from "react";
import { getMarketSessionState, type MarketSessionState } from "@/lib/portfolio";
import { marketEarlyCloseName, marketHolidayName } from "@/lib/market-calendar";

interface StateStyle {
  label: string;
  /** Hex color for the label text + dot. */
  color: string;
  /** When true, the dot pulses (live data flowing). */
  pulse: boolean;
}

const STATE_STYLES: Record<MarketSessionState, StateStyle> = {
  open: { label: "Market open", color: "#00C805", pulse: true },
  // Indigo-300 for both extended-hours states so the badge reads cool/dim,
  // distinct from the bright green of regular hours. Pulse stays on because
  // bars are still streaming in.
  premarket: { label: "Pre-market", color: "#A5B4FC", pulse: true },
  afterhours: { label: "After hours", color: "#A5B4FC", pulse: true },
  closed: { label: "Market closed", color: "#71717A", pulse: false },
};

// Amber for the holiday/half-day callout — distinct from the green/indigo/grey
// of the session-state dot so the "why is it flat today" notice stands out.
const NOTICE_COLOR = "#F5A623";

interface MarketSchedule {
  state: MarketSessionState;
  /** Full-closure holiday name (e.g. "Juneteenth"), or null. */
  holiday: string | null;
  /** Scheduled 1:00 PM ET early-close occasion, or null. */
  earlyClose: string | null;
}

function readSchedule(): MarketSchedule {
  return {
    state: getMarketSessionState(),
    holiday: marketHolidayName(),
    earlyClose: marketEarlyCloseName(),
  };
}

/**
 * Builds the holiday / half-day callout copy. Returns null on a normal trading
 * day (and on plain weekends — the session dot already says "Market closed").
 */
function noticeFor(schedule: MarketSchedule): string | null {
  if (schedule.holiday) {
    return `Markets closed today for ${schedule.holiday} — no new prices until the next session.`;
  }
  if (schedule.earlyClose) {
    return schedule.state === "open" || schedule.state === "premarket"
      ? `Half day — markets close early at 1:00 PM ET for ${schedule.earlyClose}.`
      : `Markets closed early today at 1:00 PM ET for ${schedule.earlyClose}.`;
  }
  return null;
}

export function MarketStateBadge({
  generatedAt,
}: {
  generatedAt?: string;
}) {
  // Self-managed: poll the calendar every 60s so the badge flips at session
  // boundaries (7:00 / 9:30 AM and 1:00 / 4:00 / 6:00 PM ET) and at the
  // midnight holiday rollover without a page reload.
  const [schedule, setSchedule] = useState<MarketSchedule>(readSchedule);
  useEffect(() => {
    setSchedule(readSchedule());
    const id = window.setInterval(() => setSchedule(readSchedule()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const style = STATE_STYLES[schedule.state];
  const notice = noticeFor(schedule);
  const updatedStr = generatedAt
    ? new Date(generatedAt).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
      })
    : null;
  return (
    <div className="px-4 -mt-1 mb-1">
      <div className="flex items-center gap-2">
        <span
          className="inline-flex items-center gap-1.5 text-[10px] font-bold tracking-[0.12em] uppercase"
          style={{ color: style.color }}
        >
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{
              backgroundColor: style.color,
              animation: style.pulse
                ? "livePulseFill 1.6s ease-out infinite"
                : undefined,
            }}
          />
          {style.label}
        </span>
        {updatedStr && (
          <span className="text-[10px] font-medium tracking-wide text-zinc-600">
            Last updated {updatedStr}
          </span>
        )}
      </div>
      {notice && (
        <div
          className="mt-1.5 flex items-start gap-1.5 text-[11px] font-medium leading-snug"
          style={{ color: NOTICE_COLOR }}
        >
          <span aria-hidden className="mt-[1px]">
            ●
          </span>
          <span>{notice}</span>
        </div>
      )}
    </div>
  );
}
