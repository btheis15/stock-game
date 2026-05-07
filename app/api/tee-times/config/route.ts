import { NextResponse } from "next/server";

/**
 * Returns the live booking-window config for Inshalla CC by scraping the
 * foreUP booking page's inline `SCHEDULES = [...]` JS and reading
 * `days_in_booking_window` and `days_out` fields. The per-booking-class
 * value WINS over the schedule's default — schedule 2251 has 5, but
 * Daily Golf (booking class 2431) overrides to 7, which is what users
 * actually get when booking.
 *
 *   daysInBookingWindow  — total span of bookable days starting at "today"
 *                          (e.g. 7 = today + 6 future days)
 *   daysOut              — minimum days out (0 = book today is allowed)
 *
 * The course operator can change these in foreUP without touching our code,
 * and the change is reflected here within `s-maxage` (1 hour). foreUP
 * doesn't expose these via a clean API, so the SCHEDULES inline blob in the
 * page HTML is the durable source of truth (it's how their own SPA reads
 * it too).
 */

export const dynamic = "force-dynamic";
export const runtime = "edge";

const COURSE_ID = 19715;
const SCHEDULE_ID = 2251;
const DAILY_GOLF_BOOKING_CLASS_ID = 2431;
const FOREUP_PAGE = `https://stage.foreupsoftware.com/index.php/booking/${COURSE_ID}/${SCHEDULE_ID}`;

// Defaults if scraping fails — generous so the calendar is never broken,
// but capped low enough that empty days don't surprise the user.
const FALLBACK_DAYS_IN_BOOKING_WINDOW = 14;
const FALLBACK_DAYS_OUT = 0;

export async function GET() {
  try {
    const resp = await fetch(FOREUP_PAGE, {
      headers: {
        Accept: "text/html",
        "User-Agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
      },
      next: { revalidate: 3600 },
    });

    if (!resp.ok) {
      return NextResponse.json(fallback(), {
        headers: cacheHeaders(),
        status: 200,
      });
    }

    const html = await resp.text();
    const match = html.match(/SCHEDULES\s*=\s*(\[[\s\S]*?\]);/);
    if (!match) {
      return NextResponse.json(fallback(), { headers: cacheHeaders() });
    }

    let schedules: Array<Record<string, unknown>>;
    try {
      schedules = JSON.parse(match[1]);
    } catch {
      return NextResponse.json(fallback(), { headers: cacheHeaders() });
    }

    const targetSchedule = schedules.find(
      (s) => String(s.teesheet_id) === String(SCHEDULE_ID)
    );
    if (!targetSchedule) {
      return NextResponse.json(fallback(), { headers: cacheHeaders() });
    }

    // The per-booking-class value overrides the schedule's. Inshalla's
    // schedule default is 5; Daily Golf's class override is 7 (what users
    // actually see in foreUP's UI). Read from the class first; fall back
    // to the schedule if the class field is missing.
    const bookingClasses = (targetSchedule.booking_classes ?? []) as Array<
      Record<string, unknown>
    >;
    const targetClass = bookingClasses.find(
      (bc) => String(bc.booking_class_id) === String(DAILY_GOLF_BOOKING_CLASS_ID)
    );

    const daysInBookingWindow = parseIntField(
      targetClass?.days_in_booking_window ?? targetSchedule.days_in_booking_window,
      FALLBACK_DAYS_IN_BOOKING_WINDOW
    );
    const daysOut = parseIntField(
      targetClass?.days_out ?? targetSchedule.days_out,
      FALLBACK_DAYS_OUT
    );

    return NextResponse.json(
      {
        daysInBookingWindow,
        daysOut,
        source: targetClass ? "foreUP-bookingClass" : "foreUP-schedule",
      },
      { headers: cacheHeaders() }
    );
  } catch {
    return NextResponse.json(fallback(), { headers: cacheHeaders() });
  }
}

function parseIntField(v: unknown, dflt: number): number {
  if (v == null) return dflt;
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) && n > 0 ? n : dflt;
}

function fallback() {
  return {
    daysInBookingWindow: FALLBACK_DAYS_IN_BOOKING_WINDOW,
    daysOut: FALLBACK_DAYS_OUT,
    source: "fallback",
  };
}

function cacheHeaders() {
  return {
    // Refresh the booking-window value at most once per hour. Course operators
    // change this rarely; an hour of staleness is invisible.
    "Cache-Control":
      "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
  };
}
