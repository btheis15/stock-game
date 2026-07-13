"use client";

// Thesis editor — one full-screen sheet on mobile, modal on desktop. The
// counterpart to CreateFundModal, but there's no stock-picking step: a
// player's holdings are fixed by the roster, so editing a thesis is purely
// "write words about picks you already own." That makes a single scrollable
// screen the right shape rather than a wizard.
//
// Layout, top to bottom:
//   • (first time only) a short explainer of what a thesis is
//   • Overall thesis — theme label, the memo paragraphs, optional source +
//     disclaimer
//   • Why each pick — one collapsible card per holding with a one-line
//     summary + a longer reasoning field; a dot marks which picks are filled
//
// Save PUTs /api/thesis/[user] → commits config/thesis.json to origin/main
// via the GitHub Contents API → the page revalidates and the new thesis
// renders. Editing is open (anyone can edit any player's), matching funds.
//
// Mobile-first like the funds modal: 16px inputs (no iOS zoom). The overlay
// shell — z-index above the TabBar, 100dvh keyboard tracking, safe-area
// insets, body-scroll lock, Escape/backdrop dismiss, dialog a11y, slide-up
// motion — all comes from <Sheet full>.

import { useEffect, useMemo, useState } from "react";
import { THESIS_LIMITS, type Thesis } from "@/lib/thesis-types";
import { Sheet } from "@/components/Sheet";

interface PickDraft {
  summary: string;
  full: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  userId: string;
  userName: string;
  accentColor: string;
  /** Holdings in display order. */
  tickers: { ticker: string; name: string }[];
  /** The player's current thesis, or null if they have none yet. */
  existing: Thesis | null;
}

const EDITOR_NAME_KEY = "stockgame.editor.name";

