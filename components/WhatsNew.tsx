"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
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

  // Lock body scroll + close on Escape while the sheet is up.
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        aria-label={hasUnseen ? "What's new — new updates" : "What's new"}
        className="relative -mt-1 -mr-1 w-9 h-9 rounded-full flex items-center justify-center text-zinc-400 hover:text-white active:bg-zinc-800/60 transition-colors"
      >
        <BellIcon ring={hasUnseen} />
        {hasUnseen && (
          <span
            className="absolute top-1.5 right-1.5 w-2.5 h-2.5 rounded-full ring-2"
            style={{
              backgroundColor: "var(--gain)",
              // ringed in the page background color so the dot reads as a
              // floating badge in both dark and light themes.
              ["--tw-ring-color" as string]: "var(--background)",
            }}
          />
        )}
      </button>

      <AnimatePresence>
        {open && (
          <WhatsNewSheet
            entries={entries}
            expandedId={expandedId}
            onToggle={(id) => setExpandedId((cur) => (cur === id ? null : id))}
            onClose={() => setOpen(false)}
          />
        )}
      </AnimatePresence>
    </>
  );
}

function WhatsNewSheet({
  entries,
  expandedId,
  onToggle,
  onClose,
}: {
  entries: ChangelogEntry[];
  expandedId: string | null;
  onToggle: (id: string) => void;
  onClose: () => void;
}) {
  const reduce = useReducedMotion();

  return (
    // z-[100] sits above the global TabBar (z-50), matching the funds modals.
    <motion.div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <motion.div
        className="w-full sm:max-w-md sm:rounded-3xl rounded-t-3xl bg-zinc-950 border border-zinc-800 h-[92dvh] sm:h-auto sm:max-h-[90dvh] flex flex-col overflow-hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        onClick={(e) => e.stopPropagation()}
        initial={reduce ? { opacity: 0 } : { y: "4%", opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={reduce ? { opacity: 0 } : { y: "6%", opacity: 0 }}
        transition={{
          type: "spring",
          stiffness: 380,
          damping: 38,
          mass: 0.9,
        }}
      >
        {/* Grab handle — signals a dismissible sheet on mobile. */}
        <div className="sm:hidden flex justify-center pt-2.5 pb-1 shrink-0">
          <span className="w-9 h-1 rounded-full bg-zinc-700" />
        </div>

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
            className="-mr-1 w-8 h-8 rounded-full flex items-center justify-center text-zinc-400 hover:text-white active:bg-zinc-800"
            onClick={onClose}
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

        <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4">
          {entries.length === 0 ? (
            <div className="text-[13px] text-zinc-500 py-16 text-center">
              No new updates in the last 30 days.
            </div>
          ) : (
            <motion.ul
              className="space-y-2.5"
              initial="hidden"
              animate="show"
              variants={{
                hidden: {},
                show: {
                  transition: { staggerChildren: reduce ? 0 : 0.035 },
                },
              }}
            >
              {entries.map((e) => (
                <motion.li
                  key={e.id}
                  variants={{
                    hidden: reduce ? { opacity: 0 } : { opacity: 0, y: 8 },
                    show: { opacity: 1, y: 0 },
                  }}
                  transition={{ duration: 0.25, ease: "easeOut" }}
                >
                  <UpdateRow
                    entry={e}
                    expanded={expandedId === e.id}
                    onToggle={() => onToggle(e.id)}
                    reduce={!!reduce}
                  />
                </motion.li>
              ))}
            </motion.ul>
          )}
          <p className="text-[11px] text-zinc-600 leading-snug mt-5 px-1 text-center">
            Major updates from the last 30 days.
          </p>
        </div>
      </motion.div>
    </motion.div>
  );
}

function UpdateRow({
  entry,
  expanded,
  onToggle,
  reduce,
}: {
  entry: ChangelogEntry;
  expanded: boolean;
  onToggle: () => void;
  reduce: boolean;
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

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="details"
            initial={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            animate={reduce ? { opacity: 1 } : { height: "auto", opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="px-3.5 pb-4 pl-[60px]">
              <div className="space-y-2.5 border-t border-zinc-800 pt-3">
                {entry.details.map((p, i) => (
                  <p
                    key={i}
                    className="text-[13px] leading-[1.6] text-zinc-300"
                  >
                    {p}
                  </p>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
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
    <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" aria-hidden>
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
