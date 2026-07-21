"use client";

import { useEffect } from "react";

// Route-segment error boundary — catches render/runtime errors inside the
// page tree while the root layout (tab bar, footer, theme) keeps working.
// Root-layout crashes fall through to app/global-error.tsx instead.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="px-4 pt-20 pb-12 text-center">
      <div className="text-[11px] font-bold tracking-[0.12em] uppercase text-ink-faint">
        Stock Game
      </div>
      <h1 className="mt-2 text-[22px] font-bold text-ink">
        Something went wrong
      </h1>
      <p className="mt-2 text-[13px] text-ink-faint">
        The page hit an error — the standings are safe, this is just a display
        hiccup.
      </p>
      <button
        type="button"
        onClick={() => reset()}
        className="press inline-flex items-center mt-6 px-5 py-2.5 rounded-full bg-white text-black text-[14px] font-semibold"
      >
        Try again
      </button>
    </div>
  );
}
