"use client";

// "Share standings" — renders the current leaderboard onto a 1200×630
// canvas (OG-card proportions) and hands it to the iOS share sheet
// (navigator.share with files — supported in Safari/PWA), falling back to
// a plain PNG download elsewhere. Pure client canvas; no dependency, no
// server. Canvas is sRGB, so colors come from the entities' sRGB hexes
// (never the P3 strings).
import { useState } from "react";
import { USERS, type UserId } from "@/lib/picks";
import { fmtPct, fmtUSD } from "@/lib/portfolio";
import type { Range } from "@/lib/types";

export interface ShareEntry {
  id: string;
  name: string;
  color: string;
  value: number;
  pct: number;
}

const RANGE_LABELS: Record<Range, string> = {
  "1D": "Today",
  "1W": "This week",
  "1M": "This month",
  "3M": "This quarter",
  "1YR": "This year",
  ALL: "Since Feb 5, 2026",
};

function srgbColor(entry: ShareEntry): string {
  return (USERS[entry.id as UserId]?.color as string | undefined) ?? entry.color;
}

function drawCard(entries: ShareEntry[], range: Range): HTMLCanvasElement {
  const W = 1200;
  const H = 630;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const font = (px: number, weight = 600) =>
    `${weight} ${px}px -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, sans-serif`;

  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);

  // Header
  ctx.fillStyle = "#71717a";
  ctx.font = font(26, 700);
  ctx.fillText("STOCK GAME", 64, 78);
  ctx.fillStyle = "#fff";
  ctx.font = font(48, 700);
  ctx.fillText(`Standings — ${RANGE_LABELS[range]}`, 64, 138);
  ctx.fillStyle = "#a1a1aa";
  ctx.font = font(26, 500);
  const dateLabel = new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  ctx.fillText(dateLabel, 64, 178);

  // Rows (top 6 fit comfortably)
  const rows = entries.slice(0, 6);
  const top = 226;
  const rowH = 58;
  rows.forEach((e, i) => {
    const y = top + i * rowH;
    ctx.fillStyle = "#71717a";
    ctx.font = font(28, 600);
    ctx.textAlign = "left";
    ctx.fillText(String(i + 1), 64, y + 38);

    ctx.beginPath();
    ctx.arc(122, y + 28, 10, 0, Math.PI * 2);
    ctx.fillStyle = srgbColor(e);
    ctx.fill();

    ctx.fillStyle = i === 0 ? "#ffffff" : "#e4e4e7";
    ctx.font = font(30, i === 0 ? 700 : 600);
    ctx.fillText(e.name, 152, y + 39);

    ctx.textAlign = "right";
    ctx.fillStyle = e.pct >= 0 ? "#00C805" : "#FF453A";
    ctx.font = font(30, 600);
    ctx.fillText(fmtPct(e.pct), W - 300, y + 39);
    ctx.fillStyle = "#a1a1aa";
    ctx.font = font(28, 500);
    ctx.fillText(fmtUSD(e.value, 0), W - 64, y + 39);
    ctx.textAlign = "left";
  });

  // Footer
  ctx.fillStyle = "#52525b";
  ctx.font = font(24, 500);
  ctx.fillText("Loser pays for golf ⛳ — tracked since Feb 5, 2026", 64, H - 48);

  return canvas;
}

export function ShareStandings({
  entries,
  range,
  className,
}: {
  entries: ShareEntry[];
  range: Range;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);

  async function share() {
    if (busy) return;
    setBusy(true);
    try {
      const canvas = drawCard(entries, range);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png")
      );
      if (!blob) return;
      const file = new File([blob], "stock-game-standings.png", { type: "image/png" });
      if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: "Stock Game standings" });
          return;
        } catch (err) {
          // AbortError = user dismissed the share sheet; anything else falls
          // through to the download path.
          if ((err as DOMException)?.name === "AbortError") return;
        }
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "stock-game-standings.png";
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button onClick={share} disabled={busy} className={className}>
      <span className="text-[13px] font-semibold text-ink-2">
        {busy ? "Rendering…" : "📤 Share standings"}
      </span>
    </button>
  );
}
