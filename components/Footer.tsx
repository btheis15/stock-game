import { fmtDateLong } from "@/lib/portfolio";

export function Footer({
  lastDate,
  generatedAt,
}: {
  lastDate: string;
  generatedAt: string;
}) {
  const generated = new Date(generatedAt);
  const generatedStr = generated.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return (
    <div className="px-4 py-6 text-center text-[11px] text-zinc-600 leading-relaxed">
      Data through {fmtDateLong(lastDate)}
      <br />
      <span className="text-zinc-700">Snapshot generated {generatedStr}</span>
    </div>
  );
}
