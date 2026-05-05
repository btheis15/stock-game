"use client";

export function MarketStateBadge({ live }: { live: boolean }) {
  return (
    <div className="px-4 -mt-1 mb-1">
      {live ? (
        <span className="inline-flex items-center gap-1.5 text-[10px] font-bold tracking-[0.12em] uppercase text-[#00C805]">
          <span
            className="w-1.5 h-1.5 rounded-full bg-[#00C805]"
            style={{ animation: "livePulseFill 1.6s ease-out infinite" }}
          />
          Live
        </span>
      ) : (
        <span className="inline-flex items-center gap-1.5 text-[10px] font-bold tracking-[0.12em] uppercase text-zinc-500">
          <span className="w-1.5 h-1.5 rounded-full bg-zinc-600" />
          Market closed
        </span>
      )}
    </div>
  );
}
