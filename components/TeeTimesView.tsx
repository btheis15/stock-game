"use client";

import { useEffect, useMemo, useState } from "react";

const COURSE_ID = 19715;
const SCHEDULE_ID = 2251;
// "Daily Golf" booking class on schedule 2251. The schedule has two classes
// (Daily Golf + Members); without specifying one, foreUP shows a chooser
// before the time list. We pre-select Daily Golf in the deep link.
const DAILY_GOLF_BOOKING_CLASS_ID = 2431;
const FOREUP_BASE = `https://stage.foreupsoftware.com/index.php/booking/${COURSE_ID}/${SCHEDULE_ID}`;

/**
 * Builds a foreUP booking URL that skips the booking-class chooser.
 * Discovered in the SPA bundle:
 *
 *   if (urlParams.get('booking_class_id') && urlParams.get('schedule_id')) {
 *     filters.set('booking_class', urlParams.get('booking_class_id'));
 *     filters.set('schedule_id',   urlParams.get('schedule_id'));
 *     // also reads: date, players, time_of_day, holes
 *   }
 *
 * Date format is MM-DD-YYYY (foreUP's UI convention, not ISO).
 */
function buildForeUpUrl(opts: { dateMdY?: string; players?: number; holes?: "9" | "18" } = {}) {
  const params = new URLSearchParams({
    booking_class_id: String(DAILY_GOLF_BOOKING_CLASS_ID),
    schedule_id: String(SCHEDULE_ID),
  });
  if (opts.dateMdY) params.set("date", opts.dateMdY);
  if (opts.players) params.set("players", String(opts.players));
  if (opts.holes) params.set("holes", opts.holes);
  return `${FOREUP_BASE}?${params.toString()}#/teetimes`;
}

interface TeeTime {
  time: string; // "2026-05-08 08:00"
  available_spots: number;
  allowed_group_sizes: string[];
  holes: string; // "9/18" | "9" | "18"
  green_fee: number;
  green_fee_9?: number;
  green_fee_18?: number;
  cart_fee: number;
  has_special?: boolean;
  pay_online?: string;
  teesheet_side_name?: string;
}

/**
 * Native tee-times list for Inshalla Country Club. Pulls from foreUP's
 * /api/booking/times endpoint via our own /api/tee-times proxy (foreUP doesn't
 * set CORS headers, so the iframe + direct browser fetch both fail; the
 * proxy is the durable fix).
 *
 * Tap a row to hand off to foreUP's full booking page in a new tab. We
 * don't reproduce the booking flow itself (auth, payment, captcha) — that's
 * intentional. The schedule visibility lives in-app; the actual booking
 * happens on foreUP.
 */
export function TeeTimesView() {
  const [dayOffset, setDayOffset] = useState(0);
  const [times, setTimes] = useState<TeeTime[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const date = useMemo(() => addDays(new Date(), dayOffset), [dayOffset]);
  const dateIso = toIsoDate(date);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/tee-times?date=${dateIso}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (cancelled) return;
        setTimes(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(String(e.message ?? e));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dateIso]);

  return (
    <div className="pb-24">
      <div className="px-4 pt-3 pb-2">
        <div className="flex items-baseline justify-between">
          <div>
            <div className="text-[11px] font-bold tracking-[0.12em] uppercase text-zinc-500">
              Tee Times
            </div>
            <h1 className="text-[18px] leading-tight font-semibold text-white">
              Inshalla CC · Tomahawk, WI
            </h1>
          </div>
          <a
            href={buildForeUpUrl({ dateMdY: toForeUpDate(date) })}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] font-semibold text-zinc-400 active:text-white"
          >
            Book on foreUP ↗
          </a>
        </div>
      </div>

      <DayPicker dayOffset={dayOffset} setDayOffset={setDayOffset} date={date} />

      <div className="px-4 mt-3">
        {loading ? (
          <div className="rounded-2xl bg-zinc-900/70 border border-zinc-800 p-6 text-center text-[12px] text-zinc-500">
            Loading times…
          </div>
        ) : error ? (
          <div className="rounded-2xl bg-zinc-900/70 border border-zinc-800 p-4">
            <div className="text-[13px] font-semibold text-white mb-1">
              Couldn't load tee times
            </div>
            <div className="text-[11px] text-zinc-500 mb-3">{error}</div>
            <a
              href={buildForeUpUrl({ dateMdY: toForeUpDate(date) })}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block text-[12px] font-semibold text-white bg-zinc-800 active:bg-zinc-700 px-3 py-1.5 rounded-md"
            >
              Open foreUP in browser
            </a>
          </div>
        ) : times == null || times.length === 0 ? (
          <div className="rounded-2xl bg-zinc-900/70 border border-zinc-800 p-6 text-center text-[12px] text-zinc-500">
            No available tee times on {fmtFullDate(date)}.
          </div>
        ) : (
          <div className="rounded-2xl bg-zinc-900/70 border border-zinc-800 divide-y divide-zinc-800 overflow-hidden">
            {times.map((t) => (
              <TeeTimeRow key={`${t.time}-${t.teesheet_side_name ?? ""}`} t={t} />
            ))}
          </div>
        )}
      </div>

      <div className="px-4 mt-4 text-[11px] text-zinc-600 leading-relaxed">
        Times sourced live from foreUP. Tap any time to complete the booking on
        foreUP — payments and accounts live there.
      </div>
    </div>
  );
}

