// Serves the latest committed digests.json from origin/main. The client
// (lib/digests.ts) fetches this instead of the static /digests.json because
// static files are frozen per-deploy — and data commits no longer trigger
// deploys. A new same-origin path is required rather than shadowing
// /digests.json: files in public/ win route matching.

import { NextResponse } from "next/server";
import { loadDigestsData } from "@/lib/digests-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const data = await loadDigestsData();
  if (!data) {
    return NextResponse.json(
      { error: "digests unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
