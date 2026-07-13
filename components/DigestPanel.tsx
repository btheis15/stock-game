"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { WindowDigest } from "@/lib/digests";
import type { Range } from "@/lib/types";
import { fmtDateShort } from "@/lib/portfolio";
import { ALL_TICKERS, SPINOFF_CHILD_TICKERS, USER_LIST } from "@/lib/picks";
import { RelativeTime } from "@/components/RelativeTime";

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

/**
 * Strips the markdown the AI occasionally sneaks into digest prose (43
 * shipped digests carry a literal `**AAPL [+2.11%] Briefing**` header that
 * renders as raw asterisks). Pure string → string, no markdown library:
 *   1. A leading self-titled bold "…Briefing" header line is dropped
 *      entirely — the card already has its own kicker.
 *   2. Remaining paired `**` / `__` emphasis markers are unwrapped.
 *   3. Leading `#` heading markers are removed.
 */
export function stripDigestMarkdown(prose: string): string {
  let s = prose;
  // (1) Self-titled bold header, e.g. "**AAPL [+2.11%] Briefing**\n\n…".
  s = s.replace(/^\s*\*\*[^*\n]*Briefing[.:]?\*\*[ \t]*:?\n*/i, "");
  // (3) Heading markers at the start of any line.
  s = s.replace(/^#{1,6}[ \t]+/gm, "");
  // (2) Paired emphasis markers, keeping the inner text.
  s = s.replace(/\*\*([^*]+)\*\*/g, "$1");
  s = s.replace(/__([^_]+)__/g, "$1");
  return s.trim();
}

// Linkable vocabulary: roster tickers (plus spin-off children — they have
// /stock pages too) and player first names. Module-level — the roster is
// static per build.
const TICKER_SET = new Set<string>([...ALL_TICKERS, ...SPINOFF_CHILD_TICKERS]);
const NAME_TO_USER_ID = new Map<string, string>(
  USER_LIST.map((u) => [u.name, u.id])
);

// Bracketed live-pct tokens the fast tier writes into game prose, e.g.
// "[+2.11%]" / "[-3.8%]". The brackets are pipeline plumbing, not UI.
const PCT_TOKEN_RE = /\[([+\-−]\d+(?:\.\d+)?%)\]/g;
const WORD_RE = /[A-Za-z][A-Za-z0-9]*/g;

const PROSE_LINK_CLASS =
  "font-medium underline decoration-zinc-700 underline-offset-2";

/**
 * Turns digest prose into rich nodes:
 *  - `[±X.XX%]` tokens → colored tabular-nums spans, brackets dropped and
 *    ASCII hyphen normalized to U+2212 (matches fmtPct).
 *  - Exact whole-word ticker matches → subtle links to /stock/{ticker};
 *    exact player first names → /portfolio/{id}. Case-sensitive on purpose.
 */
function renderProse(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let key = 0;
  let last = 0;
  PCT_TOKEN_RE.lastIndex = 0;
  for (let m = PCT_TOKEN_RE.exec(text); m; m = PCT_TOKEN_RE.exec(text)) {
    if (m.index > last) out.push(...linkifyWords(text.slice(last, m.index), () => key++));
    const positive = m[1].startsWith("+");
    out.push(
      <span
        key={`pct-${key++}`}
        className="tabular-nums font-medium"
        style={{ color: positive ? "#00C805" : "#FF453A" }}
      >
        {m[1].replace("-", "−")}
      </span>
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(...linkifyWords(text.slice(last), () => key++));
  return out;
}

function linkifyWords(text: string, nextKey: () => number): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  WORD_RE.lastIndex = 0;
  for (let m = WORD_RE.exec(text); m; m = WORD_RE.exec(text)) {
    const word = m[0];
    const isTicker = TICKER_SET.has(word);
    const userId = isTicker ? undefined : NAME_TO_USER_ID.get(word);
    if (!isTicker && !userId) continue;
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      <Link
        key={`lnk-${nextKey()}`}
        href={isTicker ? `/stock/${word}` : `/portfolio/${userId}`}
        className={PROSE_LINK_CLASS}
        onClick={(e) => e.stopPropagation()}
      >
        {word}
      </Link>
    );
    last = m.index + word.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function DigestPanel({ digest, loading, range }: Props) {
  const [expanded, setExpanded] = useState(false);
  // Whether the collapsed prose actually overflows its 3-line clamp. Until
  // measured, assume it does so the affordance doesn't flash in.
  const [clamped, setClamped] = useState(true);
  const proseRef = useRef<HTMLParagraphElement>(null);

  const prose = useMemo(
    () => (digest?.digest ? stripDigestMarkdown(digest.digest) : null),
    [digest]
  );
  const proseNodes = useMemo(() => (prose ? renderProse(prose) : null), [prose]);

  // Mount-time check: if the prose fits inside the clamp there's nothing to
  // reveal, so the "Show more" affordance is noise. (Meta + sources stay
  // reachable — the whole card is still tappable.)
  useLayoutEffect(() => {
    const el = proseRef.current;
    if (!el || expanded) return;
    setClamped(el.scrollHeight > el.clientHeight + 1);
  }, [prose, expanded]);

  if (loading) return <DigestSkeleton range={range} />;
  if (!digest) return null;

  if (digest.dataMaturity === "insufficient") {
    return <InsufficientPanel range={range} digest={digest} />;
  }

  if (!prose) return null;

  return (
    <div className="px-4 mt-3">
      <div className="rounded-2xl bg-zinc-900/70 border border-zinc-800 overflow-hidden">
        {/* Whole-card tap target. A div, not a button — the prose contains
            real links now, and nested interactive elements are invalid HTML.
            The "Show more" button below supplies keyboard access; taps on it
            bubble here (no double-toggle: it has no handler of its own). */}
        <div
          onClick={() => setExpanded((v) => !v)}
          className="w-full text-left px-4 py-3 flex items-start gap-3 cursor-pointer"
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
              ref={proseRef}
              className={`mt-1.5 text-[13px] leading-[1.55] text-zinc-200 ${
                expanded ? "" : "line-clamp-3"
              }`}
            >
              {proseNodes}
            </p>
            {(clamped || expanded) && (
              <button
                type="button"
                aria-expanded={expanded}
                className="mt-2 inline-block text-[11px] text-zinc-500 hover:text-zinc-300"
              >
                {expanded ? "Show less" : "Show more"}
              </button>
            )}
          </div>
        </div>

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

// Loading placeholder matching the collapsed card's exact shell so the real
// card lands without a layout pop: one kicker-width bar + three text-line
// bars sized to the 3-line clamped prose (13px lines at 1.55 leading).
function DigestSkeleton({ range }: { range: Range }) {
  return (
    <div className="px-4 mt-3" aria-hidden>
      <div className="rounded-2xl bg-zinc-900/70 border border-zinc-800 overflow-hidden">
        <div className="w-full px-4 py-3 flex items-start gap-3">
          <span className="skeleton w-2 h-2 mt-1.5 rounded-full bg-zinc-800/40 shrink-0" />
          <div className="flex-1 min-w-0">
            <div
              className="skeleton bg-zinc-800/40 rounded h-[11px] my-[3px]"
              style={{ width: `${SHORT_RANGE_LABELS[range].length * 7}px` }}
            />
            <div className="mt-[9px] space-y-[7px]">
              <div className="skeleton bg-zinc-800/40 rounded h-[13px]" />
              <div className="skeleton bg-zinc-800/40 rounded h-[13px]" />
              <div className="skeleton bg-zinc-800/40 rounded h-[13px] w-2/3" />
            </div>
          </div>
        </div>
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

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-500">
      <span>{RANGE_LABELS[range]}</span>
      {dateLabel && <span>· {dateLabel}</span>}
      <span>· Based on {digest.articleCount} article{digest.articleCount === 1 ? "" : "s"}</span>
      {digest.generatedAt && (
        <span>
          · <RelativeTime iso={digest.generatedAt} prefix="Updated" />
        </span>
      )}
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
      ⬡ Summarized by {engineLabel}
    </span>
  );
}

// What each range's briefing is, in game-speak, for the not-enough-data-yet
// copy below.
const STORY_NAMES: Record<Range, string> = {
  "1D": "daily",
  "1W": "weekly",
  "1M": "monthly",
  "3M": "3-month",
  "1YR": "one-year",
  ALL: "full",
};

function InsufficientPanel({ range, digest }: { range: Range; digest: WindowDigest }) {
  const remaining = Math.max(0, digest.daysRequired - digest.daysOfData);
  // Game-speak, not system-speak (DESIGN §7.4 — one dim sentence). This only
  // renders client-side after the digests fetch resolves, so Date.now() can't
  // cause a hydration mismatch.
  const startDate = new Date(Date.now() + remaining * 24 * 60 * 60 * 1000);
  const dateStr = startDate.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  const label = `The ${STORY_NAMES[range]} story starts ${dateStr} — about ${remaining} day${
    remaining === 1 ? "" : "s"
  } away.`;
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
