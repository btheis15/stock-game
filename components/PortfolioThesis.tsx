"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { TICKER_NAMES } from "@/lib/picks";
import { thesisHasContent, type Thesis } from "@/lib/thesis-types";
import { EditThesisModal } from "./EditThesisModal";

interface Props {
  thesis: Thesis | null;
  userId: string;
  userName: string;
  /** Tickers in display order (the player's roster order). */
  tickers: string[];
  accentColor: string;
}

// "Why these picks" — a player's own reasoning for each holding, at the foot
// of their portfolio page. Always rendered: when a thesis exists it shows the
// intro + per-stock reasons, and when one doesn't it shows an invitation to
// add one. Either way there's an open Edit/Add button that opens the editor —
// same trust model as funds (anyone can edit any player's). Mirrors the card
// language of PortfolioComposition / AboutThisPortfolio.
export function PortfolioThesis({
  thesis,
  userId,
  userName,
  tickers,
  accentColor,
}: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const hasContent = thesisHasContent(thesis);

  const tickerList = tickers.map((t) => ({ ticker: t, name: TICKER_NAMES[t] ?? t }));
  const entries = tickers
    .map((t) => ({ ticker: t, pick: thesis?.picks?.[t] }))
    .filter((e): e is { ticker: string; pick: Thesis["picks"][string] } =>
      e.pick != null && (e.pick.summary.trim().length > 0 || e.pick.full.trim().length > 0)
    );

  return (
    <div className="px-4 mt-8">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[15px] font-semibold text-ink-3">Why these picks</h2>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="inline-flex items-center gap-1.5 rounded-full border border-edge-strong bg-card-60 pl-2 pr-2.5 py-1 text-[12px] font-semibold text-ink-3 hover:text-ink hover:border-edge-ghost active:bg-raised transition-colors"
        >
          <PencilIcon />
          {hasContent ? "Edit" : "Add thesis"}
        </button>
      </div>

      {hasContent && thesis ? (
        <>
          <ThesisIntro thesis={thesis} accentColor={accentColor} />

          {entries.length > 0 && (
            <div className="mt-3 rounded-2xl bg-card border border-hairline divide-y divide-hairline overflow-hidden">
              {entries.map(({ ticker, pick }) => (
                <PickRow key={ticker} ticker={ticker} pick={pick} accentColor={accentColor} />
              ))}
            </div>
          )}

          {thesis.disclaimer && (
            <p className="text-[11px] leading-relaxed text-ink-faint mt-3 px-1">
              {thesis.disclaimer}
            </p>
          )}
        </>
      ) : (
        <EmptyState userName={userName} accentColor={accentColor} onAdd={() => setEditing(true)} />
      )}

      <EditThesisModal
        open={editing}
        onClose={() => setEditing(false)}
        onSaved={() => router.refresh()}
        userId={userId}
        userName={userName}
        accentColor={accentColor}
        tickers={tickerList}
        existing={thesis}
      />
    </div>
  );
}

// --- Empty state (no thesis yet) ------------------------------------------

function EmptyState({
  userName,
  accentColor,
  onAdd,
}: {
  userName: string;
  accentColor: string;
  onAdd: () => void;
}) {
  return (
    <div className="rounded-2xl bg-card border border-hairline p-5 text-center relative overflow-hidden">
      <div
        aria-hidden
        className="absolute -top-12 -right-12 w-40 h-40 rounded-full pointer-events-none"
        style={{ background: `radial-gradient(circle, ${accentColor}1f, transparent 70%)` }}
      />
      <div className="relative">
        <p className="text-[14px] font-semibold text-ink-2">No thesis yet</p>
        <p className="text-[13px] leading-relaxed text-ink-muted mt-1.5 max-w-xs mx-auto">
          Share the <span className="text-ink-2">why</span> behind {userName}&rsquo;s
          picks — a big-picture theme plus a quick take on each holding.
        </p>
        <button
          type="button"
          onClick={onAdd}
          className="mt-4 inline-flex items-center gap-2 rounded-full px-4 py-2 text-[13px] font-semibold text-black"
          style={{ backgroundColor: accentColor }}
        >
          <PencilIcon dark />
          Add a thesis
        </button>
      </div>
    </div>
  );
}

