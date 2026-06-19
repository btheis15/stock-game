// US equity-market (NYSE/Nasdaq) holiday + early-close calendar.
//
// `getMarketSessionState` (lib/portfolio.ts) knows the weekday + clock hours
// but NOT the calendar — so without this it reports "Market open" on a holiday
// like Juneteenth, and keeps reporting "open" through the dead afternoon of an
// early-close half day. This module supplies the missing calendar so the badge
// can say "Markets closed today — Juneteenth" / "Half day — closes 1:00 PM ET"
// instead.
//
// Everything is COMPUTED (not a hardcoded year-by-year table) so it never goes
// stale: the fixed-date holidays apply the NYSE observance rule (a Saturday
// holiday is observed the preceding Friday, a Sunday holiday the following
// Monday), the floating holidays are nth-weekday rules, and Good Friday is
// derived from Easter. All dates are evaluated in America/New_York, matching
// the rest of the pipeline's market-day semantics.

/** Regular session normally ends 4:00 PM ET; on a half day it ends 1:00 PM ET. */
export const EARLY_CLOSE_HOUR_ET = 13;

interface YMD {
  y: number;
  m: number; // 1-12
  d: number;
}

/** Day of week (0=Sun … 6=Sat) for a calendar date, timezone-independent. */
function dowOf(y: number, m: number, d: number): number {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Day-of-month of the nth `weekday` (0=Sun) in `month` (1-12) of `y`. */
function nthWeekdayOfMonth(
  y: number,
  month: number,
  weekday: number,
  n: number
): number {
  const firstDow = dowOf(y, month, 1);
  const firstOccurrence = 1 + ((weekday - firstDow + 7) % 7);
  return firstOccurrence + (n - 1) * 7;
}

/** Day-of-month of the last `weekday` (0=Sun) in `month` (1-12) of `y`. */
function lastWeekdayOfMonth(y: number, month: number, weekday: number): number {
  const lastDay = new Date(Date.UTC(y, month, 0)).getUTCDate();
  const lastDow = dowOf(y, month, lastDay);
  return lastDay - ((lastDow - weekday + 7) % 7);
}

/** Shift a calendar date by `delta` days, normalizing month/year rollover. */
function shiftDate(y: number, m: number, d: number, delta: number): YMD {
  const t = new Date(Date.UTC(y, m - 1, d + delta));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

/** Gregorian Easter Sunday (Anonymous/Meeus algorithm). */
function easterSunday(y: number): YMD {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const mth = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * mth + 114) / 31);
  const day = ((h + l - 7 * mth + 114) % 31) + 1;
  return { y, m: month, d: day };
}

/**
 * Observed date for a fixed-date holiday under the NYSE rule. Saturday →
 * preceding Friday, Sunday → following Monday, weekday → itself. Returns null
 * for the one exception: when New Year's Day falls on a Saturday the market is
 * NOT closed the preceding Friday (no observance at all).
 */
function observedFixedDate(y: number, month: number, day: number): YMD | null {
  const dow = dowOf(y, month, day);
  if (dow === 6) {
    if (month === 1 && day === 1) return null;
    return shiftDate(y, month, day, -1);
  }
  if (dow === 0) return shiftDate(y, month, day, 1);
  return { y, m: month, d: day };
}

function key(o: YMD | null): string | null {
  if (!o) return null;
  return `${String(o.m).padStart(2, "0")}-${String(o.d).padStart(2, "0")}`;
}

/** Full-closure NYSE holidays for `y`, as a map of "MM-DD" → display name. */
function closureMap(y: number): Map<string, string> {
  const map = new Map<string, string>();
  const add = (o: YMD | null, name: string) => {
    const k = key(o);
    if (k) map.set(k, name);
  };
  const easter = easterSunday(y);

  add(observedFixedDate(y, 1, 1), "New Year's Day");
  add({ y, m: 1, d: nthWeekdayOfMonth(y, 1, 1, 3) }, "Martin Luther King Jr. Day");
  add({ y, m: 2, d: nthWeekdayOfMonth(y, 2, 1, 3) }, "Presidents' Day");
  add(shiftDate(easter.y, easter.m, easter.d, -2), "Good Friday");
  add({ y, m: 5, d: lastWeekdayOfMonth(y, 5, 1) }, "Memorial Day");
  if (y >= 2022) add(observedFixedDate(y, 6, 19), "Juneteenth");
  add(observedFixedDate(y, 7, 4), "Independence Day");
  add({ y, m: 9, d: nthWeekdayOfMonth(y, 9, 1, 1) }, "Labor Day");
  add({ y, m: 11, d: nthWeekdayOfMonth(y, 11, 4, 4) }, "Thanksgiving");
  add(observedFixedDate(y, 12, 25), "Christmas Day");
  return map;
}

/**
 * Scheduled 1:00 PM ET early-close ("half") days for `y`, as a map of
 * "MM-DD" → occasion name. The three recurring NYSE early closes:
 *  - the Friday after Thanksgiving,
 *  - Christmas Eve (Dec 24) when it's a weekday and not itself the observed
 *    Christmas holiday,
 *  - July 3 when both it and July 4 are weekdays (when July 4 lands on a
 *    weekend, July 3 is either the full observed holiday or a normal day, so
 *    no half day applies).
 * Edge years can differ slightly from the official notice; this covers the
 * standard pattern.
 */
function earlyCloseMap(y: number): Map<string, string> {
  const map = new Map<string, string>();
  const closures = closureMap(y);

  const thanksgiving = nthWeekdayOfMonth(y, 11, 4, 4);
  const dayAfter = shiftDate(y, 11, thanksgiving, 1);
  map.set(key(dayAfter)!, "the day after Thanksgiving");

  const dec24Dow = dowOf(y, 12, 24);
  if (dec24Dow >= 1 && dec24Dow <= 5 && !closures.has("12-24")) {
    map.set("12-24", "Christmas Eve");
  }

  const july3Dow = dowOf(y, 7, 3);
  const july4Dow = dowOf(y, 7, 4);
  const july3Weekday = july3Dow >= 1 && july3Dow <= 5;
  const july4Weekday = july4Dow >= 1 && july4Dow <= 5;
  if (july3Weekday && july4Weekday && !closures.has("07-03")) {
    map.set("07-03", "the day before Independence Day");
  }

  return map;
}

/** Today's calendar date in America/New_York as { y, m, d }. */
function etDate(now: Date): YMD {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (t: string) =>
    parseInt(parts.find((p) => p.type === t)?.value ?? "0", 10);
  return { y: get("year"), m: get("month"), d: get("day") };
}

/**
 * Name of the NYSE holiday if the current ET date is a full market closure,
 * else null. (Weekends are not holidays — they return null here; the badge
 * already handles the normal weekend "Market closed" state.)
 */
export function marketHolidayName(now: Date = new Date()): string | null {
  const { y, m, d } = etDate(now);
  return closureMap(y).get(`${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`) ?? null;
}

/**
 * Occasion name if the current ET date is a scheduled 1:00 PM ET early close,
 * else null.
 */
export function marketEarlyCloseName(now: Date = new Date()): string | null {
  const { y, m, d } = etDate(now);
  return earlyCloseMap(y).get(`${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`) ?? null;
}
