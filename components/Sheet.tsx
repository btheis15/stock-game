"use client";

// Reusable iOS-style bottom sheet — CSS-only (no JS animation library), so it
// runs on older mobile browsers and matches the motion approach used in the
// other house apps.
//
// This is the standard "card that fills part of the screen" presentation: it
// slides up from the bottom edge with a grab handle and dims the content
// behind it. On desktop (sm+) it centers as a normal modal card. Dismiss by
// tapping the backdrop, the Done button, or Escape — the panel slides back
// down before unmounting (the "closing-state exit" pattern).
//
// Why a primitive: the app had four hand-copied modal shells that popped in
// with zero motion. <Sheet> unifies the slide animation, safe-area handling,
// body-scroll lock, Escape-to-close, and the dialog a11y in one place. Callers
// just toggle `open`.
//
// Rendered through a portal to <body> so it's immune to any CSS transform on
// an ancestor (e.g. the route-transition wrapper) — a transformed ancestor
// would otherwise re-root `position: fixed` and misplace the overlay.
//
// Motion is defined in globals.css (.sheet-backdrop / .sheet-panel + the
// is-closing variants) and honors prefers-reduced-motion via the global guard.

import {
  useEffect,
  useRef,
  useState,
  type AnimationEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export function Sheet({
  open,
  onClose,
  title,
  eyebrow,
  doneLabel = "Done",
  full = false,
  header,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** Sheet heading. Also used as the dialog's accessible name. */
  title?: string;
  /** Small uppercase kicker above the title (e.g. "Filter"). */
  eyebrow?: string;
  /** Label for the top-right dismiss button. */
  doneLabel?: string;
  /** Full-height sheet (forms/wizards). Default is a content-height card. */
  full?: boolean;
  /** Custom header node. Overrides the default eyebrow/title/Done header
   *  (it must include its own dismiss affordance + bottom border). */
  header?: ReactNode;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  // `render` keeps the sheet in the DOM through its slide-down exit; `closing`
  // swaps in the exit animation. We unmount only once that animation ends.
  const [render, setRender] = useState(open);
  const [closing, setClosing] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (open) {
      setRender(true);
      setClosing(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open && render) setClosing(true);
  }, [open, render]);

  // Lock body scroll + Escape-to-close + focus while the sheet is present.
  useEffect(() => {
    if (!render) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    panelRef.current?.focus();
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [render, onClose]);

  // Fires for both the enter and exit animations; only the exit unmounts.
  // Guard on currentTarget so a child's animationend can't trigger it.
  function handleAnimationEnd(e: AnimationEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget) return;
    if (closing) {
      setRender(false);
      setClosing(false);
    }
  }

  if (!mounted || !render) return null;

  return createPortal(
    <div
      // Backdrop. z-[100] clears the global TabBar (z-50), matching the
      // existing modals.
      className={
        "sheet-backdrop fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm" +
        (closing ? " is-closing" : "")
      }
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={
          "sheet-panel relative w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl bg-zinc-950 border border-zinc-800 flex flex-col overflow-hidden outline-none " +
          (full ? "h-[100dvh] sm:h-auto sm:max-h-[90dvh]" : "max-h-[90dvh]") +
          (closing ? " is-closing" : "")
        }
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        onClick={(e) => e.stopPropagation()}
        onAnimationEnd={handleAnimationEnd}
      >
        {/* Grab handle — signals a dismissible sheet on mobile. */}
        <div className="shrink-0">
          <div className="sm:hidden flex justify-center pt-2.5 pb-1">
            <span className="w-9 h-1 rounded-full bg-zinc-700" />
          </div>
          {header}
          {!header && (title || eyebrow) && (
            <header className="flex items-start justify-between px-5 pt-3 pb-4 sm:pt-5 border-b border-zinc-800">
              <div>
                {eyebrow && (
                  <div className="text-[10px] font-bold tracking-[0.16em] uppercase text-zinc-500">
                    {eyebrow}
                  </div>
                )}
                {title && (
                  <h2 className="text-[17px] font-semibold text-white mt-0.5">
                    {title}
                  </h2>
                )}
              </div>
              <button
                type="button"
                className="press -mr-1 text-zinc-500 hover:text-zinc-300 text-[15px] px-2 py-1"
                onClick={onClose}
                aria-label="Close"
              >
                {doneLabel}
              </button>
            </header>
          )}
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-3">
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}
