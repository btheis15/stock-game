"use client";

import { useEffect, useState } from "react";
import { getMarketSessionState, type MarketSessionState } from "@/lib/portfolio";

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

export function MarketStateBadge({
  generatedAt,
}: {
  generatedAt?: string;
}) {
  // Self-managed: poll the calendar every 60s so the badge flips at session
  // boundaries (7:00 / 9:30 AM and 4:00 / 6:00 PM ET) without a page reload.
  const [state, setState] = useState<MarketSessionState>(() =>
    getMarketSessionState()
  );
  useEffect(() => {
    setState(getMarketSessionState());
    const id = window.setInterval(
      () => setState(getMarketSessionState()),
      60_000
    );
    return () => window.clearInterval(id);
  }, []);

  const style = STATE_STYLES[state];
  const updatedStr = generatedAt
    ? new Date(generatedAt).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
      })
    : null;
  return (
    <div className="px-4 -mt-1 mb-1 flex items-center gap-2">
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
  );
}
