"use client";

import { useMemo } from "react";

const COURSE_ID = 19715;
const SCHEDULE_ID = 2251;
// "Daily Golf" booking class on schedule 2251. The schedule has two classes
// (Daily Golf + Members); without specifying one, foreUP shows a chooser
// before the time list. We pre-select Daily Golf in the deep link.
const DAILY_GOLF_BOOKING_CLASS_ID = 2431;
const FOREUP_BASE = `https://stage.foreupsoftware.com/index.php/booking/${COURSE_ID}/${SCHEDULE_ID}`;

// Pulled from Inshalla's profile in the foreUP booking page (the same blob
// that drives their own "About" widget). Public info; the course publishes
// it on their website too.
const INSHALLA_PHONE_DISPLAY = "(715) 453-3130";
const INSHALLA_PHONE_TEL = "+17154533130"; // E.164 for tel: links

// Sagacity Golf's "Daily Deals" embed widget for Inshalla. The /widget/ path
// + Access-Control-Allow-Origin: * + no X-Frame-Options + UTM-tagged partner
// referrals from foreUP itself together signal this is an explicit
// embed-on-partner-sites product. Different from the foreUP situation: this
// one is meant to be iframed.
const DAILY_DEALS_EMBED = new URL(
  "https://inshalla.dailydeals.golf/widget/layout/2/times"
);
DAILY_DEALS_EMBED.searchParams.set("utm_source", "stockgame-app");
DAILY_DEALS_EMBED.searchParams.set("utm_medium", "tee-times-tab");
DAILY_DEALS_EMBED.searchParams.set("utm_campaign", "daily-deals");
const DAILY_DEALS_URL = DAILY_DEALS_EMBED.toString();

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
        <div className="text-[11px] font-bold tracking-[0.12em] uppercase text-ink-faint">
          Tee Times
        </div>
        <h1 className="text-[22px] leading-tight font-semibold text-ink">
          Inshalla CC
        </h1>
        <div className="text-[13px] font-medium text-ink-muted mt-0.5">
          Tomahawk, WI
        </div>
      </div>

      <div className="px-4 mt-3">
        <div className="text-[10px] font-bold tracking-[0.12em] uppercase text-ink-faint mb-2">
          Quick book
        </div>
        <div className="rounded-2xl bg-card border border-hairline divide-y divide-hairline overflow-hidden">
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

        <a
          href={`tel:${INSHALLA_PHONE_TEL}`}
          className="mt-2 flex items-center justify-center gap-2 rounded-2xl bg-card border border-hairline text-ink font-semibold text-[14px] py-3 active:bg-raised transition-colors"
        >
          <PhoneIcon />
          <span>Call pro shop</span>
          <span className="text-ink-muted font-medium tabular-nums">
            {INSHALLA_PHONE_DISPLAY}
          </span>
        </a>
      </div>

      <div className="px-4 mt-6">
        <div className="text-[10px] font-bold tracking-[0.12em] uppercase text-ink-faint mb-2">
          Daily Deals
        </div>
        {/*
          Inshalla's Daily Deals widget (Sagacity Golf) is technically an
          embed-friendly widget — see Pattern C in
          docs/embedding-third-party-booking.md. We tried iframing it inline
          and the proportions never looked right (the widget's chrome plus
          our card chrome stacks awkwardly on mobile). Hand-off is cleaner:
          a single tap-through card that opens the widget in a new tab,
          matching the foreUP "Quick book" rows above. Our utm_source still
          attributes the click distinctly in Inshalla's analytics.
        */}
        <a
          href={DAILY_DEALS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center px-4 py-4 rounded-2xl bg-card border border-hairline active:bg-pressed transition-colors"
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[15px] font-semibold text-ink">View Daily Deals</span>
              <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#00C805] text-black">
                Save
              </span>
            </div>
            <div className="text-[11px] text-ink-faint mt-0.5">
              Discounted Inshalla tee times via Sagacity Golf
            </div>
          </div>
          <div className="text-ink-faint text-[18px] leading-none ml-3">↗</div>
        </a>
      </div>

      <div className="px-4">
        <div className="mt-5 text-[11px] text-ink-faint leading-relaxed">
          Tee times, pricing, and booking are managed by Inshalla Country Club
          via foreUP. Tapping a day above opens foreUP's secure booking page
          pre-filtered to that day — your tee time, account, and payment all
          live there. Or tap the call button to book by phone.
        </div>

        <div className="mt-3 text-[11px] text-ink-ghost">
          <a
            href={`${FOREUP_BASE}#/teetimes`}
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-edge-strong active:text-ink-3"
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
      className="flex items-center px-4 py-4 active:bg-pressed transition-colors"
    >
      <div className="flex-1 min-w-0">
        <div className="text-[15px] font-semibold text-ink">{label}</div>
        <div className="text-[11px] text-ink-faint">{fullDate}</div>
      </div>
      <div className="text-ink-faint text-[18px] leading-none ml-3">↗</div>
    </a>
  );
}

function PhoneIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className="w-4 h-4"
      aria-hidden="true"
    >
      <path
        d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A15 15 0 0 1 3 6a2 2 0 0 1 2-2z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
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
