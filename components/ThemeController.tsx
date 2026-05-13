"use client";

import { useEffect } from "react";
import { getMarketSessionState } from "@/lib/portfolio";

/**
 * Sets `<html data-theme="...">` based on the current US market session:
 *   • "light"    — regular hours (Mon-Fri 9:30 AM - 4:00 PM ET)
 *   • "twilight" — pre-market (7:00 - 9:30 AM ET) or after-hours
 *                  (4:00 - 6:00 PM ET); a cool indigo palette evoking
 *                  dawn / dusk
 *   • (none)     — overnight / weekends, falls through to the dark default
 *
 * Re-evaluates every 60 seconds so the page flips at session boundaries
 * without a refresh.
 */
export function ThemeController() {
  useEffect(() => {
    function apply() {
      const state = getMarketSessionState();
      const root = document.documentElement;
      if (state === "open") root.dataset.theme = "light";
      else if (state === "premarket" || state === "afterhours")
        root.dataset.theme = "twilight";
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
