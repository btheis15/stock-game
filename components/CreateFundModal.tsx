"use client";

// Create-Fund flow as a full-height <Sheet> (full-screen on mobile, modal
// card on desktop). In create mode the first screen leads with a <FundIntro>
// explainer — what a fund is, how to build one, and what happens after
// you save — so a non-technical player understands the feature before
// touching an input. (Skipped in edit mode; an editor already knows.)
// Three steps, advanced via a sticky bottom button row that always
// shows what the next action does:
//
//   1. Name your fund + your name (creator label, optional)
//   2. Search tickers + add to the holdings list
//   3. Set weights (0.1% increments, must sum to 100.0%)
//
// Save POSTs to /api/funds → the server action commits funds.json to
// origin/main via the GitHub Contents API → the page revalidates and
// the new fund shows up in the Compare-view chip row + leaderboard
// (initially OFF in the filter, dim, so the chart doesn't get crowded
// as funds accumulate).
//
// Mobile is the primary target — every tappable target is at least
// 44pt high, the search input doesn't trigger a zoom (font-size ≥ 16px
// rule), and weight inputs use type="text" with inputMode="decimal"
// rather than spinners (which iOS Safari renders inconsistently).
//
// The overlay shell (backdrop, z-index above the TabBar, 100dvh keyboard
// tracking, safe-area insets, body-scroll lock, Escape/backdrop dismiss,
// dialog a11y, slide-up motion) all comes from <Sheet full> — this file
// only owns the wizard content + the pinned footer actions.

import { useEffect, useMemo, useRef, useState } from "react";
import type { Fund } from "@/lib/types";
import { fmtWeightPct } from "@/lib/portfolio";
import { Sheet } from "@/components/Sheet";

interface TickerSearchResult {
  symbol: string;
  name: string;
  type: string;
  exchange: string | null;
}

interface SelectedHolding {
  ticker: string;
  name: string;
  type: string;
  /** Weight as a fraction in [0.001, 1]. Edited via percentage UI; stored
   *  internally as a fraction so the save payload matches the API. */
  weight: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  /** When non-null, the modal opens in EDIT mode pre-populated with this
   *  fund's name/creator/holdings. Save PATCHes /api/funds/[id] instead of
   *  POSTing to /api/funds. The id, color, createdAt, and deletedAt fields
   *  stay untouched on the server. */
  editing?: Fund | null;
}

const MIN_WEIGHT = 0.001;       // 0.1 %, the smallest UI step
const WEIGHT_STEP = 0.001;
const WEIGHT_TOLERANCE = 0.00005; // matches lib/funds.ts

const CREATOR_STORAGE_KEY = "stockgame.fund.creator";

function pctToFraction(s: string): number | null {
  const n = parseFloat(s);
  if (!isFinite(n)) return null;
  return n / 100;
}

function clampWeight(w: number): number {
  if (!isFinite(w)) return MIN_WEIGHT;
  if (w < MIN_WEIGHT) return MIN_WEIGHT;
  if (w > 1) return 1;
  // Snap to 0.001 grid to keep the sum stable.
  return Math.round(w * 1000) / 1000;
}

