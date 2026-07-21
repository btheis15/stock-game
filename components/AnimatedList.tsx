"use client";

// FLIP re-ordering for ranked lists (leaderboard, holdings, stocks list):
// wrap each row in <AnimatedRow id=…> and rows GLIDE to their new slots when
// a sort/rank changes instead of teleporting. framer's layout animation is
// transform-based (GPU) and only fires when same-keyed siblings reorder.
//
// `animate={false}` renders a plain div — callers MUST pass that while a
// chart scrub is driving live re-ranking (CompareView), so rows snap
// frame-locked with the finger instead of springing behind it (the §6 16ms
// scrub budget applies to everything the scrub updates, not just the chart).
import { motion } from "framer-motion";
import type { ReactNode } from "react";

// ≈ iOS list spring: fast settle, no visible bounce.
const SPRING = { type: "spring", stiffness: 500, damping: 40 } as const;

export function AnimatedRow({
  animate = true,
  children,
}: {
  animate?: boolean;
  children: ReactNode;
}) {
  if (!animate) return <div>{children}</div>;
  return (
    <motion.div layout="position" transition={SPRING}>
      {children}
    </motion.div>
  );
}
