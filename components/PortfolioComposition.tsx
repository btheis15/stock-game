"use client";

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ParentSize } from "@visx/responsive";
import type {
  CompositionSlice,
  PortfolioAnalysis,
  PortfolioComposition,
} from "@/lib/portfolio-composition";
import { BreakdownDonut, SliceList, SliceDetail } from "./BreakdownDonut";

type ViewKey = "sector" | "industry" | "marketcap";

const VIEW_LABEL: Record<ViewKey, string> = {
  sector: "Sector",
  industry: "Industry",
  marketcap: "Market cap",
};

interface Props {
  composition: PortfolioComposition;
  accentColor: string;
  /** Heading above the donut. Defaults to "Portfolio breakdown". */
  title?: string;
  /** Heading above the Claude-analysis card. Defaults to "About this portfolio". */
  aboutTitle?: string;
}

export function PortfolioComposition({
  composition,
  accentColor,
  title = "Portfolio breakdown",
  aboutTitle = "About this portfolio",
}: Props) {
  const [view, setView] = useState<ViewKey>("sector");
  const [selected, setSelected] = useState<string | null>(null);

  const slices = useMemo<CompositionSlice[]>(() => {
    if (view === "sector") return composition.bySector;
    if (view === "industry") return composition.byIndustry;
    return composition.byMarketCap;
  }, [view, composition]);

  const selectedSlice = useMemo(
    () => slices.find((s) => s.key === selected) ?? null,
    [selected, slices]
  );

  return (
    <div className="px-4 mt-8">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[15px] font-semibold text-ink-3">{title}</h2>
        <ViewTabs value={view} onChange={(v) => { setView(v); setSelected(null); }} />
      </div>

      <div className="rounded-2xl bg-card border border-hairline p-4">
        <ParentSize debounceTime={50}>
          {({ width }) => (
            <BreakdownDonut
              width={width}
              height={300}
              slices={slices}
              selected={selected}
              onSelect={(k) => setSelected((cur) => (cur === k ? null : k))}
              total={composition.totalValue}
              accentColor={accentColor}
            />
          )}
        </ParentSize>

        <div className="mt-4 divide-y divide-hairline-70">
          <AnimatePresence mode="wait">
            <motion.div
              key={view + (selectedSlice?.key ?? "all")}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18 }}
            >
              {selectedSlice ? (
                <SliceDetail slice={selectedSlice} />
              ) : (
                <SliceList
                  slices={slices}
                  onSelect={(k) => setSelected(k)}
                  viewLabel={VIEW_LABEL[view]}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      <AboutThisPortfolio
        analysis={composition.analysis}
        accentColor={accentColor}
        title={aboutTitle}
      />
    </div>
  );
}

// --- View tabs (pill toggle) ----------------------------------------------

function ViewTabs({
  value,
  onChange,
}: {
  value: ViewKey;
  onChange: (v: ViewKey) => void;
}) {
  const tabs: ViewKey[] = ["sector", "industry", "marketcap"];
  return (
    <div className="inline-flex rounded-full bg-card border border-hairline p-0.5">
      {tabs.map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => onChange(t)}
          className={`px-3 py-1.5 rounded-full text-[11px] font-semibold transition-colors ${
            value === t
              ? "bg-zinc-100 text-zinc-900"
              : "text-ink-muted hover:text-ink-2"
          }`}
        >
          {VIEW_LABEL[t]}
        </button>
      ))}
    </div>
  );
}

// --- About this portfolio (Claude analysis) ------------------------------

function AboutThisPortfolio({
  analysis,
  accentColor,
  title = "About this portfolio",
}: {
  analysis: PortfolioAnalysis;
  accentColor: string;
  title?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const showParagraphs = expanded ? analysis.paragraphs : analysis.paragraphs.slice(0, 1);

  return (
    <div className="mt-5">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-[15px] font-semibold text-ink-3">{title}</h2>
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-ink-faint">
          <span style={{ color: accentColor }}>✦</span>
          <span>Claude analysis</span>
        </div>
      </div>
      <div className="rounded-2xl bg-card border border-hairline p-4 space-y-3 relative overflow-hidden">
        {/* Faint accent gradient in the corner — gives the card a touch of
            "this was synthesized" energy without being shouty. */}
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
            style={{
              backgroundColor: `${accentColor}1f`,
              color: accentColor,
            }}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: accentColor }} />
            {analysis.styleLabel}
          </div>
          <p className="mt-3 text-[14px] leading-snug font-semibold text-ink">
            {analysis.headline}
          </p>
        </div>

        <div className="relative space-y-3">
          {showParagraphs.map((p, i) => (
            <p key={i} className="text-[13px] leading-relaxed text-ink-3">
              {p}
            </p>
          ))}
          {analysis.paragraphs.length > 1 && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="text-[12px] text-ink-faint hover:text-ink-3"
            >
              {expanded ? "Show less" : "Read full analysis"}
            </button>
          )}
        </div>

        {analysis.themes.length > 0 && (
          <div className="relative pt-1">
            <div className="text-[11px] uppercase tracking-wide text-ink-faint mb-2">
              Themes
            </div>
            <div className="flex flex-wrap gap-1.5">
              {analysis.themes.map((t) => (
                <div
                  key={t.name}
                  className="inline-flex items-center px-2.5 py-1 rounded-full bg-raised-70 border border-edge-strong-60"
                >
                  <span className="text-[11px] font-medium text-ink-2">
                    {t.name}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
