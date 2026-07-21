import Link from "next/link";

// 404 for anything outside the game — bad ticker symbols, mistyped player
// ids, stale deep links. Renders inside the normal layout (tab bar + footer
// stay), so it just needs the card-less centered message + a way home.
export default function NotFound() {
  return (
    <div className="px-4 pt-20 pb-12 text-center">
      <div className="text-[11px] font-bold tracking-[0.12em] uppercase text-ink-faint">
        Stock Game
      </div>
      <h1 className="mt-2 text-[22px] font-bold text-ink">
        This page doesn&apos;t exist
      </h1>
      <p className="mt-2 text-[13px] text-ink-faint">
        Nothing&apos;s tracked at this address — the game lives elsewhere.
      </p>
      <Link
        href="/"
        className="press inline-flex items-center mt-6 px-5 py-2.5 rounded-full bg-white text-black text-[14px] font-semibold"
      >
        Back to the game
      </Link>
    </div>
  );
}