// --- Thesis intro (overall theme + collapsible memo) ----------------------

function ThesisIntro({ thesis, accentColor }: { thesis: Thesis; accentColor: string }) {
  const [expanded, setExpanded] = useState(false);
  const paras = thesis.overview.filter((p) => p.trim().length > 0);
  const shown = expanded ? paras : paras.slice(0, 1);
  const hasMore = paras.length > 1;

  return (
    <div className="rounded-2xl bg-card border border-hairline p-4 relative overflow-hidden">
      <div
        aria-hidden
        className="absolute -top-12 -right-12 w-40 h-40 rounded-full pointer-events-none"
        style={{ background: `radial-gradient(circle, ${accentColor}1f, transparent 70%)` }}
      />

      <div className="relative">
        {thesis.theme && (
          <div
            className="inline-flex items-center gap-2 px-2 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wide"
            style={{ backgroundColor: `${accentColor}1f`, color: accentColor }}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: accentColor }} />
            {thesis.theme}
          </div>
        )}

        {paras.length > 0 && (
          <div className="mt-3 space-y-3">
            {shown.map((p, i) => (
              <p key={i} className="text-[13px] leading-relaxed text-ink-3">
                {p}
              </p>
            ))}
            {hasMore && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="text-[12px] text-ink-faint hover:text-ink-3"
              >
                {expanded ? "Show less" : "Read full thesis"}
              </button>
            )}
          </div>
        )}

        {thesis.source && (
          <div className="mt-3 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-ink-faint">
            <span style={{ color: accentColor }}>✎</span>
            <span>{thesis.source}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Per-stock reason (tap to expand) -------------------------------------

function PickRow({
  ticker,
  pick,
  accentColor,
}: {
  ticker: string;
  pick: Thesis["picks"][string];
  accentColor: string;
}) {
  const [open, setOpen] = useState(false);
  const name = TICKER_NAMES[ticker] ?? ticker;
  const hasFull = pick.full.trim().length > 0;

  return (
    <div>
      <button
        type="button"
        onClick={() => hasFull && setOpen((v) => !v)}
        aria-expanded={open}
        className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
          hasFull ? "active:bg-pressed" : "cursor-default"
        }`}
      >
        <div className="w-9 h-9 rounded-full bg-raised flex items-center justify-center text-[10px] font-bold text-ink-3 flex-shrink-0">
          {ticker}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[14px] font-semibold text-ink truncate">{name}</div>
          {!open && pick.summary && (
            <div className="text-[12px] leading-snug text-ink-muted mt-0.5 line-clamp-2">
              {pick.summary}
            </div>
          )}
        </div>
        {hasFull && (
          <motion.span
            aria-hidden
            animate={{ rotate: open ? 90 : 0 }}
            transition={{ duration: 0.18 }}
            className="text-ink-faint text-[13px] flex-shrink-0"
          >
            ›
          </motion.span>
        )}
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 pl-16">
              {pick.summary && (
                <p className="text-[12px] font-semibold text-ink-3 mb-1.5">
                  {pick.summary}
                </p>
              )}
              <p className="text-[13px] leading-relaxed text-ink-muted">{pick.full}</p>
              <Link
                href={`/stock/${ticker}`}
                className="inline-block mt-2.5 text-[12px] font-medium"
                style={{ color: accentColor }}
              >
                View {ticker} →
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function PencilIcon({ dark }: { dark?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5" aria-hidden>
      <path
        d="M4 20h4L18.5 9.5a2.121 2.121 0 00-3-3L5 17v3z"
        stroke="currentColor"
        strokeWidth={dark ? 2 : 1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M13.5 6.5l3 3" stroke="currentColor" strokeWidth={dark ? 2 : 1.8} strokeLinecap="round" />
    </svg>
  );
}
