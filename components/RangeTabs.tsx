"use client";

import clsx from "clsx";
import type { Range } from "@/lib/types";

const RANGES: Range[] = ["1D", "1W", "1M", "3M", "1YR", "ALL"];

export function RangeTabs({
  value,
  onChange,
  accent = "#00C805",
}: {
  value: Range;
  onChange: (r: Range) => void;
  accent?: string;
}) {
  return (
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
              "px-3 py-1.5 rounded-full text-[13px] font-semibold tracking-wide transition-colors",
              active ? "text-black" : "text-ink-muted hover:text-ink-2"
            )}
            style={active ? { backgroundColor: accent } : undefined}
          >
            {r}
          </button>
        );
      })}
    </div>
  );
}
