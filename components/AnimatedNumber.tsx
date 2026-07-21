"use client";

// Count-up/down for headline numbers: eases the DISPLAYED value to the new
// one over ~450ms (cubic ease-out, rAF; tabular-nums so digits don't
// jiggle). Two hard rules, both load-bearing:
//
//   1. `animate={false}` MUST be passed while a scrub is active — a scrub
//      is frame-locked to the finger, so values render RAW, never eased
//      (DESIGN.md §6). The component then renders format(value) directly
//      with zero per-frame work.
//   2. Honors Reduce Motion via framer's useReducedMotion (same signal as
//      the CSS layer): reduced → instant values.
import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";

export function AnimatedNumber({
  value,
  format,
  animate = true,
  duration = 450,
}: {
  value: number;
  format: (n: number) => string;
  animate?: boolean;
  duration?: number;
}) {
  const reduced = useReducedMotion();
  const live = animate && !reduced;
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!live) {
      fromRef.current = value;
      return;
    }
    const from = fromRef.current;
    if (from === value) return;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (value - from) * eased);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = value;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      fromRef.current = value;
    };
  }, [value, live, duration]);

  return <span className="tabular-nums">{format(live ? display : value)}</span>;
}
