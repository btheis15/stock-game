"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { TICKER_NAMES } from "@/lib/picks";
import type { Thesis } from "@/lib/thesis";

interface Props {
  thesis: Thesis;
  /** Tickers in display order (the player's roster order). Only those with a
   *  matching `thesis.picks` entry render a row. */
  tickers: string[];
  accentColor: string;
}

// "Why these picks" — the player's own reasoning for each holding, surfaced
// at the foot of their portfolio page. Two parts: a collapsible thesis intro
// (the overall theme) and a tap-to-expand list of per-stock reasons. Mirrors
// the card language of PortfolioComposition / AboutThisPortfolio so it reads
// as part of the same page rather than a bolted-on section.
export function PortfolioThesis({ thesis, tickers, accentColor }: Props) {
  const entries = tickers
    .map((t) => ({ ticker: t, pick: thesis.picks[t] }))
    .filter((e): e is { ticker: string; pick: Thesis["picks"][string] } => e.pick != null);

  if (entries.length === 0) return null;

  return (
    <div className="px-4 mt-8">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[15px] font-semibold text-zinc-300">Why these picks</h2>
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-zinc-500">
          <span style={{ color: accentColor }}>✎</span>
          <span>{thesis.source}</span>
        </div>
      </div>

      <ThesisIntro thesis={thesis} accentColor={accentColor} />

      <div className="mt-3 rounded-2xl bg-zinc-900/70 border border-zinc-800 divide-y divide-zinc-800 overflow-hidden">
        {entries.map(({ ticker, pick }) => (
          <PickRow
            key={ticker}
            ticker={ticker}
            pick={pick}
            accentColor={accentColor}
          />
        ))}
      </div>

      {thesis.disclaimer && (
        <p className="text-[11px] leading-relaxed text-zinc-500 mt-3 px-1">
          {thesis.disclaimer}
        </p>
      )}
    </div>
  );
}

// --- Thesis intro (overall theme + collapsible memo) ----------------------

function ThesisIntro({
  thesis,
  accentColor,
}: {
  thesis: Thesis;
  accentColor: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? thesis.overview : thesis.overview.slice(0, 1);
  const hasMore = thesis.overview.length > 1;

  return (
    <div className="rounded-2xl bg-zinc-900/70 border border-zinc-800 p-4 relative overflow-hidden">
      {/* Faint accent glow in the corner — same touch as "About this portfolio". */}
      <div
        aria-hidden
        className="absolute -top-12 -right-12 w-40 h-40 rounded-full pointer-events-none"
        style={{ background: `radial-gradient(circle, ${accentColor}1f, transparent 70%)` }}
      />

      <div className="relative">
        <div
          className="inline-flex items-center gap-2 px-2 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wide"
          style={{ backgroundColor: `${accentColor}1f`, color: accentColor }}
        >
          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: accentColor }} />
          {thesis.theme}
        </div>

        <div className="mt-3 space-y-3">
          {shown.map((p, i) => (
            <p key={i} className="text-[13px] leading-relaxed text-zinc-300">
              {p}
            </p>
          ))}
          {hasMore && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="text-[12px] text-zinc-500 hover:text-zinc-300"
            >
              {expanded ? "Show less" : "Read full thesis"}
            </button>
          )}
        </div>
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

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center gap-3 px-4 py-3 text-left active:bg-zinc-800/60 transition-colors"
      >
        <div className="w-9 h-9 rounded-full bg-zinc-800 flex items-center justify-center text-[10px] font-bold text-zinc-300 flex-shrink-0">
          {ticker}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[14px] font-semibold text-white truncate">{name}</div>
          {!open && (
            <div className="text-[12px] leading-snug text-zinc-400 mt-0.5 line-clamp-2">
              {pick.summary}
            </div>
          )}
        </div>
        <motion.span
          aria-hidden
          animate={{ rotate: open ? 90 : 0 }}
          transition={{ duration: 0.18 }}
          className="text-zinc-500 text-[13px] flex-shrink-0"
        >
          ›
        </motion.span>
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
              <p className="text-[12px] font-semibold text-zinc-300 mb-1.5">
                {pick.summary}
              </p>
              <p className="text-[13px] leading-relaxed text-zinc-400">{pick.full}</p>
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
