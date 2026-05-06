"use client";

export function MarketStateBadge({
  live,
  generatedAt,
}: {
  live: boolean;
  generatedAt?: string;
}) {
  const updatedStr = generatedAt
    ? new Date(generatedAt).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
      })
    : null;
  return (
    <div className="px-4 -mt-1 mb-1 flex items-center gap-2">
      {live ? (
        <span className="inline-flex items-center gap-1.5 text-[10px] font-bold tracking-[0.12em] uppercase text-[#00C805]">
          <span
            className="w-1.5 h-1.5 rounded-full bg-[#00C805]"
            style={{ animation: "livePulseFill 1.6s ease-out infinite" }}
          />
          Market open
        </span>
      ) : (
        <span className="inline-flex items-center gap-1.5 text-[10px] font-bold tracking-[0.12em] uppercase text-zinc-500">
          <span className="w-1.5 h-1.5 rounded-full bg-zinc-600" />
          Market closed
        </span>
      )}
      {updatedStr && (
        <span className="text-[10px] font-medium tracking-wide text-zinc-600">
          Last updated {updatedStr}
        </span>
      )}
    </div>
  );
}
