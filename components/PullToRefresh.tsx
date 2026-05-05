"use client";

import { useEffect, useRef, useState } from "react";

const TRIGGER = 70;
const MAX_PULL = 110;
const RESISTANCE = 0.55;
const RESUME_RELOAD_MS = 60_000;

export function PullToRefresh() {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef<number | null>(null);
  const startX = useRef<number | null>(null);
  const aborted = useRef(false);

  useEffect(() => {
    const onTouchStart = (e: TouchEvent) => {
      if (window.scrollY > 0) return;
      const target = e.target as Element | null;
      if (target?.closest("svg")) return; // chart scrub area
      if (target?.closest("[data-no-ptr]")) return;
      startY.current = e.touches[0].clientY;
      startX.current = e.touches[0].clientX;
      aborted.current = false;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (startY.current === null || aborted.current) return;
      const dy = e.touches[0].clientY - startY.current;
      const dx = e.touches[0].clientX - (startX.current ?? 0);
      if (Math.abs(dx) > Math.abs(dy) + 4) {
        aborted.current = true;
        setPull(0);
        return;
      }
      if (dy > 0 && window.scrollY === 0) {
        setPull(Math.min(MAX_PULL, dy * RESISTANCE));
      } else if (dy < 0) {
        setPull(0);
      }
    };

    const onTouchEnd = () => {
      if (pull > TRIGGER) {
        setRefreshing(true);
        setPull(TRIGGER);
        setTimeout(() => {
          window.location.reload();
        }, 120);
      } else {
        setPull(0);
      }
      startY.current = null;
      startX.current = null;
    };

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("touchcancel", onTouchEnd, { passive: true });

    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [pull]);

  useEffect(() => {
    let hiddenAt: number | null = null;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
      } else if (hiddenAt !== null && Date.now() - hiddenAt > RESUME_RELOAD_MS) {
        hiddenAt = null;
        setRefreshing(true);
        window.location.reload();
      } else {
        hiddenAt = null;
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const visible = pull > 4 || refreshing;
  const ready = pull > TRIGGER;
  const opacity = Math.min(1, pull / 35);
  const arrowRotation = Math.min(180, (pull / TRIGGER) * 180);

  return (
    <div
      className="fixed left-0 right-0 z-40 flex justify-center pointer-events-none"
      style={{
        top: 0,
        paddingTop: `calc(env(safe-area-inset-top) + 8px)`,
        transform: `translateY(${visible ? pull * 0.5 : -50}px)`,
        opacity: visible ? opacity : 0,
        transition: refreshing
          ? "transform 0.2s ease"
          : startY.current === null
          ? "transform 0.25s ease, opacity 0.25s ease"
          : "none",
      }}
    >
      <div className="w-10 h-10 rounded-full bg-zinc-900/95 border border-zinc-800 flex items-center justify-center shadow-2xl backdrop-blur-md">
        {refreshing ? (
          <Spinner />
        ) : (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            className="w-5 h-5 transition-transform"
            style={{
              transform: `rotate(${arrowRotation}deg)`,
              color: ready ? "#00C805" : "#a1a1aa",
            }}
          >
            <path
              d="M12 4v14m0 0l-5-5m5 5l5-5"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5 animate-spin" fill="none">
      <circle cx="12" cy="12" r="9" stroke="rgba(255,255,255,0.15)" strokeWidth="2.5" />
      <path
        d="M12 3a9 9 0 019 9"
        stroke="#fff"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
