import Link from "next/link";
import { spinoffNoteFor } from "@/lib/events";
import { fmtDateShort } from "@/lib/portfolio";

// Amber, matching MarketStateBadge's NOTICE_COLOR — the app's existing color
// for "here's context you need, not an error."
const NOTE_COLOR = "#F5A623";

/**
 * Short suffix for list-row subtitles, e.g. "3.20 shares • $123.45 · split
 * off HONA Jun 29". Null for tickers with no spin-off involvement.
 */
export function spinoffRowSuffix(ticker: string): string | null {
  const note = spinoffNoteFor(ticker);
  if (!note) return null;
  return note.role === "parent"
    ? `split off ${note.event.childTicker} ${fmtDateShort(note.event.effectiveDate)}`
    : `new from ${note.event.parentTicker} spin-off`;
}

/**
 * Full explanatory banner for the stock detail page — placed right before
 * the owner PositionCards, where an isolated "Total return" on the parent
 * (or a fresh-looking cost basis on the child) would otherwise read as a
 * real, unexplained loss or windfall.
 */
export function SpinoffBanner({ ticker }: { ticker: string }) {
  const note = spinoffNoteFor(ticker);
  if (!note) return null;
  const { role, event } = note;
  const dateLabel = fmtDateShort(event.effectiveDate);
  const ratio = event.sharesPerParentShare;

  const copy =
    role === "parent"
      ? `${event.parentTicker} spun off ${event.childName} (${event.childTicker}) on ${dateLabel}. Holders received ${ratio} ${event.childTicker} share${ratio === 1 ? "" : "s"} per ${event.parentTicker} share — the move shown here reflects only the value that stayed in ${event.parentTicker}, not a loss.`
      : `${event.childName} (${event.childTicker}) began trading ${dateLabel} after splitting off from ${event.parentTicker}. This position was received via the spin-off, not bought with new cash.`;

  const otherTicker = role === "parent" ? event.childTicker : event.parentTicker;

  return (
    <div className="px-4 mt-3">
      <div className="rounded-2xl bg-card border border-hairline px-4 py-3 text-[12px] leading-snug text-ink-muted">
        <span style={{ color: NOTE_COLOR }} className="font-semibold">
          Spin-off note —{" "}
        </span>
        {copy}{" "}
        <Link href={`/stock/${otherTicker}`} className="font-semibold underline" style={{ color: NOTE_COLOR }}>
          See {otherTicker}
        </Link>
      </div>
    </div>
  );
}
