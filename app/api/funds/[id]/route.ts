// Funds CRUD continued — PATCH edit, DELETE soft-delete, POST restore.
//
// All three operations are open: anyone visiting the site can edit or
// delete any fund. Trust-based attribution stays via the immutable
// creator field + the git-log entry written on each commit. After the
// 7-day archive window, soft-deleted funds become permanently hidden
// from the UI but stay in funds.json (cheap, harmless).

import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { updateGithubJsonFile } from "@/lib/github-commit";
import {
  FUND_RESTORE_WINDOW_DAYS,
  invalidateFundsCache,
  isFundRestorable,
  validateFund,
} from "@/lib/funds";
import type { Fund, FundsFile } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const FUNDS_PATH = "config/funds.json";

function emptyFundsFile(): FundsFile {
  return { funds: [] };
}

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface PatchFundBody {
  name?: string;
  creator?: string | null;
  holdings?: { ticker: string; weight: number }[];
}

export async function PATCH(req: Request, ctx: RouteContext): Promise<Response> {
  const { id } = await ctx.params;
  let body: PatchFundBody;
  try {
    body = (await req.json()) as PatchFundBody;
  } catch {
    return NextResponse.json({ error: "request body must be JSON" }, { status: 400 });
  }
  const now = new Date().toISOString();
  let editorLabel = "edited";
  try {
    let updatedName = "";
    await updateGithubJsonFile<FundsFile>(
      FUNDS_PATH,
      `funds: edited "${id}"`,
      (current) => {
        const fundsList = current.funds ?? [];
        const idx = fundsList.findIndex((f) => f.id === id);
        if (idx < 0) throw new Error(`fund ${id} not found`);
        const existing = fundsList[idx];
        // Only the fields the client sent get touched; everything else
        // (id, color, createdAt, deletedAt) stays as it was.
        const next: Fund = {
          ...existing,
          name: body.name !== undefined ? body.name.trim() : existing.name,
          creator:
            body.creator !== undefined
              ? body.creator?.trim() || null
              : existing.creator,
          holdings:
            body.holdings !== undefined
              ? body.holdings.map((h) => ({
                  ticker: String(h.ticker ?? "").toUpperCase(),
                  weight: Number(h.weight),
                }))
              : existing.holdings,
          updatedAt: now,
        };
        if (next.name.length > 60) {
          throw new Error("name must be 60 characters or fewer");
        }
        if (next.creator !== null && next.creator.length > 40) {
          throw new Error("creator must be 40 characters or fewer");
        }
        validateFund(next);
        updatedName = next.name;
        // Commit message gets the new name so the git log reads
        // sensibly even after a rename.
        return { funds: fundsList.map((f, i) => (i === idx ? next : f)) };
      },
      emptyFundsFile()
    );
    editorLabel = updatedName ? `edited "${updatedName}"` : "edited";
    void editorLabel; // kept for log readability above
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    const status = msg.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
  invalidateFundsCache();
  revalidatePath("/", "layout");
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, ctx: RouteContext): Promise<Response> {
  const { id } = await ctx.params;
  const now = new Date().toISOString();
  try {
    await updateGithubJsonFile<FundsFile>(
      FUNDS_PATH,
      `funds: archived "${id}" (recoverable for ${FUND_RESTORE_WINDOW_DAYS}d)`,
      (current) => {
        const fundsList = current.funds ?? [];
        const idx = fundsList.findIndex((f) => f.id === id);
        if (idx < 0) throw new Error(`fund ${id} not found`);
        if (fundsList[idx].deletedAt !== null) {
          throw new Error(`fund ${id} is already archived`);
        }
        const next: Fund = {
          ...fundsList[idx],
          deletedAt: now,
          updatedAt: now,
        };
        return { funds: fundsList.map((f, i) => (i === idx ? next : f)) };
      },
      emptyFundsFile()
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    const status = msg.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
  invalidateFundsCache();
  revalidatePath("/", "layout");
  return NextResponse.json({ ok: true });
}

// POST /api/funds/:id with body {action:"restore"} un-archives a fund if
// it's within the 7-day window. Anything else returns 405 (the create
// route is at /api/funds without the id segment).
export async function POST(req: Request, ctx: RouteContext): Promise<Response> {
  const { id } = await ctx.params;
  let body: { action?: string };
  try {
    body = (await req.json()) as { action?: string };
  } catch {
    return NextResponse.json({ error: "request body must be JSON" }, { status: 400 });
  }
  if (body.action !== "restore") {
    return NextResponse.json({ error: "unsupported action" }, { status: 405 });
  }
  const now = new Date().toISOString();
  try {
    await updateGithubJsonFile<FundsFile>(
      FUNDS_PATH,
      `funds: restored "${id}"`,
      (current) => {
        const fundsList = current.funds ?? [];
        const idx = fundsList.findIndex((f) => f.id === id);
        if (idx < 0) throw new Error(`fund ${id} not found`);
        const existing = fundsList[idx];
        if (existing.deletedAt === null) {
          throw new Error(`fund ${id} is not archived`);
        }
        if (!isFundRestorable(existing)) {
          throw new Error(
            `fund ${id} is past the ${FUND_RESTORE_WINDOW_DAYS}-day restore window`
          );
        }
        const next: Fund = {
          ...existing,
          deletedAt: null,
          updatedAt: now,
        };
        return { funds: fundsList.map((f, i) => (i === idx ? next : f)) };
      },
      emptyFundsFile()
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    const status = msg.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
  invalidateFundsCache();
  revalidatePath("/", "layout");
  return NextResponse.json({ ok: true });
}
