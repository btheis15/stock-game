"use client";

// Route transition layer.
//
// template.tsx (unlike layout.tsx) re-mounts its subtree on every App Router
// navigation, which lets us replay a CSS entrance animation each time the
// route changes. We classify the navigation and pick an iOS-style motion:
//
//   • tab ↔ tab (Compare / Stocks / Tee Times)  → quick cross-fade
//   • drilling into a detail (stock/portfolio/fund) → push (slide from right)
//   • backing out of a detail                    → pop  (slide from left)
//
// Why CSS keyframes instead of a framer-motion wrapper: a framer wrapper that
// animates `x`/`y` leaves a `transform: translate(0)` on the element at rest,
// which re-roots any `position: fixed` descendant — and several pages render
// fixed modals inline (CreateFundModal, EditThesisModal, ...). A CSS keyframe
// with `animation-fill-mode: backwards` leaves NO transform once it finishes,
// so those modals stay anchored to the viewport. It's also cheaper per the
// app's 16ms gesture budget (DESIGN.md §14). prefers-reduced-motion is honored
// globally in globals.css, which neutralizes these animations to ~instant.

import { usePathname } from "next/navigation";
import { useEffect } from "react";

// Persists across navigations because the module stays loaded even as the
// template subtree re-mounts. Holds the path we came FROM so we can pick a
// direction for the path we're going TO.
let prevPath: string | null = null;

const isDetail = (path: string) => /^\/(stock|portfolio|fund)\//.test(path);

function directionClass(current: string, previous: string | null): string {
  if (previous === null || previous === current) return "pt-fade";
  if (isDetail(current) && !isDetail(previous)) return "pt-push";
  if (isDetail(previous) && !isDetail(current)) return "pt-pop";
  return "pt-fade";
}

export default function Template({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // Computed from the *previous* path during render; prevPath is updated in
  // the effect below so this stays a pure read.
  const dir = directionClass(pathname, prevPath);

  useEffect(() => {
    prevPath = pathname;
  }, [pathname]);

  return <div className={dir}>{children}</div>;
}
