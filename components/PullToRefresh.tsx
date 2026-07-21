"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

const TRIGGER = 70;
const MAX_PULL = 110;
const RESISTANCE = 0.55;
const RESUME_REFRESH_MS = 60_000;
// A session hidden this long does a full reload once so a never-closed PWA
// eventually picks up new JS bundles. Cold opens already fetch fresh HTML
// (no-store), so this is insurance for marathon sessions only.
const STALE_BUNDLE_RELOAD_MS = 12 * 60 * 60 * 1000;
// Silent in-place data refresh cadence while the app is visible during
// (extended) market hours. Matches the mini's 15-min data cadence closely
// enough that numbers move on their own without a manual pull.
const POLL_MS = 3 * 60_000;
const MIN_SPINNER_MS = 400;

// Rough "US market could be moving" gate for the poll: weekday, 7:00 AM –
// 6:30 PM ET (extended session + slack). Same coarse DST heuristic as the
// rest of the codebase (months 3–10 = EDT).
function marketCouldBeLive(now = new Date()): boolean {
  const month = now.getUTCMonth() + 1;
  const offset = month >= 3 && month <= 10 ? 4 : 5;
  const etHour = (now.getUTCHours() - offset + 24) % 24 + now.getUTCMinutes() / 60;
  const etDay = new Date(now.getTime() - offset * 3_600_000).getUTCDay();
  if (etDay === 0 || etDay === 6) return false;
  return etHour >= 7 && etHour <= 18.5;
}

export function PullToRefresh() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef<number | null>(null);
  const startX = useRef<number | null>(null);
  const aborted = useRef(false);
  const refreshStartedAt = useRef(0);

  // router.refresh() re-renders the server components in place — fresh data
  // streams into the existing client tree with range tab, scroll position,
  // and open sheets preserved. No white flash, unlike the old
  // window.location.reload().
  const refreshData = (showSpinner: boolean) => {
    if (showSpinner) {
      setRefreshing(true);
      refreshStartedAt.current = Date.now();
    }
    startTransition(() => {
      router.refresh();
    });
  };

  // Retract the spinner when the refresh transition settles (with a minimum
  // display time so a fast refresh doesn't flash).
  useEffect(() => {
    if (!refreshing || isPending) return;
    const elapsed = Date.now() - refreshStartedAt.current;
    const t = setTimeout(() => {
      setRefreshing(false);
      setPull(0);
    }, Math.max(0, MIN_SPINNER_MS - elapsed));
    return () => clearTimeout(t);
  }, [refreshing, isPending]);

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
        setPull(TRIGGER);
        refreshData(true);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pull]);

  // Resume-refresh: silent in-place refresh after >60s hidden — the only cue
  // is the freshness label updating, which is the professional behavior.
  // After a very long absence, one hard reload to pick up new bundles.
  useEffect(() => {
    let hiddenAt: number | null = null;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }
      const hiddenFor = hiddenAt !== null ? Date.now() - hiddenAt : 0;
      hiddenAt = null;
      if (hiddenFor > STALE_BUNDLE_RELOAD_MS) {
        window.location.reload();
      } else if (hiddenFor > RESUME_REFRESH_MS) {
        refreshData(false);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Gentle poll: numbers move on their own while the app sits open during
  // market hours.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (!marketCouldBeLive()) return;
      refreshData(false);
    }, POLL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      <div className="w-10 h-10 rounded-full bg-card-95 border border-hairline flex items-center justify-center shadow-2xl backdrop-blur-md">
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
