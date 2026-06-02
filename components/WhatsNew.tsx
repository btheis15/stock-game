"use client";

import { useEffect, useMemo, useState } from "react";
import { Sheet } from "@/components/Sheet";
import { recentEntries, type ChangelogEntry } from "@/lib/changelog";

// Marks the newest update date the user has already seen. When the newest
// recent entry is more recent than this, the bell shows an unread dot.
const SEEN_KEY = "stockgame.whatsNewSeen";

export function WhatsNew() {
  // Everything that depends on localStorage / Date.now() is gated behind
  // `mounted` so the server-rendered markup (no badge) matches the first
  // client paint — otherwise React complains about a hydration mismatch.
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [seenDate, setSeenDate] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
    try {
      setSeenDate(localStorage.getItem(SEEN_KEY));
    } catch {}
  }, []);

  const entries = useMemo(() => (mounted ? recentEntries() : []), [mounted]);
  const newest = entries[0]?.date ?? null;
  const hasUnseen =
    mounted && newest !== null && (seenDate === null || newest > seenDate);

  // Opening the panel marks everything currently listed as seen.
  function handleOpen() {
    setExpandedId(null);
    setOpen(true);
    if (newest) {
      setSeenDate(newest);
      try {
        localStorage.setItem(SEEN_KEY, newest);
      } catch {}
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        aria-label={hasUnseen ? "What's new — new updates" : "What's new"}
        className={`press relative -mt-1 -mr-1 inline-flex items-center gap-1.5 rounded-full border pl-2 pr-2.5 py-1 text-[12px] font-semibold transition-colors ${
          hasUnseen
            ? "text-white"
            : "border-zinc-700 bg-zinc-900/60 text-zinc-400 hover:text-white hover:border-zinc-600 active:bg-zinc-800"
        }`}
        style={
          hasUnseen
            ? {
                color: "#ffffff",
                borderColor: "rgba(0, 200, 5, 0.45)",
                backgroundColor: "rgba(0, 200, 5, 0.10)",
              }
            : undefined
        }
      >
        <BellIcon ring={hasUnseen} />
        <span>What&apos;s new</span>
        {hasUnseen && (
          <span
            className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ring-2"
            style={{
              backgroundColor: "var(--gain)",
              // ringed in the page background so the dot reads as a floating
              // badge in both dark and light themes.
              ["--tw-ring-color" as string]: "var(--background)",
            }}
          />
        )}
      </button>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="What's new"
        header={
          <header className="flex items-center justify-between px-5 pt-3 pb-4 sm:pt-5 border-b border-zinc-800 shrink-0">
            <div className="flex items-center gap-2.5">
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: "var(--gain)" }}
              />
              <h2 className="text-[19px] font-semibold text-white tracking-tight">
                What&apos;s new
              </h2>
            </div>
            <button
              className="press -mr-1 w-8 h-8 rounded-full flex items-center justify-center text-zinc-400 hover:text-white active:bg-zinc-800"
              onClick={() => setOpen(false)}
              aria-label="Close"
            >
              <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5">
                <path
                  d="M6 6l12 12M18 6L6 18"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </header>
        }
      >
        {entries.length === 0 ? (
          <div className="text-[13px] text-zinc-500 py-16 text-center">
            No new updates in the last 30 days.
          </div>
        ) : (
          <ul className="space-y-2.5">
            {entries.map((e) => (
              <li key={e.id}>
                <UpdateRow
                  entry={e}
                  expanded={expandedId === e.id}
                  onToggle={() =>
                    setExpandedId((cur) => (cur === e.id ? null : e.id))
                  }
                />
              </li>
            ))}
          </ul>
        )}
        <p className="text-[11px] text-zinc-600 leading-snug mt-5 px-1 text-center">
          Major updates from the last 30 days.
        </p>
      </Sheet>
    </>
  );
}

function UpdateRow({
  entry,
  expanded,
  onToggle,
}: {
  entry: ChangelogEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className={`rounded-2xl border overflow-hidden transition-colors ${
        expanded
          ? "bg-zinc-900 border-zinc-700"
          : "bg-zinc-900/60 border-zinc-800"
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="w-full text-left px-3.5 py-3.5 flex items-start gap-3"
      >
        <span
          className="w-10 h-10 rounded-xl flex items-center justify-center text-[20px] leading-none shrink-0 bg-zinc-800/70"
          aria-hidden
        >
          {entry.icon}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <CategoryPill category={entry.category} />
            <span className="text-[11px] text-zinc-500 tabular-nums">
              {fmtDate(entry.date)}
            </span>
          </div>
          <div className="mt-1 text-[14px] font-semibold text-white leading-snug">
            {entry.title}
          </div>
          <p
            className={`mt-0.5 text-[13px] leading-[1.5] text-zinc-400 ${
              expanded ? "" : "line-clamp-2"
            }`}
          >
            {entry.summary}
          </p>
        </div>
        <Chevron expanded={expanded} />
      </button>

      {/* CSS-only expand/collapse: animating grid-template-rows 0fr->1fr is
          GPU-cheap and degrades to an instant toggle on older browsers. */}
      <div
        className="grid transition-[grid-template-rows] duration-[250ms] ease-out"
        style={{ gridTemplateRows: expanded ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          <div className="px-3.5 pb-4 pl-[60px]">
            <div className="space-y-2.5 border-t border-zinc-800 pt-3">
              {entry.details.map((p, i) => (
                <p key={i} className="text-[13px] leading-[1.6] text-zinc-300">
                  {p}
                </p>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CategoryPill({ category }: { category: ChangelogEntry["category"] }) {
  if (category === "New") {
    return (
      <span
        className="text-[9px] font-bold uppercase tracking-[0.1em] px-1.5 py-0.5 rounded"
        style={{ color: "var(--gain)", backgroundColor: "rgba(0, 200, 5, 0.12)" }}
      >
        New
      </span>
    );
  }
  return (
    <span className="text-[9px] font-bold uppercase tracking-[0.1em] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">
      Improved
    </span>
  );
}

function Chevron({ expanded }: { expanded: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={`w-4 h-4 mt-1 shrink-0 text-zinc-500 transition-transform duration-200 ${
        expanded ? "rotate-180" : ""
      }`}
      aria-hidden
    >
      <path
        d="M6 9l6 6 6-6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function BellIcon({ ring }: { ring: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5" aria-hidden>
      <path
        d="M18 8a6 6 0 10-12 0c0 5-2 6-2 6h16s-2-1-2-6"
        stroke="currentColor"
        strokeWidth={ring ? 2 : 1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M10.5 19a2 2 0 003 0"
        stroke="currentColor"
        strokeWidth={ring ? 2 : 1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function fmtDate(date: string): string {
  // Anchor at local noon so the displayed day can't slip across zones.
  const d = new Date(`${date}T12:00:00`);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
