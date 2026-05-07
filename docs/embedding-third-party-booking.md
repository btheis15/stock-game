# Embedding a third-party booking SaaS natively in your app

> A field-tested playbook for taking a booking widget from a SaaS like
> **foreUP** (golf), Mindbody (fitness), Calendly, OpenTable, etc. and
> rendering it inside your own app's UI — without losing booking
> functionality. Written from doing exactly this for the Stock Game app's
> Tee Times tab (Inshalla CC). The same recipe applies, mostly unchanged,
> to any "single-page booking app" SaaS.

---

## 1. The problem

You want a tab inside your own app that shows "what's available on this
SaaS right now," styled to match your app, with a one-tap hand-off to
the SaaS for the actual booking. The naive answer is to drop the SaaS's
booking page in an `<iframe>`. **It will probably look broken** — white
screen, partial render, broken styles, broken touch targets, or the
SaaS forces a separate "select category" step before showing anything
useful.

Common failure modes:

| Symptom | Likely cause |
|---|---|
| iframe shows blank white | SaaS detects it's framed and refuses to render (no error, just blank) |
| iframe shows but flashes "refused to display" | SaaS sets `X-Frame-Options: DENY` or `SAMEORIGIN` |
| iframe loads but page says "this site can't be embedded" | SaaS has a CSP `frame-ancestors` restriction |
| iframe loads but you have to click "Continue" / "Daily Golf" / "Adult Class" / etc. before seeing inventory | The SaaS SPA defaults to a chooser screen when called without a specific category param |
| iframe works but cookies don't persist between page loads | Third-party cookie blocking (Safari ITP) |

Don't fight any of these. **Replace the iframe with a native list backed
by the SaaS's own JSON API.** The SaaS's JS bundle already calls that
API; you can call it too.

---

## 2. The pattern (high level)

```
┌───────────────────────────────────────────────────────────────┐
│  Your app (Next.js, mobile-first)                              │
│                                                                 │
│  /your-tab                                                      │
│   └── client component                                          │
│         fetch("/api/your-tab?date=…")                           │
│         render native list (your style, your UX)                │
│         tap row → window.open("https://saas.example.com/…")     │
│                                                                 │
│  /api/your-tab/route.ts   (edge function, runtime, NOT static) │
│   └── fetch("https://saas.example.com/api/inventory?…")         │
│         forward JSON unchanged                                  │
│         Cache-Control: public, max-age=60, s-maxage=60,         │
│                        stale-while-revalidate=120              │
│                                                                 │
└───────────────────────────────────────────────────────────────┘
```

Three moving parts:

1. **The proxy route** (server-side). Hits the SaaS's JSON API,
   forwards the response. Mandatory because the SaaS won't set
   `Access-Control-Allow-Origin` for your origin, so a browser fetch
   from your domain will fail. The proxy lives in your app and runs
   server-side, so CORS doesn't apply.

2. **The native list component** (client-side). Calls your proxy.
   Renders a list in your app's style. Reuses your existing design
   system — no iframe styling fights.

3. **The deep-link hand-off**. When the user actually wants to book,
   open the SaaS's full booking page in a new tab — but with URL params
   that pre-select category, date, etc., so they land on the right
   screen, not the SaaS's "pick a category" entry page.

---

## 3. Finding the SaaS's API

This is the only research step. Spend 20 minutes on it; once it's
documented you'll never have to do it again for that SaaS.

### 3.1. Open the booking page in a real browser

Open the SaaS's public booking URL with **DevTools → Network → XHR/Fetch**
filter visible. Reload. Look at the JSON requests fired during page
load. There's almost always one obvious "fetch the inventory" request:

- foreUP: `GET /index.php/api/booking/times?schedule_id=…&course_id=…&date=MM-DD-YYYY&time=all&holes=all&players=0`
- Calendly (older flow): `GET /api/booking_page_availabilities?…`
- OpenTable: `GET /restref/api/availability?…`
- Resy: `GET /4/find?venue_id=…&day=YYYY-MM-DD`

Note the URL, query params, headers, and response shape.

### 3.2. Verify with curl

Always confirm the API works without browser cookies. If it does, you
can call it from anywhere:

