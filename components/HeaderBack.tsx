"use client";

import { useRouter } from "next/navigation";

export function HeaderBack({ title }: { title?: string }) {
  const router = useRouter();
  // <main> in app/layout.tsx applies `paddingTop: env(safe-area-inset-top)`
  // so pages with no header (Compare, Stocks, Tee Times) start their content
  // cleanly below the iOS status bar. For pages that DO have a header
  // (HeaderBack), main's padding would double up with the header's own
  // safe-area padding — visible as ~100px of empty space at the top instead
  // of ~50px. The negative `marginTop` here cancels main's padding so the
  // header itself starts at the viewport's top edge; the header's own
  // `paddingTop` then re-establishes the safe area inside its background
  // band. That way:
  //   - When the page is at the top (not scrolled): the back arrow sits at
  //     safe-area-inset-top from the viewport, exactly like the Compare
  //     page's first label.
  //   - When scrolled (sticky engages): the header is already at viewport
  //     top and its inner safe-area padding still keeps the back arrow
  //     below the status bar.
  return (
    <div
      className="sticky top-0 z-30 flex items-center gap-3 px-4 pb-2 bg-chrome-soft backdrop-blur-md"
      style={{
        marginTop: "calc(-1 * env(safe-area-inset-top))",
        paddingTop: "max(env(safe-area-inset-top), 12px)",
      }}
    >
      <button
        onClick={() => router.back()}
        aria-label="Back"
        className="press w-9 h-9 -ml-2 rounded-full flex items-center justify-center bg-card hover:bg-raised active:bg-strong"
      >
        <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5">
          <path
            d="M15 18l-6-6 6-6"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {title && <span className="text-sm font-medium text-ink-3">{title}</span>}
    </div>
  );
}
