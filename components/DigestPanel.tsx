"use client";

import { useMemo, useState } from "react";
import type { WindowDigest } from "@/lib/digests";
import type { Range } from "@/lib/types";
import { fmtDateShort } from "@/lib/portfolio";

interface Props {
  digest: WindowDigest | null;
  loading: boolean;
  range: Range;
}

const RANGE_LABELS: Record<Range, string> = {
  "1D": "Today",
  "1W": "This week",
  "1M": "This month",
  "3M": "This quarter",
  "1YR": "This year",
  ALL: "Since Feb 5, 2026",
};

const SHORT_RANGE_LABELS: Record<Range, string> = {
  "1D": "Daily briefing",
  "1W": "Weekly briefing",
  "1M": "Monthly briefing",
  "3M": "Quarterly briefing",
  "1YR": "Annual briefing",
  ALL: "Game-to-date briefing",
};

export function DigestPanel({ digest, loading, range }: Props) {
  const [expanded, setExpanded] = useState(false);

  // Render nothing while the JSON is still loading on the first paint.
  // The space stays empty briefly rather than flashing a placeholder.
  if (loading) return null;
  if (!digest) return null;

  if (digest.dataMaturity === "insufficient") {
    return <InsufficientPanel range={range} digest={digest} />;
  }

  return (
    <div className="px-4 mt-3">
      <div className="rounded-2xl bg-zinc-900/70 border border-zinc-800 overflow-hidden">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="w-full text-left px-4 py-3 flex items-start gap-3"
        >
          <SignalDot avg={digest.avgRelevanceScore} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-bold tracking-[0.12em] uppercase text-zinc-500">
                {SHORT_RANGE_LABELS[range]}
              </span>
              <span className="flex items-center gap-2">
                {digest.dataMaturity === "partial" && (
                  <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-zinc-500">
                    Partial
                  </span>
                )}
                <InlineAIAttribution digest={digest} />
              </span>
            </div>
            <p
              className={`mt-1.5 text-[13px] leading-[1.55] text-zinc-200 ${
                expanded ? "" : "line-clamp-3"
              }`}
            >
              {digest.digest}
            </p>
            <span className="mt-2 inline-block text-[11px] text-zinc-500 hover:text-zinc-300">
              {expanded ? "Show less" : "Show more"}
            </span>
          </div>
        </button>

        {expanded && (
          <div className="px-4 pb-4 pt-1 border-t border-zinc-800">
            <DigestMeta digest={digest} range={range} />
            {digest.sources && digest.sources.length > 0 && (
              <div className="mt-3">
                <div className="text-[11px] font-bold tracking-[0.12em] uppercase text-zinc-500 mb-2">
                  Sources
                </div>
                <ul className="space-y-2">
                  {digest.sources.slice(0, 6).map((s) => (
                    <li key={s.link}>
                      <a
                        href={s.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[12px] leading-[1.4] text-zinc-300 hover:text-white block"
                      >
                        {s.title}
                        <span className="ml-1.5 text-zinc-500">· {s.source}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SignalDot({ avg }: { avg: number | null }) {
  // Green dot for a high-quality digest (≥8), yellow for moderate (6–7).
  // The dot doesn't appear if no AI scoring happened.
  if (avg == null) return <span className="w-2 h-2 mt-1.5 rounded-full bg-zinc-600 shrink-0" />;
  const color = avg >= 8 ? "#00C805" : avg >= 6 ? "#FFCC00" : "#71717A";
  return (
    <span
      className="w-2 h-2 mt-1.5 rounded-full shrink-0"
      style={{ backgroundColor: color }}
      title={`Avg relevance ${avg.toFixed(1)}`}
    />
  );
}

function DigestMeta({ digest, range }: { digest: WindowDigest; range: Range }) {
  const dateLabel = useMemo(() => {
    if (!digest.dateRange) return null;
    const { from, to } = digest.dateRange;
    return from === to ? fmtDateShort(from) : `${fmtDateShort(from)} – ${fmtDateShort(to)}`;
  }, [digest.dateRange]);

  const updatedTime = useMemo(() => {
    try {
      const d = new Date(digest.generatedAt);
      return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    } catch {
      return null;
    }
  }, [digest.generatedAt]);

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-500">
      <span>{RANGE_LABELS[range]}</span>
      {dateLabel && <span>· {dateLabel}</span>}
      <span>· Based on {digest.articleCount} article{digest.articleCount === 1 ? "" : "s"}</span>
      {updatedTime && <span>· Updated {updatedTime}</span>}
    </div>
  );
}

// Subtle Apple-Intelligence attribution rendered inline on the briefing
// header row (right side, next to the "Daily briefing" / "Weekly briefing"
// label) so the credit is always visible without needing to expand the
// card. Tiny gray text — readable but doesn't compete with the headline.
function InlineAIAttribution({ digest }: { digest: WindowDigest }) {
  const engineLabel =
    digest.aiEngine === "AppleIntelligence"
      ? "Apple Intelligence"
      : digest.aiEngine ?? null;
  if (!engineLabel) return null;
  return (
    <span className="text-[10px] tracking-[0.04em] text-zinc-600 whitespace-nowrap">
      ⬡ {engineLabel}
    </span>
  );
}

function InsufficientPanel({ range, digest }: { range: Range; digest: WindowDigest }) {
  const remaining = Math.max(0, digest.daysRequired - digest.daysOfData);
  const label = (() => {
    switch (range) {
      case "1W":
        return `Weekly digest available in ${remaining} more day${remaining === 1 ? "" : "s"}`;
      case "1M":
        return `Monthly digest available after ~${remaining} more days of data`;
      case "3M":
        return `3-month digest available after ~${remaining} more days of data`;
      case "1YR":
        return `Annual digest available after ~${remaining} more days of data`;
      default:
        return `Digest available after ~${remaining} more days of data`;
    }
  })();
  return (
    <div className="px-4 mt-3">
      <div className="rounded-2xl bg-zinc-900/40 border border-dashed border-zinc-800 px-4 py-3">
        <div className="text-[11px] font-bold tracking-[0.12em] uppercase text-zinc-500">
          {SHORT_RANGE_LABELS[range]}
        </div>
        <div className="mt-1 text-[12px] text-zinc-400">{label}</div>
      </div>
    </div>
  );
}
