"use client";

import { useEffect, useState } from "react";
import { fmtDateTimeET, fmtRelativeTime } from "@/lib/portfolio";

/**
 * Self-refreshing freshness label: "just now" / "N min ago" / "N hr ago",
 * falling back to an absolute ET timestamp past 6 hours (see
 * `fmtRelativeTime`). Re-renders every 30s so "2 min ago" doesn't go stale
 * while the page sits open.
 *
 * Hydration: relative time differs between the SSG render and the client's
 * clock, so the server (and first client paint) shows the absolute ET time —
 * identical on both sides — and the relative label swaps in after mount
 * (same mounted-guard pattern as WhatsNew).
 */
export function RelativeTime({
  iso,
  prefix,
  className,
}: {
  iso: string;
  prefix?: string;
  className?: string;
}) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const label = now === null ? fmtDateTimeET(iso) : fmtRelativeTime(iso, now);
  if (!label) return null;
  return (
    <span className={className}>
      {prefix ? `${prefix} ` : ""}
      {label}
    </span>
  );
}
