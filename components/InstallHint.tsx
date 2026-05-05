"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "stockgame.hideInstallHint";

export function InstallHint() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (localStorage.getItem(STORAGE_KEY) === "1") return;

    const ua = window.navigator.userAgent;
    const isIOS = /iPad|iPhone|iPod/.test(ua) && !("MSStream" in window);
    if (!isIOS) return;

    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      // @ts-expect-error iOS Safari adds a non-standard `standalone` flag
      window.navigator.standalone === true;
    if (standalone) return;

    setShow(true);
  }, []);

  if (!show) return null;

  const dismiss = () => {
    setShow(false);
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {}
  };

  return (
    <div
      className="fixed top-0 left-0 right-0 z-40 bg-zinc-900/95 backdrop-blur-md border-b border-zinc-800"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className="max-w-md mx-auto flex items-center gap-3 px-4 py-2.5">
        <div className="text-[12px] leading-snug flex-1 text-zinc-200">
          <span className="font-semibold text-white">Add to Home Screen</span>{" "}
          for full-screen mode. Tap{" "}
          <ShareIcon />
          {" "}then{" "}
          <span className="text-white">Add to Home Screen</span>.
        </div>
        <button
          onClick={dismiss}
          aria-label="Dismiss"
          className="w-7 h-7 -mr-1 rounded-full flex items-center justify-center text-zinc-400 hover:text-white active:bg-zinc-800"
        >
          <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4">
            <path
              d="M6 6l12 12M18 6L6 18"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="inline w-4 h-4 -mt-0.5 text-white" aria-label="Share">
      <path
        d="M12 4v12M12 4l-3.5 3.5M12 4l3.5 3.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5 12v6a2 2 0 002 2h10a2 2 0 002-2v-6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
