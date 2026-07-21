"use client";

// The game's story made visible: one thin column per trading day, colored by
// that day's leader — "who wore the crown when" — plus the derived records
// (longest reign, current run, total days led). Tap or drag across the tape
// to inspect a day; the caption below names it. Pure client derivation from
// the daily series CompareView already holds.
import { useMemo, useState } from "react";
import { computeRankHistory } from "@/lib/rank-history";
import { USERS, type UserId } from "@/lib/picks";
import { accentFor, useP3 } from "@/lib/color";
import { fmtDateLong } from "@/lib/portfolio";
import type { PortfolioPoint } from "@/lib/types";

export function LeadTape({
  series,
}: {
  series: Record<UserId, PortfolioPoint[]>;
}) {
  const p3 = useP3();
  const history = useMemo(() => computeRankHistory(series), [series]);
  const [selected, setSelected] = useState<number | null>(null);

  if (history.days.length < 5) return null;

  const colorOf = (id: UserId) => accentFor(USERS[id], p3);
  const nameOf = (id: UserId) => USERS[id].name;
  const sel = selected != null ? history.days[selected] : null;

  function pick(clientX: number, el: HTMLDivElement) {
    const rect = el.getBoundingClientRect();
    const frac = Math.min(0.999, Math.max(0, (clientX - rect.left) / rect.width));
    setSelected(Math.floor(frac * history.days.length));
  }

  return (
    <div className="px-4 mt-6">
      <h2 className="text-[15px] font-semibold text-ink-3 mb-2">Lead Tape</h2>
      <div className="rounded-2xl bg-card border border-hairline p-4">
        <div
          className="flex h-7 rounded overflow-hidden cursor-pointer"
          style={{ touchAction: "pan-y" }}
          onPointerDown={(e) => pick(e.clientX, e.currentTarget)}
          onPointerMove={(e) => {
            if (e.buttons > 0) pick(e.clientX, e.currentTarget);
          }}
          onPointerLeave={() => setSelected(null)}
        >
          {history.days.map((d, i) => (
            <div
              key={d.date}
              className="flex-1"
              style={{
                backgroundColor: colorOf(d.leaderId),
                opacity: selected == null || selected === i ? 1 : 0.45,
              }}
            />
          ))}
        </div>
        <div className="mt-2 text-[11px] text-ink-faint tabular-nums h-4">
          {sel
            ? `${fmtDateLong(sel.date)} — ${nameOf(sel.leaderId)} led`
            : "Each stripe is a trading day, colored by who led the game."}
        </div>

        <div className="mt-3 pt-3 border-t border-hairline space-y-1.5 text-[12px]">
          {history.longestReign && (
            <RecordLine
              label="Longest reign"
              color={colorOf(history.longestReign.id)}
              text={`${nameOf(history.longestReign.id)} · ${history.longestReign.days} trading day${history.longestReign.days === 1 ? "" : "s"}`}
            />
          )}
          {history.currentStreak && (
            <RecordLine
              label="Current run"
              color={colorOf(history.currentStreak.id)}
              text={`👑 ${nameOf(history.currentStreak.id)} · ${history.currentStreak.days} trading day${history.currentStreak.days === 1 ? "" : "s"} and counting`}
            />
          )}
          {history.totals.length > 0 && (
            <div className="flex items-center gap-2 pt-1">
              <span className="text-[11px] text-ink-faint shrink-0 w-24">Days in front</span>
              <div className="flex h-2 flex-1 rounded-full overflow-hidden">
                {history.totals.map((t) => (
                  <div
                    key={t.id}
                    title={`${nameOf(t.id)} · ${t.days}`}
                    style={{
                      backgroundColor: colorOf(t.id),
                      width: `${(t.days / history.days.length) * 100}%`,
                    }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function RecordLine({
  label,
  color,
  text,
}: {
  label: string;
  color: string;
  text: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-ink-faint shrink-0 w-24">{label}</span>
      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
      <span className="text-ink-2 font-medium tabular-nums">{text}</span>
    </div>
  );
}
