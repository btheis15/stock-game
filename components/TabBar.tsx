"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";

interface Tab {
  href: string;
  label: string;
  match: (path: string) => boolean;
  icon: React.ReactNode;
}

const TABS: Tab[] = [
  {
    href: "/",
    label: "Compare",
    match: (p) => p === "/" || p.startsWith("/portfolio"),
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6">
        <path
          d="M3 17l5-6 4 5 4-7 5 9"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    href: "/stocks",
    label: "Stocks",
    match: (p) => p.startsWith("/stocks") || p.startsWith("/stock/"),
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6">
        <circle cx="11" cy="11" r="6" stroke="currentColor" strokeWidth="2" />
        <path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: "/tee-times",
    label: "Tee Times",
    match: (p) => p.startsWith("/tee-times"),
    // Golf ball on a tee. Ball = circle with a few dimples; tee = "Y" stem
    // anchored at the bottom edge.
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6">
        <circle cx="12" cy="9" r="4.5" stroke="currentColor" strokeWidth="2" />
        <circle cx="10.5" cy="8" r="0.5" fill="currentColor" />
        <circle cx="13.5" cy="8" r="0.5" fill="currentColor" />
        <circle cx="12" cy="10.5" r="0.5" fill="currentColor" />
        <path
          d="M9 15l3 3 3-3M12 18v3"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
];

export function TabBar() {
  const pathname = usePathname();
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 bg-chrome backdrop-blur-md border-t border-hairline-deep"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="max-w-md mx-auto flex items-center justify-around h-16">
        {TABS.map((t) => {
          const active = t.match(pathname);
          return (
            <Link
              key={t.href}
              href={t.href}
              prefetch
              className={clsx(
                "press flex flex-col items-center gap-1 transition-colors flex-1",
                active ? "text-ink" : "text-ink-faint"
              )}
            >
              {t.icon}
              <span className="text-[10px] font-medium tracking-wide">{t.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
