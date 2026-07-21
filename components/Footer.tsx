import { fmtDateLong } from "@/lib/portfolio";
import { RelativeTime } from "@/components/RelativeTime";

export function Footer({
  lastDate,
  generatedAt,
}: {
  lastDate: string;
  generatedAt: string;
}) {
  return (
    <div className="px-4 py-6 text-center text-[11px] text-ink-ghost leading-relaxed">
      Data through {fmtDateLong(lastDate)}
      <br />
      <RelativeTime
        iso={generatedAt}
        prefix="Snapshot"
        className="text-ink-ghost-2"
      />
    </div>
  );
}
