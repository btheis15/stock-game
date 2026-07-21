"use client";

// Single MotionConfig for every framer-motion consumer in the tree: honors
// the OS Reduce Motion setting (matching the CSS layer's global
// prefers-reduced-motion guard) so JS-driven springs degrade the same way
// the keyframes do. Mounted once in app/layout.tsx.
import { MotionConfig } from "framer-motion";
import type { ReactNode } from "react";

export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
