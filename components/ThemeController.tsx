"use client";

import { useEffect } from "react";

const LIVE_MAX_LAG_MS = 30 * 60 * 1000;

/**
 * Sets `<html data-theme="light">` while the market is open and clears the
 * attribute when it's closed. Mirrors `isMarketLive` in lib/portfolio.ts so the
 * theme tracks the same "last bar < 30 min ago" rule as the LIVE pulse and the
 * MarketStateBadge — when those say "Market open," the app is light; when they
 * say "Market closed," the app is dark.
 *
 * Re-evaluates every 60 seconds so the page flips at the moment the market
 * crosses the live threshold without needing a refresh.
 */
export function ThemeController({
  latestIntradayTs,
}: {
  /** ISO timestamp of the most recent intraday bar in the snapshot. */
  latestIntradayTs?: string;
}) {
  useEffect(() => {
    if (!latestIntradayTs) return;
    const lastBar = new Date(latestIntradayTs).getTime();

    function apply() {
      const live = Date.now() - lastBar < LIVE_MAX_LAG_MS;
      const root = document.documentElement;
      if (live) root.dataset.theme = "light";
      else delete root.dataset.theme;
    }

    apply();
    const id = window.setInterval(apply, 60_000);
    return () => {
      window.clearInterval(id);
    };
  }, [latestIntradayTs]);

  return null;
}
