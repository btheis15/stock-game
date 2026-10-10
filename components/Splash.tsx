"use client";

import { useEffect, useState } from "react";
import { SPLASH_SEEN_KEY } from "@/lib/splash";

// Launch splash — shown once per session (cold PWA open / first tab load)
// while the server streams the first page in behind it.
//
// Frame 0 is pixel-matched to the iOS apple-touch-startup-image
// (scripts/make-icons.py → make_splash: the icon art at 32% of the viewport
// width, dead center on #000), so the hand-off from the OS launch image to
// this live HTML is seamless — the mark never jumps. From there it comes
// alive: a glint traces both lines, endpoint dots pop with the live-pulse
// ring, and the wordmark rises in underneath. It leaves once the document
// has fully loaded (streamed page included) AND a short minimum has elapsed,
// so the animation always reads as intentional rather than a flash.
//
// Skip logic lives in an inline <head> script in app/layout.tsx: it sets
// <html data-splash="skip"> before first paint when sessionStorage says this
// session already saw it, so reloads / resume-reloads don't replay it.
// A CSS-only failsafe (splashFailsafe in globals.css) hides it even if JS
// never runs. All motion is CSS and degrades through the global
// reduced-motion guard.

const MIN_VISIBLE_MS = 1400; // measured from navigation start
const MAX_WAIT_MS = 4000; // never hold the app hostage to a slow asset

// Same geometry as make_icon() in scripts/make-icons.py, on a 0–100 canvas
// (18% margin → 64-unit plot area).
const at = (x: number, y: number) => `${18 + 64 * x},${18 + 64 * y}`;
const BRIAN = [at(0, 0.78), at(0.2, 0.62), at(0.38, 0.66), at(0.58, 0.42), at(0.78, 0.32), at(1, 0.1)].join(" ");
const KEVIN = [at(0, 0.78), at(0.22, 0.74), at(0.42, 0.5), at(0.62, 0.58), at(0.82, 0.4), at(1, 0.3)].join(" ");

export function Splash() {
  const [phase, setPhase] = useState<"show" | "leaving" | "gone">("show");

  useEffect(() => {
    if (document.documentElement.dataset.splash === "skip") {
      setPhase("gone");
      return;
    }
    try {
      window.sessionStorage.setItem(SPLASH_SEEN_KEY, "1");
    } catch {}

    let done = false;
    const leave = () => {
      if (done) return;
      done = true;
      const wait = Math.max(0, MIN_VISIBLE_MS - performance.now());
      window.setTimeout(() => setPhase("leaving"), wait);
    };
    if (document.readyState === "complete") leave();
    else window.addEventListener("load", leave, { once: true });
    const cap = window.setTimeout(leave, MAX_WAIT_MS);
    return () => {
      window.removeEventListener("load", leave);
      window.clearTimeout(cap);
    };
  }, []);

  if (phase === "gone") return null;

  return (
    <div
      className={phase === "leaving" ? "splash is-leaving" : "splash"}
      aria-hidden
      onAnimationEnd={(e) => {
        if (e.target === e.currentTarget && phase === "leaving") setPhase("gone");
      }}
    >
      <svg className="splash-mark" viewBox="0 0 100 100" fill="none">
        <polyline points={KEVIN} stroke="#5ac8fa" strokeWidth="4.5" strokeLinejoin="round" />
        <polyline points={BRIAN} stroke="#00c805" strokeWidth="4.5" strokeLinejoin="round" />
        <polyline className="splash-glint" points={KEVIN} pathLength={1} strokeWidth="4.5" strokeLinejoin="round" strokeLinecap="round" />
        <polyline className="splash-glint splash-glint-2" points={BRIAN} pathLength={1} strokeWidth="4.5" strokeLinejoin="round" strokeLinecap="round" />
        <circle className="splash-ring" cx="82" cy="24.4" r="3" stroke="#00c805" strokeWidth="1.5" />
        <circle className="splash-dot" cx="82" cy="37.2" r="3.4" fill="#5ac8fa" />
        <circle className="splash-dot splash-dot-2" cx="82" cy="24.4" r="3.4" fill="#00c805" />
      </svg>
      <div className="splash-copy">
        <div className="splash-word">Stock Game</div>
        <div className="splash-tag">Loser pays for golf</div>
      </div>
    </div>
  );
}
