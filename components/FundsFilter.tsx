"use client";

// Filter chip row on the Compare view. One chip per player + S&P 500
// baseline + each user-created fund. Tapping a chip toggles whether that
// entity's line + leaderboard row is shown. State persists per device in
// localStorage so a user's preferred view sticks across visits.
//
// Defaults:
//   - All players ON (so the page looks the same as before for a new visitor)
//   - S&P 500 ON (same)
//   - User-created funds OFF (so the chart doesn't grow crowded as funds
//     accumulate; the creator can flip theirs on, share the link, or
//     pin via the Manage view)

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "stockgame.compare.filter";

export interface FilterChipDef {
  id: string;
  name: string;
  color: string;
  /** Where the toggle starts when no localStorage entry exists for this id. */
  defaultOn: boolean;
}

export interface FundsFilterState {
  /** id → on/off. Missing ids fall back to the chip's defaultOn at render
   *  time, so newly-added funds with no stored state respect their default. */
  toggles: Record<string, boolean>;
}

export function useFundsFilter(): {
  state: FundsFilterState;
  isOn: (id: string, defaultOn: boolean) => boolean;
  setOn: (id: string, on: boolean) => void;
} {
  const [state, setState] = useState<FundsFilterState>({ toggles: {} });

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as FundsFilterState;
        if (parsed && typeof parsed.toggles === "object") {
          setState(parsed);
        }
      }
    } catch {
      // Ignore corrupt storage — user gets defaults.
    }
  }, []);

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
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Storage full / disabled / private mode — preference still
        // applies for this session, just doesn't persist.
      }
      return next;
    });
  }, []);

  return { state, isOn, setOn };
}

export function FundsFilterChips({
  chips,
  isOn,
  setOn,
  onCreate,
  onManage,
}: {
  chips: FilterChipDef[];
  isOn: (id: string, defaultOn: boolean) => boolean;
  setOn: (id: string, on: boolean) => void;
  onCreate: () => void;
  onManage: () => void;
}) {
  return (
    <div className="px-4 mb-2">
      <div className="flex items-center gap-1.5 overflow-x-auto -mx-1 px-1 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {chips.map((c) => {
          const on = isOn(c.id, c.defaultOn);
          return (
            <button
              key={c.id}
              onClick={() => setOn(c.id, !on)}
              className={
                "shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-medium border transition-colors " +
                (on
                  ? "bg-zinc-800 border-zinc-700 text-white"
                  : "bg-transparent border-zinc-800 text-zinc-500")
              }
              aria-pressed={on}
            >
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: c.color, opacity: on ? 1 : 0.4 }}
              />
              {c.name}
            </button>
          );
        })}
        <button
          onClick={onCreate}
          className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[12px] font-semibold bg-white text-black"
        >
          + Fund
        </button>
        <button
          onClick={onManage}
          className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[12px] text-zinc-400 underline underline-offset-2"
        >
          Manage
        </button>
      </div>
    </div>
  );
}
