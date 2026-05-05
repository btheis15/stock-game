"use client";

import { useRouter } from "next/navigation";

export function HeaderBack({ title }: { title?: string }) {
  const router = useRouter();
  return (
    <div
      className="sticky top-0 z-30 flex items-center gap-3 px-4 pt-3 pb-2 bg-black/85 backdrop-blur-md"
      style={{ paddingTop: "max(env(safe-area-inset-top), 12px)" }}
    >
      <button
        onClick={() => router.back()}
        aria-label="Back"
        className="w-9 h-9 -ml-2 rounded-full flex items-center justify-center bg-zinc-900/70 hover:bg-zinc-800 active:bg-zinc-700 transition-colors"
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
      {title && <span className="text-sm font-medium text-zinc-300">{title}</span>}
    </div>
  );
}
