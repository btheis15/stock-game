"use client";

const BOOKING_URL =
  "https://stage.foreupsoftware.com/index.php/booking/19715/2251#/teetimes";

/**
 * Embeds the foreUP booking widget for Inshalla CC inside the app shell.
 * The iframe is sized to fill the area between the safe-area top and the
 * fixed bottom TabBar (h-16 = 64px + bottom safe-area). foreUP's stage
 * environment doesn't set X-Frame-Options or a CSP frame-ancestors clause,
 * so embedding works.
 */
export function TeeTimesView() {
  return (
    // -mb-20 cancels the layout's pb-20 (which exists to keep regular pages
    // clear of the fixed TabBar). Here we want the iframe flush with the TabBar.
    <div className="-mb-20">
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <div>
          <div className="text-[11px] font-bold tracking-[0.12em] uppercase text-zinc-500">
            Tee Times
          </div>
          <h1 className="text-[18px] leading-tight font-semibold text-white">
            Inshalla CC · Tomahawk, WI
          </h1>
        </div>
        <a
          href={BOOKING_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] font-semibold text-zinc-400 active:text-white"
        >
          Open ↗
        </a>
      </div>
      <iframe
        src={BOOKING_URL}
        title="Inshalla CC tee times"
        className="w-full bg-white border-0 block"
        style={{
          // Height = viewport − this view's header (~58px) − TabBar (64px) − safe areas.
          // Using dvh so iOS Safari URL-bar collapse doesn't leave whitespace at the bottom.
          height: "calc(100dvh - 58px - 64px - env(safe-area-inset-top) - env(safe-area-inset-bottom))",
        }}
        // No sandbox attribute: foreUP needs scripts, forms, popups, and same-origin
        // for the booking flow to function.
      />
    </div>
  );
}
