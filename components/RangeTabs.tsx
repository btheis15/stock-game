"use client";

import clsx from "clsx";
import { LayoutGroup, motion } from "framer-motion";
import type { Range } from "@/lib/types";

const RANGES: Range[] = ["1D", "1W", "1M", "3M", "1YR", "ALL"];

export function RangeTabs({
  value,
  onChange,
  accent = "var(--gain)",
}: {
  value: Range;
  onChange: (r: Range) => void;
  accent?: string;
}) {
  return (
    <LayoutGroup id="range-tabs">
      <div
        role="tablist"
        aria-label="Chart range"
        className="flex items-center justify-around w-full px-2 py-3"
      >
        {RANGES.map((r) => {
          const active = r === value;
          return (
            <button
              key={r}
              role="tab"
              aria-selected={active}
              onClick={() => onChange(r)}
              className={clsx(
                "relative px-3 py-1.5 rounded-full text-[13px] font-semibold tracking-wide transition-colors",
                active ? "text-black" : "text-ink-muted hover:text-ink-2"
              )}
            >
              {/* Shared-layout pill glides between tabs instead of
                  teleporting; the label sits above it. */}
              {active && (
                <motion.span
                  layoutId="range-pill"
                  transition={{ type: "spring", stiffness: 500, damping: 40 }}
                  className="absolute inset-0 rounded-full"
                  style={{ backgroundColor: accent }}
                  aria-hidden
                />
              )}
              <span className="relative">{r}</span>
            </button>
          );
        })}
      </div>
    </LayoutGroup>
  );
}