```bash
curl -s "https://saas.example.com/api/inventory?date=2026-05-08&id=42" \
  -H "Accept: application/json" \
  -H "X-Requested-With: XMLHttpRequest" \
  -H "Referer: https://saas.example.com/booking/42" \
  -A "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1" \
  -o /tmp/saas.json
jq 'length' /tmp/saas.json    # how many entries
jq '.[0]' /tmp/saas.json      # first record's shape
```

If you get a useful JSON blob back: green light. If you get
`401 Invalid API Key` or similar, the endpoint requires a session
cookie (you'll need a more careful proxy — see §7 advanced).

### 3.3. Find the bundled JS for additional context

The SaaS's frontend bundle has the answer to almost any question about
how it talks to its own API. Download it once and grep:

```bash
curl -s "https://saas.example.com/js/dist/booking.min.js?v=$VERSION" -o /tmp/saas.js

# How does the SPA route to a specific filter?
grep -oE "urlParams\.get\([\"'][^\"']+[\"']\)" /tmp/saas.js | sort -u

# Find what query params the SPA accepts on URL load
python3 -c "
import re
js = open('/tmp/saas.js').read()
for m in re.finditer(r\"urlParams\.get\\(['\\\"]([^'\\\"]+)['\\\"]\\)\", js):
    print(m.group(1))
" | sort -u
```

This is the **single most valuable trick**: the SaaS's bundle tells you
exactly what URL params their SPA respects. That's how we found
`booking_class_id` + `schedule_id` for foreUP — it lets us deep-link
past the chooser. Without bundle-grepping you'd have to guess.

### 3.4. Document the constants

Pin down course/venue/calendar IDs, category IDs, and the date format
the API expects (ISO `YYYY-MM-DD` vs. `MM-DD-YYYY` vs. epoch). Put them
in named constants at the top of your code:

```ts
// foreUP — Inshalla CC
const COURSE_ID = 19715;
const SCHEDULE_ID = 2251;
const DAILY_GOLF_BOOKING_CLASS_ID = 2431;
```

These are the things that change per-tenant; keep them obvious for the
next engineer.

---

## 4. The proxy route (Next.js)

Write a single Route Handler that forwards GET requests with the date
param, no transformation. Cache aggressively — inventory doesn't move
second-by-second, so a 60-second edge cache is invisible to users and
saves you hammering the upstream.

```ts
// app/api/your-tab/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic"; // run per request, not at build
export const runtime = "edge";

const SAAS_BASE = "https://saas.example.com/api/inventory";
const VENUE_ID = 42;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const dateIso = url.searchParams.get("date");
  if (!dateIso || !/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) {
    return NextResponse.json({ error: "date param required" }, { status: 400 });
  }

  const upstream = new URL(SAAS_BASE);
  upstream.searchParams.set("venue_id", String(VENUE_ID));
  upstream.searchParams.set("date", convertDateFormatIfNeeded(dateIso));

  try {
    const resp = await fetch(upstream.toString(), {
      headers: {
        Accept: "application/json",
        "X-Requested-With": "XMLHttpRequest",
        Referer: `https://saas.example.com/booking/${VENUE_ID}`,
        "User-Agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
      },
      next: { revalidate: 60 },
    });
    if (!resp.ok) {
      return NextResponse.json(
        { error: `upstream ${resp.status}` },
        { status: 502 }
      );
    }
    return NextResponse.json(await resp.json(), {
      headers: {
        "Cache-Control":
          "public, max-age=30, s-maxage=60, stale-while-revalidate=120",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: "fetch failed", detail: String(err) },
      { status: 502 }
    );
  }
}
```

Important nuances:

- **`runtime: "edge"`**: starts in <100ms, no cold start tax. Edge
  functions don't have full Node access, but `fetch` is all you need.
- **`dynamic: "force-dynamic"`**: the route runs per request. If you
  forget this and your page declarations default to static export, the
  build will try to prerender the API route and fail.
- **Cache-Control with `s-maxage` and `stale-while-revalidate`**:
  Vercel's edge respects these. With `s-maxage=60`, popular dates pay
  one upstream call per minute regardless of viewer count. SWR=120
  means even after expiry, the next viewer gets the stale response
  immediately while a background revalidation runs.
- **Pretend to be a phone**: a sane User-Agent + the `X-Requested-With`
  header avoids most "obvious bot" filters and gets the same response
  the SaaS's own SPA would.
- **Send a `Referer`**: some SaaS APIs are wide open without it but
  return slightly different shapes (or 401) if it's missing. Set it to
  the SaaS's own booking page; it's a free credibility signal.
- **Don't transform**: just forward the JSON. Type the few fields you
  care about on the client; ignore the rest. Additive upstream changes
  don't break you.

---

## 5. The native list (React)

Mirror the SaaS's data model with a thin TypeScript interface that only
includes the fields you display. For the Tee Times tab, that's:

```ts
interface TeeTime {
  time: string;                // "2026-05-08 08:00"
  available_spots: number;
  allowed_group_sizes: string[];
  holes: string;               // "9/18"
  green_fee: number;
  green_fee_18?: number;
  cart_fee: number;
  has_special?: boolean;
}
```

Don't try to type the entire response. Anything you don't read gets
ignored, and the SaaS adding new fields next month is a non-event.

The component:

```tsx
"use client";
import { useEffect, useState } from "react";

