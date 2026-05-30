"use client";

// Game-wide "Participant breakdown" + "About the players" for the Compare
// page bottom. Parallels the per-player Portfolio breakdown / About this
// portfolio cards, but slices the pooled Combined Players fund by player
// instead of a single portfolio by sector. Tapping a participant reveals
// the pick slots they contribute to the fund.

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ParentSize } from "@visx/responsive";
import Link from "next/link";
import { BreakdownDonut, SliceList, SliceDetail } from "./BreakdownDonut";
import { fmtPct } from "@/lib/portfolio";
import type { PortfolioAnalysis, CompositionSlice } from "@/lib/portfolio-composition";
import { COMBINED_FUND_ID } from "@/lib/combined";

interface Props {
  participants: CompositionSlice[];
  totalValue: number;
  analysis: PortfolioAnalysis;
  accentColor: string;
}

export function ParticipantBreakdown({
  participants,
  totalValue,
  analysis,
  accentColor,
}: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const selectedSlice = useMemo(
    () => participants.find((s) => s.key === selected) ?? null,
    [selected, participants]
  );

  return (
    <div className="px-4 mt-8">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[15px] font-semibold text-zinc-300">Participant breakdown</h2>
        <Link
          href={`/fund/${COMBINED_FUND_ID}`}
          className="text-[11px] font-semibold"
          style={{ color: accentColor }}
        >
          View fund ↗
        </Link>
      </div>

      <div className="rounded-2xl bg-zinc-900/70 border border-zinc-800 p-4">
        <ParentSize debounceTime={50}>
          {({ width }) => (
            <BreakdownDonut
              width={width}
              height={300}
              slices={participants}
              selected={selected}
              onSelect={(k) => setSelected((cur) => (cur === k ? null : k))}
              total={totalValue}
              accentColor={accentColor}
              centerSubtitle={`${participants.length} participant${participants.length === 1 ? "" : "s"}`}
              selectedSubtitle={(s) => `${fmtPct(s.pct)} of combined fund`}
            />
          )}
        </ParentSize>

        <div className="mt-4 divide-y divide-zinc-800/70">
          <AnimatePresence mode="wait">
            <motion.div
              key={selectedSlice?.key ?? "all"}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18 }}
            >
              {selectedSlice ? (
                <SliceDetail
                  slice={selectedSlice}
                  totalNoun="combined fund"
                  sliceNoun="participant"
                />
              ) : (
                <SliceList
                  slices={participants}
                  onSelect={(k) => setSelected(k)}
                  viewLabel="Participant"
                  countLabel={(c) => `${c} pick${c === 1 ? "" : "s"}`}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      <AboutPlayers analysis={analysis} accentColor={accentColor} />
    </div>
  );
}

function AboutPlayers({
  analysis,
  accentColor,
}: {
  analysis: PortfolioAnalysis;
  accentColor: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const showParagraphs = expanded ? analysis.paragraphs : analysis.paragraphs.slice(0, 1);

  return (
    <div className="mt-5">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-[15px] font-semibold text-zinc-300">About the players</h2>
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-zinc-500">
          <span style={{ color: accentColor }}>✦</span>
          <span>Claude analysis</span>
        </div>
      </div>
      <div className="rounded-2xl bg-zinc-900/70 border border-zinc-800 p-4 space-y-3 relative overflow-hidden">
        <div
          aria-hidden
          className="absolute -top-12 -right-12 w-40 h-40 rounded-full pointer-events-none"
          style={{
            background: `radial-gradient(circle, ${accentColor}1f, transparent 70%)`,
          }}
        />

        <div className="relative">
          <div
            className="inline-flex items-center gap-2 px-2 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wide"
            style={{ backgroundColor: `${accentColor}1f`, color: accentColor }}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: accentColor }} />
            {analysis.styleLabel}
          </div>
          <p className="mt-3 text-[14px] leading-snug font-semibold text-zinc-100">
            {analysis.headline}
          </p>
        </div>

        <div className="relative space-y-3">
          {showParagraphs.map((p, i) => (
            <p key={i} className="text-[13px] leading-relaxed text-zinc-300">
              {p}
            </p>
          ))}
          {analysis.paragraphs.length > 1 && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="text-[12px] text-zinc-500 hover:text-zinc-300"
            >
              {expanded ? "Show less" : "Read full analysis"}
            </button>
          )}
        </div>

        {analysis.themes.length > 0 && (
          <div className="relative pt-1">
            <div className="text-[11px] uppercase tracking-wide text-zinc-500 mb-2">
              Themes
            </div>
            <div className="flex flex-wrap gap-1.5">
              {analysis.themes.map((t) => (
                <div
                  key={t.name}
                  className="inline-flex items-center px-2.5 py-1 rounded-full bg-zinc-800/70 border border-zinc-700/60"
                >
                  <span className="text-[11px] font-medium text-zinc-200">{t.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
