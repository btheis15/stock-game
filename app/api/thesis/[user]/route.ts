// Per-player thesis save — PUT /api/thesis/[user].
//
// Mirrors the funds CRUD model exactly: the write goes through
// updateGithubJsonFile(), which commits config/thesis.json straight to
// origin/main via the GitHub Contents API (Vercel functions have an
// ephemeral filesystem, so "save to repo" is the only durable path). After
// the commit we bust the in-process cache + revalidate so the player's page
// shows the new thesis on the next render rather than 10s later.
//
// Editing is open by design — anyone can save any player's thesis, the same
// trust model as funds. The only hard guards are: the user id must be a real
// roster player, the payload must fit the field caps, and picks are filtered
// to that player's own tickers (normalizeThesisInput handles all three).

import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { updateGithubJsonFile } from "@/lib/github-commit";
import {
  THESIS_PATH,
  ThesisValidationError,
  invalidateThesisCache,
  normalizeThesisInput,
  type ThesisFile,
  type ThesisInput,
} from "@/lib/thesis";
import { USERS } from "@/lib/picks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ user: string }> }
): Promise<Response> {
  const { user } = await params;
  if (!USERS[user]) {
    return NextResponse.json({ error: `unknown player "${user}"` }, { status: 404 });
  }

  let body: ThesisInput;
  try {
    body = (await req.json()) as ThesisInput;
  } catch {
    return NextResponse.json({ error: "request body must be JSON" }, { status: 400 });
  }

  let normalized;
  try {
    normalized = normalizeThesisInput(user, body);
  } catch (e) {
    const msg = e instanceof ThesisValidationError ? e.message : "invalid thesis";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const editor = (body as { editor?: string }).editor?.trim();
  const who = editor ? ` by ${editor}` : "";

  try {
    await updateGithubJsonFile<ThesisFile>(
      THESIS_PATH,
      `thesis: updated ${USERS[user].name}'s${who ? who : ""}`,
      (current) => ({ ...current, [user]: normalized }),
      {} as ThesisFile
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  invalidateThesisCache();
  // The player page reads thesis through the server cache; bust every route
  // so the freshly-saved thesis appears immediately.
  revalidatePath("/", "layout");
  return NextResponse.json({ thesis: normalized }, { status: 200 });
}
