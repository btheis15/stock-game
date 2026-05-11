"use client";

import { useEffect } from "react";
import { isUsMarketOpen } from "@/lib/portfolio";

/**
 * Sets `<html data-theme="light">` while the US stock market is in regular
 * trading hours (Mon-Fri 9:30 AM - 4:00 PM ET, DST-aware) and clears it
 * when closed. Re-evaluates every 60 seconds so the page flips at the
 * moment the market opens or closes without a refresh.
 *
 * Previously this was driven by "last intraday bar < 30 min ago," which
 * read the snapshot timestamp at build time and reflected data freshness
 * rather than calendar truth — a stalled price-refresh cron would leave
 * the theme stuck on dark all day. Calendar check has no such failure
 * mode and doesn't need any snapshot data wired in.
 */
export function ThemeController() {
  useEffect(() => {
    function apply() {
      const open = isUsMarketOpen();
      const root = document.documentElement;
      if (open) root.dataset.theme = "light";
      else delete root.dataset.theme;
    }
    apply();
    const id = window.setInterval(apply, 60_000);
    return () => {
      window.clearInterval(id);
    };
  }, []);

  return null;
}
