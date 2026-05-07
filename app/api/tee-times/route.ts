import { NextResponse } from "next/server";

/**
 * Proxy for foreUP's tee-times API. We can't call it directly from the
 * browser because foreUP doesn't set Access-Control-Allow-Origin, so this
 * route runs server-side on Vercel and forwards the JSON.
 *
 * foreUP endpoint:
 *   GET https://stage.foreupsoftware.com/index.php/api/booking/times
 *     ?schedule_id={SCHEDULE}&course_id={COURSE}&date=MM-DD-YYYY
 *     &time=all&holes=all&players=0
 *
 * Returns the JSON array of available tee times unchanged.
 */

export const dynamic = "force-dynamic";
export const runtime = "edge";

const COURSE_ID = 19715; // Inshalla Country Club
const SCHEDULE_ID = 2251;
const FOREUP_BASE = "https://stage.foreupsoftware.com/index.php/api/booking/times";

function toForeUpDate(iso: string): string {
  // foreUP wants MM-DD-YYYY, we accept YYYY-MM-DD from the client.
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) throw new Error("invalid date");
  return `${m}-${d}-${y}`;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const dateIso = url.searchParams.get("date");
  if (!dateIso || !/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) {
    return NextResponse.json({ error: "date param required (YYYY-MM-DD)" }, { status: 400 });
  }

  const upstream = new URL(FOREUP_BASE);
  upstream.searchParams.set("schedule_id", String(SCHEDULE_ID));
  upstream.searchParams.set("course_id", String(COURSE_ID));
  upstream.searchParams.set("date", toForeUpDate(dateIso));
  upstream.searchParams.set("time", "all");
  upstream.searchParams.set("holes", "all");
  upstream.searchParams.set("players", "0");

  try {
    const resp = await fetch(upstream.toString(), {
      headers: {
        Accept: "application/json",
        "X-Requested-With": "XMLHttpRequest",
        Referer: `https://stage.foreupsoftware.com/index.php/booking/${COURSE_ID}/${SCHEDULE_ID}`,
        "User-Agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
      },
      // Cache at the edge for 60s — tee-time availability changes as people
      // book, but a one-minute lag is invisible to the user and saves us
      // hammering foreUP.
      next: { revalidate: 60 },
    });

    if (!resp.ok) {
      const text = await resp.text();
      return NextResponse.json(
        { error: `upstream ${resp.status}`, detail: text.slice(0, 500) },
        { status: 502 }
      );
    }

    const data = await resp.json();
    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "public, max-age=30, s-maxage=60, stale-while-revalidate=120",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: "fetch failed", detail: String(err) },
      { status: 502 }
    );
  }
}
