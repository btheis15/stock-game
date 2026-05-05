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
    match: (p) => p === "/",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6">
        <path d="M3 17l5-6 4 5 4-7 5 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    href: "/portfolio/brian",
    label: "Brian",
    match: (p) => p.startsWith("/portfolio/brian"),
    icon: <Avatar letter="B" />,
  },
  {
    href: "/portfolio/kevin",
    label: "Kevin",
    match: (p) => p.startsWith("/portfolio/kevin"),
    icon: <Avatar letter="K" />,
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
];

function Avatar({ letter }: { letter: string }) {
  return (
    <div className="w-6 h-6 rounded-full bg-zinc-800 text-[11px] font-bold flex items-center justify-center">
      {letter}
    </div>
  );
}

export function TabBar() {
  const pathname = usePathname();
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 bg-black/95 backdrop-blur-md border-t border-zinc-900"
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
                "flex flex-col items-center gap-1 transition-colors",
                active ? "text-white" : "text-zinc-500"
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