export function YourTabView() {
  const [selectedIso, setSelectedIso] = useState(todayIsoLocal());
  const [items, setItems] = useState<Item[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/your-tab?date=${selectedIso}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => !cancelled && (setItems(Array.isArray(data) ? data : []), setLoading(false)))
      .catch((e) => !cancelled && (setError(String(e.message ?? e)), setLoading(false)));
    return () => { cancelled = true; };
  }, [selectedIso]);

  // ... render header, day picker, list, error state, fallback link
}
```

Patterns worth keeping:

- **`cancelled` flag** in the effect cleanup. Without it, fast date
  changes can race and show the wrong day's data.
- **Three render states**: loading, error, empty. Don't merge them — an
  empty array is genuinely different from "couldn't load" and the
  user-facing copy should be different.
- **Always show the SaaS hand-off link**, even on error. It's the
  bailout when your proxy or the SaaS misbehaves.

---

## 6. The deep-link hand-off

Your app shows the inventory; the SaaS owns the booking transaction
(auth, captcha, payment, terms-of-service). When the user taps a row,
open the SaaS's booking page in a new tab — but pre-select the
category and date so they land on the time list, not the chooser.

The deep-link contract is whatever you found in §3.3. For foreUP it's:

```ts
function buildSaasUrl({ dateMdY }: { dateMdY?: string } = {}) {
  const params = new URLSearchParams({
    booking_class_id: String(DAILY_GOLF_BOOKING_CLASS_ID),
    schedule_id: String(SCHEDULE_ID),
  });
  if (dateMdY) params.set("date", dateMdY);
  return `${FOREUP_BASE}?${params.toString()}#/teetimes`;
}
```

Each row's link uses this:

```tsx
<a
  href={buildSaasUrl({ dateMdY: isoToForeUpDate(t.time.slice(0, 10)) })}
  target="_blank"
  rel="noopener noreferrer"
>
  {/* row content */}
</a>
```

`target="_blank" rel="noopener noreferrer"` is non-negotiable: it
prevents the SaaS page from `window.opener`-attacking your app and
isolates session state.

**Don't try to reproduce auth or payment.** The SaaS owns the user's
account with them, the merchant ID, the captcha, the PCI scope. Your
app shows the schedule beautifully and points users at the SaaS for
the transaction. That's the right division of responsibility.

---

## 7. Date-picker UX (specifically what we shipped)

For a recurring booking flow ("which day do I want?"), the right UX is
NOT a free-form calendar by default. Most users pick today or tomorrow.

The pattern that works:

```
[Today] [Tomorrow] [Sat]                  [📅]
                THURSDAY
              Thu, May 7
```

- Three pill chips for today, tomorrow, day-after — covers ~80% of taps
- Calendar icon button on the right opens a native date picker (HTML5
  `<input type="date">` with `showPicker()`). On iOS Safari this opens
  the wheel picker users already know.
- Below the chips: the full selected date in big text.
- Active state: the chip (or the calendar icon, when a non-chip date is
  selected) flips to a solid white background with black text.

`showPicker()` is the modern, standardized way to programmatically open
the native picker. iOS Safari 16+ supports it; fall back to `focus()` +
`click()` for older browsers.

```tsx
const dateInputRef = useRef<HTMLInputElement>(null);
const openCalendar = () => {
  const el = dateInputRef.current;
  if (!el) return;
  if (typeof el.showPicker === "function") {
    try { el.showPicker(); return; } catch {}
  }
  el.focus();
  el.click();
};