export function CreateFundModal({ open, onClose, onSaved, editing = null }: Props) {
  const isEdit = editing !== null;
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [name, setName] = useState("");
  const [creator, setCreator] = useState("");
  const [holdings, setHoldings] = useState<SelectedHolding[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pre-populate when opening in edit mode; otherwise restore the remembered
  // creator label so a returning user doesn't have to re-type their name on
  // every new-fund flow.
  useEffect(() => {
    if (!open) return;
    if (editing) {
      setName(editing.name);
      setCreator(editing.creator ?? "");
      setHoldings(
        editing.holdings.map((h) => ({
          ticker: h.ticker,
          name: h.ticker, // best-effort label; the Yahoo "name" isn't
                          // stored on the fund, only the ticker. The
                          // weights step shows the ticker prominently so
                          // a missing display name is fine here.
          type: "",
          weight: h.weight,
        }))
      );
    } else {
      const remembered = window.localStorage.getItem(CREATOR_STORAGE_KEY);
      if (remembered) setCreator(remembered);
    }
  }, [open, editing]);

  // Reset state when the modal closes so a re-open starts fresh. Delayed
  // past the Sheet's 320ms slide-down exit (--dur-slide) so the content
  // doesn't visibly snap back to step 1 while the panel is still leaving.
  useEffect(() => {
    if (open) return;
    const id = setTimeout(() => {
      setStep(1);
      setName("");
      setHoldings([]);
      setError(null);
      setSaving(false);
    }, 360);
    return () => clearTimeout(id);
  }, [open]);

  const totalWeight = useMemo(
    () => holdings.reduce((s, h) => s + h.weight, 0),
    [holdings]
  );
  const totalIs100 = Math.abs(totalWeight - 1) <= WEIGHT_TOLERANCE;

  const canAdvanceFromStep1 = name.trim().length > 0;
  const canAdvanceFromStep2 = holdings.length > 0;
  const canSave = holdings.length > 0 && totalIs100 && !saving;

  function setHoldingWeight(ticker: string, weight: number) {
    setHoldings((prev) =>
      prev.map((h) => (h.ticker === ticker ? { ...h, weight: clampWeight(weight) } : h))
    );
  }

  function removeHolding(ticker: string) {
    setHoldings((prev) => prev.filter((h) => h.ticker !== ticker));
  }

  // Distribute 100% across N holdings on the 0.1% grid with the
  // remainder added back to the first M holdings so the total lands
  // exactly at 100.0%. Without this, N=3 → [33.3, 33.3, 33.3] = 99.9%
  // and the save button stays disabled with an "off by 0.10%" warning.
  // For N=3 → [33.4, 33.3, 33.3]. For N=7 → six holdings at 14.3 + one
  // at 14.2 (sum exactly 100.0).
  function equalSplitWeights(n: number): number[] {
    if (n === 0) return [];
    const baseTenths = Math.floor(1000 / n);
    const remainder = 1000 - baseTenths * n;
    return Array.from({ length: n }, (_, i) =>
      (i < remainder ? baseTenths + 1 : baseTenths) / 1000
    );
  }

  function addHolding(r: TickerSearchResult) {
    setHoldings((prev) => {
      if (prev.some((h) => h.ticker === r.symbol)) return prev;
      // Default weight: split evenly among everyone currently in the
      // list + the new addition. Users almost always rebalance from
      // here, but starting at "equal" beats starting at 0 and forcing
      // them to assign every weight manually.
      const next: SelectedHolding[] = [
        ...prev,
        { ticker: r.symbol, name: r.name, type: r.type, weight: 0 },
      ];
      const weights = equalSplitWeights(next.length);
      return next.map((h, i) => ({ ...h, weight: weights[i] }));
    });
  }

  function equalSplit() {
    if (holdings.length === 0) return;
    // Blur any focused weight input so its in-flight draft commits
    // before we overwrite the weights — without this, the user's
    // half-typed value would re-commit on blur and override the split.
    if (
      typeof document !== "undefined" &&
      document.activeElement instanceof HTMLElement
    ) {
      document.activeElement.blur();
    }
    const weights = equalSplitWeights(holdings.length);
    setHoldings((prev) => prev.map((h, i) => ({ ...h, weight: weights[i] })));
  }

  async function save() {
    setError(null);
    setSaving(true);
    try {
      // Remember the creator label for next time so the user doesn't
      // have to re-type their name on every fund.
      if (creator.trim()) {
        window.localStorage.setItem(CREATOR_STORAGE_KEY, creator.trim());
      }
      // Normalize tiny rounding drift so the server-side weight-sum
      // check passes even when the last input was a free-form
      // percentage like "33.4" (which clamps to 0.334 but the other
      // two might be 0.333 → sum 1.000 exactly, or 0.333 → sum 0.999).
      // Distribute the residual to the largest holding.
      let snapped = [...holdings];
      const sum = snapped.reduce((s, h) => s + h.weight, 0);
      const diff = 1 - sum;
      if (Math.abs(diff) > 0 && Math.abs(diff) <= WEIGHT_TOLERANCE * 10) {
        let largestIdx = 0;
        for (let i = 1; i < snapped.length; i++) {
          if (snapped[i].weight > snapped[largestIdx].weight) largestIdx = i;
        }
        snapped = snapped.map((h, i) =>
          i === largestIdx ? { ...h, weight: clampWeight(h.weight + diff) } : h
        );
      }
      const url = isEdit
        ? `/api/funds/${encodeURIComponent(editing!.id)}`
        : "/api/funds";
      const method = isEdit ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          creator: creator.trim() || null,
          holdings: snapped.map((h) => ({ ticker: h.ticker, weight: h.weight })),
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
      eyebrow={`Step ${step} of 3`}
      title={
        step === 1
          ? isEdit
            ? "Edit name"
            : "Name your fund"
          : step === 2
          ? "Pick holdings"
          : "Set allocation"
      }
      doneLabel="Close"
      footer={
        <footer className="flex items-center gap-3 px-5 py-4 border-t border-zinc-800">
          {step > 1 && (
            <button
              className="text-[14px] text-zinc-400 px-3 py-2"
              onClick={() => {
                setError(null);
                setStep((s) => Math.max(1, s - 1) as 1 | 2 | 3);
              }}
              disabled={saving}
            >
              Back
            </button>
          )}
          <div className="flex-1" />
          {step < 3 && (
            <button
              className="bg-white text-black font-semibold rounded-full px-5 py-2.5 text-[14px] disabled:opacity-40"
              disabled={
                (step === 1 && !canAdvanceFromStep1) ||
                (step === 2 && !canAdvanceFromStep2)
              }
              onClick={() => {
                setError(null);
                setStep((s) => Math.min(3, s + 1) as 1 | 2 | 3);
              }}
            >
              Next
            </button>
          )}
          {step === 3 && (
            <button
              className="bg-white text-black font-semibold rounded-full px-5 py-2.5 text-[14px] disabled:opacity-40"
              disabled={!canSave}
              onClick={save}
            >
              {saving ? "Saving…" : isEdit ? "Save changes" : "Save fund"}
            </button>
          )}
        </footer>
      }
    >
      {step === 1 && (
        <>
          {!isEdit && <FundIntro />}
          <StepName
            name={name}
            setName={setName}
            creator={creator}
            setCreator={setCreator}
          />
        </>
      )}
      {step === 2 && (
        <StepSearch
          holdings={holdings}
          addHolding={addHolding}
          removeHolding={removeHolding}
        />
      )}
      {step === 3 && (
        <StepWeights
          holdings={holdings}
          setHoldingWeight={setHoldingWeight}
          removeHolding={removeHolding}
          totalWeight={totalWeight}
          equalSplit={equalSplit}
        />
      )}
      {error && (
        <div className="mt-4 rounded-lg bg-red-950/40 border border-red-900 text-red-300 text-[13px] px-3 py-2">
          {error}
        </div>
      )}
    </Sheet>
  );
}

// Plain-language explainer shown at the top of step 1 in create mode. Tells
// a non-coding player what a fund is, how to build one, and what happens
// after saving. Theme-aware utility classes only (CLAUDE.md §5.6) so it
// flips with the light / twilight palettes.
function FundIntro() {
  const steps: [string, string][] = [
    ["Name it", "what shows on the chart and leaderboard."],
    ["Pick holdings", "search any stock, ETF, or mutual fund."],
    ["Set weights", "how the $100k splits across them (totals 100%)."],
  ];
  return (
    <div className="mb-5 rounded-xl bg-zinc-900/50 border border-zinc-800 p-4">
      <div className="text-[10px] font-bold tracking-[0.16em] uppercase text-zinc-500 mb-1.5">
        What&rsquo;s a fund?
      </div>
      <p className="text-[13px] text-zinc-300 leading-relaxed">
        A fund is your own custom portfolio that joins the game right alongside
        the players. It starts with a pretend{" "}
        <span className="text-white font-medium">$100,000</span> invested at the
        Feb&nbsp;5, 2026 baseline — the same starting line as everyone else —
        then tracks live against real prices.
      </p>
      <div className="text-[10px] font-bold tracking-[0.16em] uppercase text-zinc-500 mt-4 mb-2">
        How to build one
      </div>
      <ol className="space-y-2">
        {steps.map(([title, desc], i) => (
          <li key={title} className="flex gap-2.5 text-[13px] text-zinc-300">
            <span className="shrink-0 w-5 h-5 rounded-full bg-zinc-800 text-zinc-300 text-[11px] font-semibold inline-flex items-center justify-center tabular-nums">
              {i + 1}
            </span>
            <span className="leading-5">
              <span className="text-white font-medium">{title}</span> — {desc}
            </span>
          </li>
        ))}
      </ol>
      <p className="text-[12px] text-zinc-500 leading-relaxed mt-4">
        After you save, your fund shows up on the Compare chart and leaderboard.
        New funds start hidden so the chart doesn&rsquo;t get crowded — tap{" "}
        <span className="text-zinc-300">Filter</span> to switch yours on. You can
        rename, re-weight, or archive it anytime from{" "}
        <span className="text-zinc-300">Manage</span>.
      </p>
    </div>
  );
}

function StepName({
  name,
  setName,
  creator,
  setCreator,
}: {
  name: string;
  setName: (v: string) => void;
  creator: string;
  setCreator: (v: string) => void;
}) {
  return (
    <div className="space-y-4">
      <label className="block">
        <div className="text-[12px] font-medium text-zinc-400 mb-1.5">
          Fund name
        </div>
        <input
          autoFocus
          type="text"
          maxLength={60}
          placeholder="e.g. Theis Trust"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-3 text-[16px] text-white placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600"
        />
        <div className="text-[11px] text-zinc-500 mt-1.5">
          Shown on the leaderboard and chart legend.
        </div>
      </label>
      <label className="block">
        <div className="text-[12px] font-medium text-zinc-400 mb-1.5">
          Your name <span className="text-zinc-600">(optional)</span>
        </div>
        <input
          type="text"
          maxLength={40}
          placeholder="e.g. Brian"
          value={creator}
          onChange={(e) => setCreator(e.target.value)}
          className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-3 text-[16px] text-white placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600"
        />
        <div className="text-[11px] text-zinc-500 mt-1.5">
          Shown in the leaderboard card + the git commit on save. Remembered
          on this device for next time.
        </div>
      </label>
    </div>
  );
}

function StepSearch({
  holdings,
  addHolding,
  removeHolding,
}: {
  holdings: SelectedHolding[];
  addHolding: (r: TickerSearchResult) => void;
  removeHolding: (ticker: string) => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<TickerSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchErr, setSearchErr] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const selected = useMemo(() => new Set(holdings.map((h) => h.ticker)), [holdings]);

  // Debounce + cancel-in-flight so a fast typer doesn't fire one
  // request per keystroke and doesn't render an out-of-order response.
  useEffect(() => {
    if (q.trim().length < 1) {
      setResults([]);
      return;
    }
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setSearchErr(null);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/search-tickers?q=${encodeURIComponent(q.trim())}`,
          { signal: ac.signal }
        );
        const body = (await res.json().catch(() => ({}))) as {
          results?: TickerSearchResult[];
          error?: string;
        };
        if (!res.ok) {
          // Show the upstream error message when the proxy supplies one,
          // so future Yahoo flakiness reads clearly instead of just
          // "(502)". Falls back to the status code if no body.
          throw new Error(body.error ?? `Search failed (${res.status})`);
        }
        setResults(body.results ?? []);
      } catch (e) {
        if ((e as { name?: string }).name === "AbortError") return;
        setSearchErr(e instanceof Error ? e.message : "search failed");
      } finally {
        setLoading(false);
      }
    }, 220);
    return () => {
      clearTimeout(timer);
      ac.abort();
    };
  }, [q]);

  return (
    <div className="space-y-3">
      <p className="text-[12px] text-zinc-400 leading-snug">
        Search by company name or ticker symbol, then tap a result to add it.
        Stocks, ETFs, and mutual funds all work — add as many as you like.
        You&rsquo;ll set how the money splits between them next.
      </p>
      <input
        autoFocus
        type="text"
        placeholder="Search tickers, ETFs, mutual funds…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-3 text-[16px] text-white placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600"
      />
      {holdings.length > 0 && (
        <div className="rounded-xl bg-zinc-900/50 border border-zinc-800 p-3">
          <div className="text-[10px] font-bold tracking-[0.12em] uppercase text-zinc-500 mb-2">
            Selected ({holdings.length})
          </div>
          <div className="flex flex-wrap gap-1.5">
            {holdings.map((h) => (
              <button
                key={h.ticker}
                onClick={() => removeHolding(h.ticker)}
                className="bg-zinc-800 text-zinc-200 text-[13px] px-2.5 py-1 rounded-full hover:bg-zinc-700 transition-colors"
              >
                {h.ticker} ×
              </button>
            ))}
          </div>
        </div>
      )}
      <div>
        {loading && (
          <div className="text-[12px] text-zinc-500 py-2">Searching…</div>
        )}
        {searchErr && (
          <div className="text-[12px] text-red-400 py-2">{searchErr}</div>
        )}
        {!loading && !searchErr && q.trim().length > 0 && results.length === 0 && (
          <div className="text-[12px] text-zinc-500 py-2">
            No matches. Try a different name or symbol.
          </div>
        )}
        <ul className="divide-y divide-zinc-800">
          {results.map((r) => {
            const taken = selected.has(r.symbol);
            return (
              <li key={r.symbol}>
                <button
                  className={
                    "w-full flex items-center gap-3 py-3 text-left " +
                    (taken ? "opacity-40" : "active:bg-zinc-900/40")
                  }
                  disabled={taken}
                  onClick={() => addHolding(r)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-[15px] font-semibold text-white">
                      {r.symbol}
                      <span className="ml-2 text-[11px] font-medium text-zinc-500 uppercase tracking-wider">
                        {r.type}
                      </span>
                    </div>
                    <div className="text-[13px] text-zinc-400 truncate">
                      {r.name}
                      {r.exchange && (
                        <span className="text-zinc-600"> · {r.exchange}</span>
                      )}
                    </div>
                  </div>
                  <div className="text-[13px] font-semibold text-zinc-500">
                    {taken ? "Added" : "Add"}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function StepWeights({
  holdings,
  setHoldingWeight,
  removeHolding,
  totalWeight,
  equalSplit,
}: {
  holdings: SelectedHolding[];
  setHoldingWeight: (ticker: string, weight: number) => void;
  removeHolding: (ticker: string) => void;
  totalWeight: number;
  equalSplit: () => void;
}) {
  // Per-ticker "draft" string. While present, the input renders this
  // value verbatim — so backspaces, partial decimals like "33.", and
  // pasted values stay intact until the user leaves the field. When the
  // user blurs (or commits via Enter), the draft is parsed, clamped to
  // the 0.001 grid, written back via setHoldingWeight, and the draft
  // entry is cleared so the input falls back to the formatted weight.
  //
  // Was a bug before: the input value was `fmtWeightPct(h.weight, 1)`, so
  // every onChange round-tripped the value through clampWeight + format,
  // which collapsed "33." into "33.0" mid-type and made backspacing
  // useless. Drafts decouple the typed string from the canonical
  // numeric weight until the user actually finishes.
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  function commitDraft(ticker: string) {
    const raw = drafts[ticker];
    setDrafts((d) => {
      const next = { ...d };
      delete next[ticker];
      return next;
    });
    if (raw === undefined) return;
    const cleaned = raw.replace(/[^0-9.]/g, "");
    if (cleaned === "" || cleaned === ".") return; // empty / "." → keep prior weight
    const n = parseFloat(cleaned);
    if (!isFinite(n)) return;
    setHoldingWeight(ticker, n / 100);
  }

  const off = Math.abs(totalWeight - 1) > WEIGHT_TOLERANCE;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[12px] text-zinc-400">
          Set how each holding is weighted. $100,000 is split by these
          percentages at the Feb 5, 2026 close.
        </div>
        <button
          onClick={equalSplit}
          className="text-[11px] font-medium text-zinc-400 underline underline-offset-2 shrink-0 ml-3"
        >
          Equal split
        </button>
      </div>
      <ul className="rounded-xl bg-zinc-900/50 border border-zinc-800 divide-y divide-zinc-800">
        {holdings.map((h) => (
          <li key={h.ticker} className="px-3 py-3">
            <div className="flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <div className="text-[14px] font-semibold text-white">
                  {h.ticker}
                </div>
                <div className="text-[12px] text-zinc-500 truncate">
                  {h.name}
                </div>
              </div>
              <input
                type="text"
                inputMode="decimal"
                value={drafts[h.ticker] ?? fmtWeightPct(h.weight, 1).replace("%", "")}
                onChange={(e) =>
                  setDrafts((d) => ({ ...d, [h.ticker]: e.target.value }))
                }
                onBlur={() => commitDraft(h.ticker)}
                onKeyDown={(e) => {
                  // Enter commits without forcing the user to tab out.
                  if (e.key === "Enter") {
                    e.preventDefault();
                    (e.currentTarget as HTMLInputElement).blur();
                  }
                }}
                className="w-20 bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1.5 text-[14px] text-right text-white focus:outline-none focus:border-zinc-600 tabular-nums"
              />
              <span className="text-[14px] text-zinc-500">%</span>
              <button
                onClick={() => removeHolding(h.ticker)}
                className="text-zinc-600 hover:text-zinc-400 text-[18px] px-1"
                aria-label={`Remove ${h.ticker}`}
              >
                ×
              </button>
            </div>
          </li>
        ))}
      </ul>
      <div
        className={
          "rounded-lg px-3 py-2.5 text-[13px] font-medium tabular-nums " +
          (off
            ? "bg-amber-950/40 border border-amber-900 text-amber-300"
            : "bg-emerald-950/40 border border-emerald-900 text-emerald-300")
        }
      >
        Total: {fmtWeightPct(totalWeight, 2)}
        {off && (
          <span className="text-zinc-500 ml-2">
            (off by {((totalWeight - 1) * 100).toFixed(2)}%)
          </span>
        )}
      </div>
    </div>
  );
}
