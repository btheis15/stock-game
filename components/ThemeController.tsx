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
// Keep in sync with the --background values in globals.css so the iOS
// status bar / browser chrome matches the active theme instead of staying
// black in light mode.
const THEME_COLORS: Record<string, string> = {
  light: "#fafafa",
  twilight: "#0b1024",
  dark: "#000000",
};

function syncThemeColorMeta(theme: string) {
  const color = THEME_COLORS[theme] ?? THEME_COLORS.dark;
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.appendChild(meta);
  }
  meta.content = color;
}

// Manual theme override — the QA lever for eyeballing all three themes
// without waiting for a market-session boundary (the 60s re-apply loop
// otherwise fights DevTools edits within a minute). Set via query param and
// persisted: `?theme=light|twilight|dark` pins the theme until `?theme=auto`
// (or clearing localStorage) hands control back to the session clock. Left
// enabled in production on purpose — it's how theme bug reports from the
// group get reproduced on-device.
const THEME_OVERRIDE_KEY = "theme-override";
const VALID_OVERRIDES = new Set(["light", "twilight", "dark"]);

function readThemeOverride(): string | null {
  try {
    const param = new URLSearchParams(window.location.search).get("theme");
    if (param === "auto") {
      window.localStorage.removeItem(THEME_OVERRIDE_KEY);
      return null;
    }
    if (param && VALID_OVERRIDES.has(param)) {
      window.localStorage.setItem(THEME_OVERRIDE_KEY, param);
      return param;
    }
    const stored = window.localStorage.getItem(THEME_OVERRIDE_KEY);
    return stored && VALID_OVERRIDES.has(stored) ? stored : null;
  } catch {
    return null;
  }
}

export function ThemeController() {
  useEffect(() => {
    function apply() {
      const root = document.documentElement;
      const override = readThemeOverride();
      if (override) {
        if (override === "dark") delete root.dataset.theme;
        else root.dataset.theme = override;
        syncThemeColorMeta(override);
        return;
      }
      const state = getMarketSessionState();
      if (state === "open") root.dataset.theme = "light";
      else if (state === "premarket" || state === "afterhours")
        root.dataset.theme = "twilight";
      else delete root.dataset.theme;
      syncThemeColorMeta(root.dataset.theme ?? "dark");
    }
    apply();
    const id = window.setInterval(apply, 60_000);
    return () => {
      window.clearInterval(id);
    };
  }, []);

  return null;
}