<button onClick={openCalendar} aria-label="Pick a date">
  <CalendarIcon />
</button>
<input
  ref={dateInputRef}
  type="date"
  min={today}
  max={addDaysIso(today, 90)}
  value={selectedIso}
  onChange={(e) => e.target.value && setSelectedIso(e.target.value)}
  className="absolute inset-0 opacity-0 pointer-events-none"
  tabIndex={-1}
  aria-hidden="true"
/>
```

Position the hidden input absolutely over the icon button so the iOS
fallback (`focus() + click()`) still hits it on touch.

---

## 8. Local-time date math (the gotcha that always bites)

Booking SaaS pages use **local clock time at the venue** — not UTC, not
the user's timezone (well, sometimes the user's, but never assume).

JavaScript date math is a minefield here. Two rules to follow:

1. **Never `new Date("2026-05-08")` for a date string.** That parses as
   UTC midnight. In any negative-UTC timezone (US east coast, west
   coast, etc.) the resulting Date is "May 7, 8 PM", and the wrong day
   shows up in formatters.

2. **Build dates explicitly in local time:**

```ts
function parseLocalIso(iso: string): Date {
  const [y, m, d] = iso.split("-").map((s) => parseInt(s, 10));
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
```

Use these everywhere a date string is converted to/from a `Date`.

Also: check the SaaS's date format. foreUP wants `MM-DD-YYYY` in URL
params, but its API responses use ISO `YYYY-MM-DD`. Mixed. Have small
helpers for each direction (`toForeUpDate`, `isoToForeUpDate`) so the
conversions are isolated.

---

## 9. Independence from your app's other refresh cycles

A nice property of this architecture: **the proxy route is dynamic, so
inventory freshness is decoupled from your app's other refresh cycles.**

For Stock Game specifically: the app has a Mac-mini cron that pushes
new `prices.json` data every 15 minutes during market hours, which
triggers a Vercel rebuild. The Tee Times tab does NOT depend on that
cron at all — `/api/tee-times` runs at request time and hits foreUP
fresh. So:

- Cron paused (e.g., user manually paused the schedule) → tee times
  still update live ✓
- Market closed overnight or weekends → tee times still update live ✓
- Build hasn't run for hours → tee times still update live ✓

Only thing that breaks tee-time freshness is the SaaS itself going
down or changing its API. **Document this!** Future you (or future
team) will ask the question. Save them the head-scratching.

---

## 10. Adapting this to a different SaaS

The recipe is identical; only three things change:

| Step | What you replace |
|---|---|
| §3 | Find the SaaS's inventory API (Network tab + bundle grep) |
| §3.4 | Change the venue/calendar/category IDs at the top of your code |
| §6 | Find the SaaS's URL params for deep-linking past chooser screens |

Everything else — proxy structure, edge caching, native list rendering,
chip + calendar date picker, local-time helpers, hand-off pattern — is
SaaS-agnostic.

### 10.1. Common SaaS patterns

| SaaS | Inventory endpoint shape | Deep-link param to know |
|---|---|---|
| foreUP | `/api/booking/times?schedule_id=…&course_id=…&date=MM-DD-YYYY` | `booking_class_id` + `schedule_id` |
| Calendly | `/api/booking_page_availabilities?event_type_uuid=…&date=…` | `back_to=` and event type slug in path |
| OpenTable | `/restref/api/availability?rid=…&date=…&party_size=…` | `rid` + `dateTime` in URL |
| Resy | `/4/find?venue_id=…&day=YYYY-MM-DD&party_size=…` | `seats=` + `date=` in path |
| Mindbody | `/api/v6/class/classes?StudioIds=…&StartDateTime=…` | `mbo_calendar` widget IDs |
| Toast | `/restaurants/…/online-ordering/menu` | varies by venue config |
| Square Appointments | `/appointments/buyer/widget/…` | service-variation IDs in path |

When the SaaS changes their bundle, you re-run §3.3 (`grep urlParams`
on the new bundle) and update your deep-link constants. No need to
touch the rest of the architecture.

### 10.2. When this pattern won't work

- **The SaaS's API requires a CSRF token or a logged-in session
  cookie.** Most public booking widgets don't, but some do. If your
  curl test in §3.2 returns 401, you'll need to either (a) make the
  proxy maintain a session via cookies (more code, brittle) or (b)
  fall back to the iframe approach and accept the broken styling.
- **The SaaS's site has a CAPTCHA on every page load.** Same fix —
  iframe and accept the UX cost, or pay the SaaS for an embed widget
  if they offer one.
- **Inventory needs real-time updates.** Our 60-second cache is fine
  for tee times but wrong for, say, a stock-trading order book. Drop
  the cache and add WebSocket / Server-Sent Events instead — but at
  that point you're building the SaaS, not embedding it.

---

## 11. Files to copy when you do this for the next project

The reusable code lives in two files. To duplicate for a new project,
copy + adapt:

```
app/api/<your-tab>/route.ts        ← edge proxy (~50 LOC, see §4)
components/<YourTabView>.tsx        ← native list (~250 LOC, see §5–8)
```

Update the constants at the top of each file (course/venue/category
IDs, base URL, ISO ↔ SaaS date format helpers) and you're done. The
proxy route is essentially a one-line config change; the view component
is mostly UI that adapts to the new domain.

For a richer adapter — e.g., a unified abstraction across multiple
booking SaaS — you'd extract `fetchInventory(date)` and `buildBookingUrl()`
into a per-SaaS module. Worth doing once you're integrating two or more
SaaS flows in the same app; not worth doing for the first one.

---

## 12. Specific to Stock Game's Tee Times tab

| | |
|---|---|
| Course | Inshalla Country Club, Tomahawk WI |
| `COURSE_ID` | `19715` |
| `SCHEDULE_ID` | `2251` |
| `DAILY_GOLF_BOOKING_CLASS_ID` | `2431` (the public class; the other is `49668` Members) |
| SaaS base | `https://stage.foreupsoftware.com/` (note `stage.`) |
| Inventory endpoint | `GET /index.php/api/booking/times?schedule_id=2251&course_id=19715&date=MM-DD-YYYY&time=all&holes=all&players=0` |
| Proxy route | `app/api/tee-times/route.ts` |
| View component | `components/TeeTimesView.tsx` |
| Tab definition | `components/TabBar.tsx` (golf-ball-on-tee SVG icon) |
| Page route | `app/tee-times/page.tsx` |
| Footer hidden? | Yes, see `components/Footer.tsx` (`pathname.startsWith("/tee-times")`) |

If foreUP's API changes, re-run §3.3:

```bash
curl -s "https://stage.foreupsoftware.com/index.php/booking/19715/2251" \
  | grep -oE 'src="[^"]*online[_-]booking[^"]*\.js[^"]*"' | head
# download the bundle
curl -s "https://stage.foreupsoftware.com/js/dist/online-booking.min.js?v=…" -o /tmp/foreup.js
# rediscover URL params
python3 -c "
import re
js = open('/tmp/foreup.js').read()
for m in re.finditer(r\"urlParams\.get\\(['\\\"]([^'\\\"]+)['\\\"]\\)\", js):
    print(m.group(1))
" | sort -u
```

If new params appear (e.g. `min_players`, `course_filter`), wire them
through `buildForeUpUrl()` in `TeeTimesView.tsx`.

---

## 13. The mindset

The thing that makes this approach work is treating the SaaS as a JSON
data provider, not a UI you embed. Once you make that mental flip, all
the broken-iframe puzzles disappear: there's no styling fight, no
auto-resize hack, no chooser-screen workaround that depends on a CSS
selector that'll break next deploy. You read their data, you render
your own UI, and you hand off to them only when the user explicitly
asks to transact.

Doing this well takes about 4–6 hours from scratch (most of it in §3,
finding the API and the deep-link contract). Doing it for the second
SaaS takes ~1 hour. The pattern is durable; SaaS UI redesigns rarely
break the inventory API, and never break the architecture.