export function EditThesisModal({
  open,
  onClose,
  onSaved,
  userId,
  userName,
  accentColor,
  tickers,
  existing,
}: Props) {
  const [theme, setTheme] = useState("");
  const [overview, setOverview] = useState("");
  const [source, setSource] = useState("");
  const [disclaimer, setDisclaimer] = useState("");
  const [editor, setEditor] = useState("");
  const [picks, setPicks] = useState<Record<string, PickDraft>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showMeta, setShowMeta] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isNew = existing == null;

  // Pre-populate from the existing thesis each time the sheet opens.
  useEffect(() => {
    if (!open) return;
    setTheme(existing?.theme ?? "");
    setOverview((existing?.overview ?? []).join("\n\n"));
    setSource(existing?.source ?? "");
    setDisclaimer(existing?.disclaimer ?? "");
    const seed: Record<string, PickDraft> = {};
    for (const { ticker } of tickers) {
      const p = existing?.picks?.[ticker];
      seed[ticker] = { summary: p?.summary ?? "", full: p?.full ?? "" };
    }
    setPicks(seed);
    setError(null);
    setShowMeta(Boolean(existing?.source || existing?.disclaimer));
    try {
      setEditor(localStorage.getItem(EDITOR_NAME_KEY) ?? "");
    } catch {}
    // Expand the first empty pick so a brand-new editor lands on something
    // actionable rather than an all-collapsed list.
    const firstEmpty = tickers.find((t) => {
      const p = existing?.picks?.[t.ticker];
      return !p || (!p.summary && !p.full);
    });
    setExpanded(firstEmpty?.ticker ?? null);
  }, [open, existing, tickers]);

  const filledCount = useMemo(
    () =>
      Object.values(picks).filter((p) => p.summary.trim() || p.full.trim()).length,
    [picks]
  );

  function setPick(ticker: string, patch: Partial<PickDraft>) {
    setPicks((prev) => ({ ...prev, [ticker]: { ...prev[ticker], ...patch } }));
  }

  async function save() {
    setError(null);
    setSaving(true);
    try {
      if (editor.trim()) {
        try {
          localStorage.setItem(EDITOR_NAME_KEY, editor.trim());
        } catch {}
      }
      const res = await fetch(`/api/thesis/${encodeURIComponent(userId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          theme: theme.trim(),
          source: source.trim(),
          disclaimer: disclaimer.trim(),
          overview,
          editor: editor.trim() || null,
          picks,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Save failed (${res.status})`);
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "unknown error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet
      full
      open={open}
      onClose={onClose}
      eyebrow={isNew ? "Add thesis" : "Edit thesis"}
      title={`${userName}’s thesis`}
      doneLabel="Close"
      footer={
        <footer className="flex items-center gap-3 px-5 py-4 border-t border-zinc-800">
          <div className="text-[12px] text-zinc-500">
            Saves for everyone to see.
          </div>
          <div className="flex-1" />
          <button
            className="bg-white text-black font-semibold rounded-full px-5 py-2.5 text-[14px] disabled:opacity-40"
            disabled={saving}
            onClick={save}
          >
            {saving ? "Saving…" : "Save thesis"}
          </button>
        </footer>
      }
    >
      <div className="space-y-5">
        {isNew && <ThesisIntro accentColor={accentColor} />}

        {/* --- Overall thesis --- */}
        <section className="space-y-3">
          <SectionLabel>The big picture</SectionLabel>
          <Field
            label="Theme"
            hint="A short headline for your whole portfolio."
            value={theme}
            onChange={setTheme}
            max={THESIS_LIMITS.theme}
            placeholder="e.g. Physical AI + On-Device Intelligence"
          />
          <TextArea
            label="Why this portfolio"
            hint="Your overall reasoning. Leave a blank line between paragraphs."
            value={overview}
            onChange={setOverview}
            rows={6}
            placeholder="What's the thesis tying these picks together?"
          />

          <button
            type="button"
            onClick={() => setShowMeta((v) => !v)}
            className="text-[12px] text-zinc-500 hover:text-zinc-300"
          >
            {showMeta ? "Hide" : "Add"} source &amp; disclaimer{" "}
            <span className="text-zinc-600">(optional)</span>
          </button>
          {showMeta && (
            <div className="space-y-3 pt-1">
              <Field
                label="Source"
                hint="Shown as a small caption, e.g. where the research came from."
                value={source}
                onChange={setSource}
                max={THESIS_LIMITS.source}
                placeholder="e.g. Personal research memo · Feb 5, 2026"
              />
              <TextArea
                label="Disclaimer"
                hint="A short note shown in muted text at the foot."
                value={disclaimer}
                onChange={setDisclaimer}
                rows={2}
                max={THESIS_LIMITS.disclaimer}
                placeholder="e.g. Personal opinion — not financial advice."
              />
            </div>
          )}
        </section>

        {/* --- Per-pick reasoning --- */}
        <section className="space-y-2.5">
          <div className="flex items-center justify-between">
            <SectionLabel>Why each pick</SectionLabel>
            <span className="text-[11px] text-zinc-500 tabular-nums">
              {filledCount}/{tickers.length} written
            </span>
          </div>
          <p className="text-[12px] text-zinc-500 leading-snug">
            Tap a holding to add a one-line take and the deeper reasoning.
            Every field is optional — write as many or as few as you like.
          </p>
          <div className="rounded-xl border border-zinc-800 divide-y divide-zinc-800 overflow-hidden">
            {tickers.map(({ ticker, name }) => (
              <PickEditor
                key={ticker}
                ticker={ticker}
                name={name}
                draft={picks[ticker] ?? { summary: "", full: "" }}
                open={expanded === ticker}
                accentColor={accentColor}
                onToggle={() =>
                  setExpanded((cur) => (cur === ticker ? null : ticker))
                }
                onChange={(patch) => setPick(ticker, patch)}
              />
            ))}
          </div>
        </section>

        {/* --- Attribution --- */}
        <Field
          label="Your name"
          optional
          hint="Shown in the save's commit message. Remembered on this device."
          value={editor}
          onChange={setEditor}
          max={40}
          placeholder="e.g. Brian"
        />

        {error && (
          <div className="rounded-lg bg-red-950/40 border border-red-900 text-red-300 text-[13px] px-3 py-2">
            {error}
          </div>
        )}
      </div>
    </Sheet>
  );
}

// --- Building blocks ------------------------------------------------------

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-bold tracking-[0.16em] uppercase text-zinc-500">
      {children}
    </div>
  );
}

