"use client";

// Manage Funds — full-screen sheet listing every fund, with edit / archive
// buttons inline. A second tab shows recently-archived funds with Restore
// buttons (within the 7-day window). After 7 days an entry stays in
// funds.json (cheap, harmless) but the UI hides it permanently.
//
// Open-game policy: anyone can edit or archive any fund. The git-log
// entry written on each commit is the audit trail. Restore re-publishes
// the entry to the main Compare view; the price archive for its tickers
// is already preserved through the window so the curve picks up where it
// left off.

import { useMemo, useState } from "react";
import type { Fund } from "@/lib/types";

const FUND_RESTORE_WINDOW_DAYS = 7;

function daysSince(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime();
  return ms / (1000 * 60 * 60 * 24);
}

function fmtPct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

interface Props {
  open: boolean;
  funds: Fund[];
  onClose: () => void;
  onChanged: () => void;
  onEdit: (fund: Fund) => void;
}

export function ManageFundsSheet({ open, funds, onClose, onChanged, onEdit }: Props) {
  const [tab, setTab] = useState<"active" | "archive">("active");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Synthetic funds (the roster-derived Combined Players) have no funds.json
  // entry, so they're not editable or archivable — keep them out of both tabs.
  const active = useMemo(
    () => funds.filter((f) => f.deletedAt === null && !f.synthetic),
    [funds]
  );
  const archived = useMemo(
    () =>
      funds
        .filter((f) => f.deletedAt !== null && !f.synthetic)
        .filter((f) => daysSince(f.deletedAt!) < FUND_RESTORE_WINDOW_DAYS)
        .sort((a, b) => b.deletedAt!.localeCompare(a.deletedAt!)),
    [funds]
  );

  async function archive(id: string) {
    if (!confirm("Archive this fund? It can be restored from the Archive tab within 7 days.")) return;
    setPending(id);
    setError(null);
    try {
      const res = await fetch(`/api/funds/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Archive failed (${res.status})`);
      }
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "unknown error");
    } finally {
      setPending(null);
    }
  }

  async function restore(id: string) {
    setPending(id);
    setError(null);
    try {
      const res = await fetch(`/api/funds/${encodeURIComponent(id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restore" }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Restore failed (${res.status})`);
      }
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "unknown error");
    } finally {
      setPending(null);
    }
  }

  if (!open) return null;

  const list = tab === "active" ? active : archived;
  return (
    // z-[100] sits above the global TabBar (z-50); safe-area paddings on
    // the header keep the iOS status bar off the title row. See
    // CreateFundModal for the full rationale on these three details.
    <div className="fixed inset-0 z-[100] flex items-stretch sm:items-center justify-center bg-black/60 backdrop-blur-sm">
      <div
        className="w-full sm:max-w-md sm:rounded-3xl bg-zinc-950 border border-zinc-800 h-[100dvh] sm:h-auto sm:max-h-[90dvh] flex flex-col"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <header
          className="flex items-center justify-between px-5 py-4 border-b border-zinc-800"
          style={{ paddingTop: "max(env(safe-area-inset-top), 1rem)" }}
        >
          <div>
            <div className="text-[10px] font-bold tracking-[0.16em] uppercase text-zinc-500">
              Manage
            </div>
            <h2 className="text-[17px] font-semibold text-white mt-0.5">Funds</h2>
          </div>
          <button
            className="text-zinc-500 hover:text-zinc-300 text-[15px] px-2 py-1"
            onClick={onClose}
            aria-label="Close"
          >
            Close
          </button>
        </header>
        <div className="px-5 pt-3 pb-2 border-b border-zinc-800 flex gap-1">
          <TabBtn label={`Active (${active.length})`} active={tab === "active"} onClick={() => setTab("active")} />
          <TabBtn label={`Archive (${archived.length})`} active={tab === "archive"} onClick={() => setTab("archive")} />
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {error && (
            <div className="mb-3 rounded-lg bg-red-950/40 border border-red-900 text-red-300 text-[13px] px-3 py-2">
              {error}
            </div>
          )}
          {list.length === 0 ? (
            <div className="text-[13px] text-zinc-500 py-6 text-center">
              {tab === "active"
                ? "No funds yet. Create one from the Compare view."
                : "Nothing in the archive."}
            </div>
          ) : (
            <ul className="space-y-2">
              {list.map((f) => (
                <li
                  key={f.id}
                  className="rounded-xl bg-zinc-900/50 border border-zinc-800 p-3"
                >
                  <div className="flex items-center gap-2.5">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: f.color }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-[14px] font-semibold text-white truncate">
                        {f.name}
                      </div>
                      <div className="text-[11px] text-zinc-500 truncate">
                        {f.creator ? `by ${f.creator} · ` : ""}
                        {f.holdings.length}{" "}
                        {f.holdings.length === 1 ? "holding" : "holdings"}
                        {tab === "archive" && f.deletedAt && (
                          <>
                            {" · archived "}
                            {Math.floor(daysSince(f.deletedAt))}d ago
                          </>
                        )}
                      </div>
                    </div>
                    {tab === "active" ? (
                      <>
                        <button
                          className="text-[12px] text-zinc-400 px-2 py-1"
                          onClick={() => onEdit(f)}
                          disabled={pending === f.id}
                        >
                          Edit
                        </button>
                        <button
                          className="text-[12px] text-red-400 px-2 py-1"
                          onClick={() => archive(f.id)}
                          disabled={pending === f.id}
                        >
                          {pending === f.id ? "…" : "Archive"}
                        </button>
                      </>
                    ) : (
                      <button
                        className="text-[12px] text-emerald-400 px-2 py-1"
                        onClick={() => restore(f.id)}
                        disabled={pending === f.id}
                      >
                        {pending === f.id ? "…" : "Restore"}
                      </button>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {f.holdings.map((h) => (
                      <span
                        key={h.ticker}
                        className="text-[11px] bg-zinc-800 text-zinc-300 px-2 py-0.5 rounded-full tabular-nums"
                      >
                        {h.ticker} {fmtPct(h.weight)}
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {tab === "archive" && archived.length > 0 && (
            <div className="text-[11px] text-zinc-500 mt-3 leading-snug">
              Archived funds are recoverable for {FUND_RESTORE_WINDOW_DAYS} days
              from when you archived them. After that the entry stays in the
              repo but the UI hides it.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TabBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={
        "px-3 py-1.5 rounded-full text-[12px] font-medium " +
        (active
          ? "bg-zinc-800 text-white"
          : "text-zinc-500")
      }
    >
      {label}
    </button>
  );
}
