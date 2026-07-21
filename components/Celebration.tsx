"use client";

// One-shot lead-change celebration — fires ONLY for the ALL-time lead
// (never shorter windows, per the game's rules of engagement): when today's
// live ALL-game leader differs from the leader at the previous session's
// close, burst ~40 hand-rolled CSS confetti particles in the new leader's
// accent and show a "takes the ALL-time lead" toast above the leaderboard.
// sessionStorage-guarded so it fires once per (day, leader) per session.
// Reduced motion: the global CSS guard freezes the particles; the toast
// still renders (it's information, not decoration).
import { useEffect, useMemo, useState } from "react";

const PARTICLES = 40;

export function Celebration({
  leaderName,
  color,
  storageKey,
}: {
  leaderName: string;
  color: string;
  storageKey: string;
}) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      if (window.sessionStorage.getItem(storageKey)) return;
      window.sessionStorage.setItem(storageKey, "1");
    } catch {
      // storage unavailable → still celebrate, just maybe twice
    }
    setShow(true);
    const id = window.setTimeout(() => setShow(false), 3200);
    return () => window.clearTimeout(id);
  }, [storageKey]);

  // Deterministic pseudo-random spread per particle index (no Math.random
  // in render — keeps SSR/CSR consistent, though this only mounts client-side).
  const particles = useMemo(
    () =>
      Array.from({ length: PARTICLES }, (_, i) => {
        const h = ((i * 2654435761) >>> 0) % 1000;
        return {
          left: (h % 100),
          delay: (h % 400),
          duration: 1800 + (h % 1200),
          size: 5 + (h % 5),
          tilt: (h % 360),
        };
      }),
    []
  );

  if (!show) return null;

  return (
    <>
      <div className="pointer-events-none fixed inset-0 z-[90] overflow-hidden" aria-hidden>
        {particles.map((p, i) => (
          <span
            key={i}
            className="confetti-piece absolute top-[-12px] rounded-[1px]"
            style={{
              left: `${p.left}%`,
              width: p.size,
              height: p.size * 0.45,
              backgroundColor: i % 4 === 0 ? "var(--gain)" : color,
              animationDelay: `${p.delay}ms`,
              animationDuration: `${p.duration}ms`,
              transform: `rotate(${p.tilt}deg)`,
            }}
          />
        ))}
      </div>
      <div className="px-4 mt-2">
        <div
          className="content-in rounded-2xl border px-4 py-2.5 text-[13px] font-semibold text-ink"
          style={{
            borderColor: color,
            backgroundImage: `linear-gradient(90deg, color-mix(in srgb, ${color} 14%, transparent), transparent 70%)`,
          }}
        >
          👑 {leaderName} takes the ALL-time lead
        </div>
      </div>
    </>
  );
}
