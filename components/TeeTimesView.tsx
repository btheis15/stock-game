"use client";

import { useMemo } from "react";

const COURSE_ID = 19715;
const SCHEDULE_ID = 2251;
// "Daily Golf" booking class on schedule 2251. The schedule has two classes
// (Daily Golf + Members); without specifying one, foreUP shows a chooser
// before the time list. We pre-select Daily Golf in the deep link.
const DAILY_GOLF_BOOKING_CLASS_ID = 2431;
const FOREUP_BASE = `https://stage.foreupsoftware.com/index.php/booking/${COURSE_ID}/${SCHEDULE_ID}`;

/**
 * Builds a foreUP booking URL that skips the booking-class chooser. Discovered
 * in the SPA bundle:
 *
 *   if (urlParams.get('booking_class_id') && urlParams.get('schedule_id')) {
 *     filters.set('booking_class', urlParams.get('booking_class_id'));
 *     filters.set('schedule_id',   urlParams.get('schedule_id'));
 *     // also reads: date, players, time_of_day, holes
 *   }
 *
 * Date format is MM-DD-YYYY (foreUP's UI convention, not ISO).
 */
function buildForeUpUrl(opts: { dateMdY?: string } = {}) {
  const params = new URLSearchParams({
    booking_class_id: String(DAILY_GOLF_BOOKING_CLASS_ID),
    schedule_id: String(SCHEDULE_ID),
  });
  if (opts.dateMdY) params.set("date", opts.dateMdY);
  return `${FOREUP_BASE}?${params.toString()}#/teetimes`;
}

/**
 * Tee Times tab — a clean hand-off to foreUP.
 *
 * We deliberately don't fetch foreUP's API or scrape its HTML. foreUP's terms
 * (§3.2.v) prohibit programmatic crawling/scraping; their robots.txt disallows
 * all automated agents. Instead, we present a minimal in-app landing with
 * quick-pick day chips that each deep-link straight into Daily Golf for that
 * day. Tapping a chip opens foreUP in a new tab pre-filtered to the chosen
 * date — no booking-class chooser, no extra tap. foreUP renders its own
 * (very nice) tee-time list with auth, payment, and captcha intact.
 *
 * If your relationship with the course operator advances and you get written
 * permission to display schedule data in-app, this is the file to change —
 * see docs/embedding-third-party-booking.md §1–§6 for the proxy + native
 * list pattern.
 */
export function TeeTimesView() {
  const today = useMemo(() => new Date(), []);
  const tomorrow = useMemo(() => addDays(today, 1), [today]);
  const dayAfter = useMemo(() => addDays(today, 2), [today]);

  return (
    <div className="pb-24">
      <div className="px-4 pt-3 pb-2">
        <div className="text-[11px] font-bold tracking-[0.12em] uppercase text-zinc-500">
          Tee Times
        </div>
        <h1 className="text-[22px] leading-tight font-semibold text-white">
          Inshalla CC
        </h1>
        <div className="text-[13px] font-medium text-zinc-400 mt-0.5">
          Tomahawk, WI
        </div>
      </div>

      <div className="px-4 mt-3">
        <div className="text-[10px] font-bold tracking-[0.12em] uppercase text-zinc-500 mb-2">
          Quick book
        </div>
        <div className="rounded-2xl bg-zinc-900/70 border border-zinc-800 divide-y divide-zinc-800 overflow-hidden">
          <DayLink date={today} label="Today" />
          <DayLink date={tomorrow} label="Tomorrow" />
          <DayLink date={dayAfter} label={fmtDow(dayAfter)} />
        </div>

        <a
          href={buildForeUpUrl()}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 flex items-center justify-center gap-2 rounded-2xl bg-white text-black font-semibold text-[15px] py-3.5 active:bg-zinc-200 transition-colors"
        >
          View all available times ↗
        </a>

        <div className="mt-5 text-[11px] text-zinc-500 leading-relaxed">
          Tee times, pricing, and booking are managed by Inshalla Country Club
          via foreUP. Tapping a day above opens foreUP's secure booking page
          pre-filtered to that day — your tee time, account, and payment all
          live there.
        </div>

        <div className="mt-3 text-[11px] text-zinc-600">
          <a
            href={`${FOREUP_BASE}#/teetimes`}
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-zinc-700 active:text-zinc-300"
          >
            Inshalla CC on foreUP →
          </a>
        </div>
      </div>
    </div>
  );
}

function DayLink({ date, label }: { date: Date; label: string }) {
  const fullDate = fmtFullDate(date);
  return (
    <a
      href={buildForeUpUrl({ dateMdY: toForeUpDate(date) })}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center px-4 py-4 active:bg-zinc-800/60 transition-colors"
    >
      <div className="flex-1 min-w-0">
        <div className="text-[15px] font-semibold text-white">{label}</div>
        <div className="text-[11px] text-zinc-500">{fullDate}</div>
      </div>
      <div className="text-zinc-500 text-[18px] leading-none ml-3">↗</div>
    </a>
  );
}

// ---- date helpers ----

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

function toForeUpDate(d: Date): string {
  // foreUP's URL date is MM-DD-YYYY in local time.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${m}-${day}-${y}`;
}

function fmtFullDate(d: Date): string {
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fmtDow(d: Date): string {
  return d.toLocaleDateString("en-US", { weekday: "long" });
}
