"use client";

import { useEffect, useState } from "react";

/**
 * Display-P3 accent selection.
 *
 * Player accents ship in two forms (config/roster.json): an sRGB hex
 * (`color`) and an optional wide-gamut `color(display-p3 …)` string
 * (`colorP3`). CSS contexts pick the right one automatically via the
 * `@supports (color: color(display-p3 1 1 1))` blocks in globals.css /
 * layout.tsx; these helpers cover the places CSS can't — values passed as
 * SVG attributes (chart strokes, gradient stops), which don't resolve
 * `var()` or `@supports`.
 *
 * `useP3` starts false on the server AND the first client paint, so SSR
 * markup always matches hydration; the flip to true after mount re-renders
 * chart colors into the wide gamut (imperceptible swap, no mismatch
 * warnings).
 */
export function useP3(): boolean {
  const [p3, setP3] = useState(false);
  useEffect(() => {
    try {
      setP3(CSS.supports("color", "color(display-p3 1 1 1)"));
    } catch {
      // Older browsers without CSS.supports keep the sRGB fallback.
    }
  }, []);
  return p3;
}

/** The entity's accent for the current display: P3 when supported and
 *  defined, else the sRGB hex. Safe for SVG attributes and inline styles. */
export function accentFor(
  entity: { color: string; colorP3?: string },
  p3: boolean
): string {
  return p3 && entity.colorP3 ? entity.colorP3 : entity.color;
}