function TeeTimeRow({ t }: { t: TeeTime }) {
  const tod = parseTeeTime(t.time); // local-time-of-day display
  const groupRange = formatGroupSizes(t.allowed_group_sizes);
  // foreUP doesn't expose a per-time deep link, but it does honor
  // booking_class_id + schedule_id + date in the query string (parsed by the
  // SPA on mount), so the row deep-links straight into Daily Golf for that
  // date and the user lands on the time list with their time near the top.
  const href = buildForeUpUrl({ dateMdY: isoToForeUpDate(t.time.slice(0, 10)) });

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-3 px-4 py-3 active:bg-zinc-800/60 transition-colors"
    >
      <div className="w-16 shrink-0">
        <div className="text-[15px] font-semibold text-white tabular-nums">
          {tod.hour}
          <span className="text-zinc-500">:{tod.min}</span>
        </div>
        <div className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider">
          {tod.ampm}
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[12px] font-semibold text-white">
          {t.available_spots} open
          {t.has_special && (
            <span className="ml-1.5 text-[9px] font-bold uppercase tracking-wider text-[#00C805] align-middle">
              Special
            </span>
          )}
        </div>
        <div className="text-[11px] text-zinc-500 truncate">
          {groupRange} · {t.holes} holes
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className="text-[14px] font-semibold text-white tabular-nums">
          ${t.green_fee_18 ?? t.green_fee}
        </div>
        <div className="text-[10px] text-zinc-500 tabular-nums">
          + ${t.cart_fee} cart
        </div>
      </div>
    </a>
  );
}

function DayPicker({
  dayOffset,
  setDayOffset,
  date,
}: {
  dayOffset: number;
  setDayOffset: (n: number) => void;
  date: Date;
}) {
  return (
    <div className="px-4 mt-2 flex items-center justify-between gap-2">
      <button
        onClick={() => setDayOffset(dayOffset - 1)}
        disabled={dayOffset <= 0}
        className="text-[20px] leading-none text-zinc-400 disabled:text-zinc-700 px-2 py-1"
        aria-label="Previous day"
      >
        ‹
      </button>
      <div className="flex-1 text-center">
        <div className="text-[10px] font-bold tracking-[0.12em] uppercase text-zinc-500">
          {dayOffset === 0 ? "Today" : dayOffset === 1 ? "Tomorrow" : fmtDow(date)}
        </div>
        <div className="text-[15px] font-semibold text-white">
          {fmtFullDate(date)}
        </div>
      </div>
      <button
        onClick={() => setDayOffset(dayOffset + 1)}
        disabled={dayOffset >= 14}
        className="text-[20px] leading-none text-zinc-400 disabled:text-zinc-700 px-2 py-1"
        aria-label="Next day"
      >
        ›
      </button>
    </div>
  );
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

function toIsoDate(d: Date): string {
  // YYYY-MM-DD in the user's local timezone (booking is local-time, not UTC).
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function toForeUpDate(d: Date): string {
  // foreUP's URL date is MM-DD-YYYY.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${m}-${day}-${y}`;
}

function isoToForeUpDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${m}-${d}-${y}`;
}

function parseTeeTime(s: string): { hour: string; min: string; ampm: string } {
  // s = "2026-05-08 08:00"
  const [, hm] = s.split(" ");
  const [hRaw, m] = (hm ?? "00:00").split(":");
  const hNum = parseInt(hRaw, 10);
  const ampm = hNum >= 12 ? "PM" : "AM";
  const h12 = hNum % 12 === 0 ? 12 : hNum % 12;
  return { hour: String(h12), min: m ?? "00", ampm };
}

function formatGroupSizes(sizes: string[]): string {
  if (!sizes || sizes.length === 0) return "any group";
  const nums = sizes.map((s) => parseInt(s, 10)).filter((n) => !isNaN(n));
  if (nums.length === 0) return "any group";
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  if (min === max) return `${min} player${min === 1 ? "" : "s"}`;
  return `${min}–${max} players`;
}

function fmtFullDate(d: Date): string {
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function fmtDow(d: Date): string {
  return d.toLocaleDateString("en-US", { weekday: "long" });
}
