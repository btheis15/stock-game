"use client";

import { useEffect, useState } from "react";
import { isUsMarketOpen } from "@/lib/portfolio";

export function MarketStateBadge({
  generatedAt,
}: {
  generatedAt?: string;
}) {
  // Self-managed: poll the calendar every 60s so the badge flips at 9:30 AM
  // and 4:00 PM ET without a page reload. The previous version was driven
  // by `Date.now() - lastIntradayBar < 30 min`, which conflated data
  // freshness with market hours — when the price-refresh cron went stale
  // (digest pipeline blocking it, sleep, network blip), the badge would
  // wrongly say "Market closed" mid-afternoon. Calendar check has no such
  // failure mode.
  const [open, setOpen] = useState(() => isUsMarketOpen());
  useEffect(() => {
    setOpen(isUsMarketOpen());
    const id = window.setInterval(() => setOpen(isUsMarketOpen()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const updatedStr = generatedAt
    ? new Date(generatedAt).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
      })
    : null;
  return (
    <div className="px-4 -mt-1 mb-1 flex items-center gap-2">
      {open ? (
        <span className="inline-flex items-center gap-1.5 text-[10px] font-bold tracking-[0.12em] uppercase text-[#00C805]">
          <span
            className="w-1.5 h-1.5 rounded-full bg-[#00C805]"
            style={{ animation: "livePulseFill 1.6s ease-out infinite" }}
          />
          Market open
        </span>
      ) : (
        <span className="inline-flex items-center gap-1.5 text-[10px] font-bold tracking-[0.12em] uppercase text-zinc-500">
          <span className="w-1.5 h-1.5 rounded-full bg-zinc-600" />
          Market closed
        </span>
      )}
      {updatedStr && (
        <span className="text-[10px] font-medium tracking-wide text-zinc-600">
          Last updated {updatedStr}
        </span>
      )}
    </div>
  );
}
