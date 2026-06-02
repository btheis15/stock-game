"use client";

// Visibility filter for the Compare view's chart + leaderboard. Was a
// chip row across the top, but that got crowded fast as funds
// accumulated (1 chip per player + 1 per baseline + N per fund). Now
// it's a compact pill — "Show 5 of 7" — that opens a bottom sheet with
// per-line toggles grouped by section.
//
// Filter state persists per device in localStorage. New entities not in
// the stored state fall back to their `defaultOn` flag, so a
// freshly-added fund respects whatever default it was created with even
// without a storage entry. The Filter pill is paired with two action
// buttons in CompareView: Add Fund (opens CreateFundModal) and Manage
// (opens ManageFundsSheet).

import { useCallback, useEffect, useMemo, useState } from "react";
import { Sheet } from "@/components/Sheet";

const DEFAULT_STORAGE_KEY = "stockgame.compare.filter";

export interface FilterChipDef {
  id: string;
  name: string;
  color: string;
  /** Group label shown above this row in the FilterSheet. */
  group: "Players" | "Baseline" | "Funds";
  /** Where the toggle starts when no localStorage entry exists for this id. */
  defaultOn: boolean;
}

export interface FundsFilterState {
  /** id → on/off. Missing ids fall back to the chip's defaultOn at render
   *  time, so newly-added funds with no stored state respect their default. */
  toggles: Record<string, boolean>;
}

export function useFundsFilter(storageKey: string = DEFAULT_STORAGE_KEY): {
  state: FundsFilterState;
  isOn: (id: string, defaultOn: boolean) => boolean;
  setOn: (id: string, on: boolean) => void;
} {
  const [state, setState] = useState<FundsFilterState>({ toggles: {} });

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as FundsFilterState;
        if (parsed && typeof parsed.toggles === "object") {
          setState(parsed);
        }
      }
    } catch {
      // Ignore corrupt storage — user gets defaults.
    }
  }, [storageKey]);

  const isOn = useCallback(
    (id: string, defaultOn: boolean) => {
      const v = state.toggles[id];
      return v === undefined ? defaultOn : v;
    },
    [state]
  );

  const setOn = useCallback((id: string, on: boolean) => {
    setState((prev) => {
      const next = { toggles: { ...prev.toggles, [id]: on } };
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // Storage full / disabled / private mode — preference still
        // applies for this session, just doesn't persist.
      }
      return next;
    });
  }, [storageKey]);

  return { state, isOn, setOn };
}

/** The compact pill row that sits above the chart. Filter / Add Fund / Manage. */
export function FilterToolbar({
  chips,
  isOn,
  onOpenFilter,
  onCreate,
  onManage,
  label = "Show",
}: {
  chips: FilterChipDef[];
  isOn: (id: string, defaultOn: boolean) => boolean;
  onOpenFilter: () => void;
  // Omitted on the portfolio page, which only filters comparison overlays —
  // fund creation / management lives on the Compare tab.
  onCreate?: () => void;
  onManage?: () => void;
  /** Verb in the pill, e.g. "Show" (Compare) or "Compare" (portfolio). */
  label?: string;
}) {
  const visibleCount = chips.filter((c) => isOn(c.id, c.defaultOn)).length;
  return (
    <div className="px-4 mb-2 flex items-center gap-2">
      <button
        onClick={onOpenFilter}
        className="press inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium bg-zinc-800 border border-zinc-700 text-zinc-200 active:bg-zinc-700 transition-colors"
        aria-label="Open filter"
      >
        <FilterIcon />
        <span>
          {label} {visibleCount} of {chips.length}
        </span>
      </button>
      <div className="flex-1" />
      {onCreate && (
        <button
          onClick={onCreate}
          className="press inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-[12px] font-semibold bg-white text-black"
          aria-label="Add a fund to the game"
        >
          <PlusIcon />
          Add Fund
        </button>
      )}
      {onManage && (
        <button
          onClick={onManage}
          className="press inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[12px] text-zinc-400"
          aria-label="Manage funds"
        >
          Manage
        </button>
      )}
    </div>
  );
}

function FilterIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 5h16M7 12h10M10 19h4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 5v14M5 12h14"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Bottom sheet that opens from the Filter pill. Lists every togglable
 *  line in three groups (Players → Baseline → Funds) with iOS-style
 *  toggle switches. Toggles persist immediately via setOn(); the user
 *  closes the sheet manually when they're done. */
export function FilterSheet({
  open,
  chips,
  isOn,
  setOn,
  onClose,
}: {
  open: boolean;
  chips: FilterChipDef[];
  isOn: (id: string, defaultOn: boolean) => boolean;
  setOn: (id: string, on: boolean) => void;
  onClose: () => void;
}) {
  const grouped = useMemo(() => {
    const g: Record<string, FilterChipDef[]> = { Players: [], Baseline: [], Funds: [] };
    for (const c of chips) g[c.group].push(c);
    return g;
  }, [chips]);

  // A partial, content-height iOS sheet (drag-to-dismiss, springs up from the
  // bottom) rather than a full-screen panel — the filter list is short, so it
  // reads as a "card" that doesn't swallow the whole screen.
  return (
    <Sheet open={open} onClose={onClose} eyebrow="Filter" title="Visible on chart">
      {(["Players", "Baseline", "Funds"] as const).map((group) => {
        const list = grouped[group];
        if (!list || list.length === 0) return null;
        return (
          <div key={group} className="mb-5">
            <div className="text-[10px] font-bold tracking-[0.16em] uppercase text-zinc-500 mb-2">
              {group}
            </div>
            <ul className="rounded-xl bg-zinc-900/50 border border-zinc-800 divide-y divide-zinc-800">
              {list.map((c) => {
                const on = isOn(c.id, c.defaultOn);
                return (
                  <li key={c.id}>
                    <button
                      onClick={() => setOn(c.id, !on)}
                      className="w-full flex items-center gap-3 px-3 py-3 active:bg-zinc-900/40 transition-colors"
                      aria-pressed={on}
                    >
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: c.color, opacity: on ? 1 : 0.3 }}
                      />
                      <span className="flex-1 text-left text-[15px] font-medium text-white truncate">
                        {c.name}
                      </span>
                      <ToggleSwitch on={on} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
      {grouped.Funds.length === 0 && (
        <div className="text-[11px] text-zinc-500 leading-snug -mt-3">
          No funds yet — tap <span className="text-zinc-300">Add Fund</span> above to create one.
        </div>
      )}
    </Sheet>
  );
}

function ToggleSwitch({ on }: { on: boolean }) {
  return (
    <span
      className={
        "relative inline-block w-9 h-5 rounded-full shrink-0 transition-colors " +
        (on ? "bg-emerald-500" : "bg-zinc-700")
      }
      aria-hidden
    >
      <span
        className={
          "absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform " +
          (on ? "translate-x-4" : "translate-x-0")
        }
      />
    </span>
  );
}