function Field({
  label,
  hint,
  value,
  onChange,
  max,
  placeholder,
  optional,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  max?: number;
  placeholder?: string;
  optional?: boolean;
}) {
  return (
    <label className="block">
      <div className="text-[12px] font-medium text-zinc-400 mb-1.5">
        {label}{" "}
        {optional && <span className="text-zinc-600">(optional)</span>}
      </div>
      <input
        type="text"
        maxLength={max}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-3 text-[16px] text-white placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600"
      />
      {hint && <div className="text-[11px] text-zinc-500 mt-1.5">{hint}</div>}
    </label>
  );
}

function TextArea({
  label,
  hint,
  value,
  onChange,
  rows,
  max,
  placeholder,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  rows: number;
  max?: number;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <div className="text-[12px] font-medium text-zinc-400 mb-1.5">{label}</div>
      <textarea
        rows={rows}
        maxLength={max}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-3 text-[16px] leading-relaxed text-white placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600 resize-y"
      />
      <div className="flex items-center justify-between mt-1.5">
        {hint ? (
          <span className="text-[11px] text-zinc-500">{hint}</span>
        ) : (
          <span />
        )}
        {max && (
          <span className="text-[11px] text-zinc-600 tabular-nums shrink-0 ml-2">
            {value.length}/{max}
          </span>
        )}
      </div>
    </label>
  );
}

function PickEditor({
  ticker,
  name,
  draft,
  open,
  accentColor,
  onToggle,
  onChange,
}: {
  ticker: string;
  name: string;
  draft: PickDraft;
  open: boolean;
  accentColor: string;
  onToggle: () => void;
  onChange: (patch: Partial<PickDraft>) => void;
}) {
  const filled = Boolean(draft.summary.trim() || draft.full.trim());
  return (
    <div className={open ? "bg-zinc-900/60" : ""}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full flex items-center gap-3 px-3.5 py-3 text-left active:bg-zinc-900/40 transition-colors"
      >
        <div className="w-9 h-9 rounded-full bg-zinc-800 flex items-center justify-center text-[10px] font-bold text-zinc-300 shrink-0">
          {ticker}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[14px] font-semibold text-white truncate">{name}</div>
          <div className="text-[11px] text-zinc-500 truncate">
            {filled
              ? draft.summary.trim() || "Reasoning added"
              : "No thesis yet — tap to add"}
          </div>
        </div>
        <span
          className="w-2 h-2 rounded-full shrink-0"
          style={{ backgroundColor: filled ? accentColor : "transparent", border: filled ? "none" : "1px solid #3f3f46" }}
          aria-hidden
        />
        <svg
          viewBox="0 0 24 24"
          fill="none"
          className={`w-4 h-4 shrink-0 text-zinc-500 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          aria-hidden
        >
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="px-3.5 pb-4 space-y-3">
          <TextArea
            label="One-line take"
            value={draft.summary}
            onChange={(v) => onChange({ summary: v })}
            rows={2}
            max={THESIS_LIMITS.summary}
            placeholder={`Why ${ticker}, in a sentence.`}
          />
          <TextArea
            label="Full reasoning"
            value={draft.full}
            onChange={(v) => onChange({ full: v })}
            rows={5}
            max={THESIS_LIMITS.full}
            placeholder="The deeper case — what the market's missing, what you're watching."
          />
        </div>
      )}
    </div>
  );
}

function ThesisIntro({ accentColor }: { accentColor: string }) {
  return (
    <div className="rounded-xl bg-zinc-900/50 border border-zinc-800 p-4">
      <div className="text-[10px] font-bold tracking-[0.16em] uppercase text-zinc-500 mb-1.5">
        What&rsquo;s a thesis?
      </div>
      <p className="text-[13px] text-zinc-300 leading-relaxed">
        Your thesis is the <span className="text-white font-medium">why</span>{" "}
        behind your picks — the story tying your portfolio together and your
        take on each stock. It shows up at the bottom of your portfolio page
        for everyone to read.
      </p>
      <p className="text-[12px] text-zinc-500 leading-relaxed mt-3">
        Write a big-picture theme up top, then a quick take on each holding
        below. Everything is optional and you can come back to edit it anytime
        — saving updates the page for everyone.
      </p>
      <div
        className="mt-3 h-0.5 w-12 rounded-full"
        style={{ backgroundColor: accentColor }}
        aria-hidden
      />
    </div>
  );
}
