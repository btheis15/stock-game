"use client";

import { useRouter } from "next/navigation";

export function HeaderBack({ title }: { title?: string }) {
  const router = useRouter();
  return (
    <div className="flex items-center gap-3 px-4 pt-3 pb-2">
      <button
        onClick={() => router.back()}
        aria-label="Back"
        className="w-9 h-9 -ml-2 rounded-full flex items-center justify-center hover:bg-zinc-900 active:bg-zinc-800 transition-colors"
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
      {title && <span className="text-sm font-medium text-zinc-400">{title}</span>}
    </div>
  );
}
