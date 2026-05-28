// Funds CRUD — list (GET) + create (POST). Edit / soft-delete / restore live
// in app/api/funds/[id]/route.ts.
//
// Every mutating call goes through updateGithubJsonFile() which commits
// straight to origin/main via the GitHub Contents API. The commit message
// is the git-log entry the user (and any cloning machine) sees in the
// history. After commit, we invalidate the in-memory cache + revalidatePath
// so the next render reads fresh content.

import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { updateGithubJsonFile } from "@/lib/github-commit";
import {
  generateFundId,
  invalidateFundsCache,
  loadFundsData,
  nextFundColor,
  validateFund,
} from "@/lib/funds";
import type { Fund, FundsFile } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const FUNDS_PATH = "config/funds.json";

function emptyFundsFile(): FundsFile {
  return { funds: [] };
}

export async function GET(): Promise<Response> {
  const data = await loadFundsData();
  return NextResponse.json(data, {
    headers: { "Cache-Control": "no-store" },
  });
}

interface CreateFundBody {
  name?: string;
  creator?: string | null;
  holdings?: { ticker: string; weight: number }[];
}

export async function POST(req: Request): Promise<Response> {
  let body: CreateFundBody;
  try {
    body = (await req.json()) as CreateFundBody;
  } catch {
    return NextResponse.json({ error: "request body must be JSON" }, { status: 400 });
  }
  const name = (body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  if (name.length > 60) {
    return NextResponse.json(
      { error: "name must be 60 characters or fewer" },
      { status: 400 }
    );
  }
  const creator = body.creator?.trim() || null;
  if (creator !== null && creator.length > 40) {
    return NextResponse.json(
      { error: "creator name must be 40 characters or fewer" },
      { status: 400 }
    );
  }
  const holdings = Array.isArray(body.holdings)
    ? body.holdings.map((h) => ({ ticker: String(h.ticker ?? "").toUpperCase(), weight: Number(h.weight) }))
    : [];

  const now = new Date().toISOString();
  // Auto-assigned color rotates through FUND_COLOR_PALETTE based on the
  // current fund count, including archived funds so a recently-deleted
  // fund's color doesn't get reused on a restore-and-create cycle.
  let result: { fund: Fund } | null = null;
  try {
    await updateGithubJsonFile<FundsFile>(
      FUNDS_PATH,
      `funds: created "${name}"${creator ? ` by ${creator}` : ""}`,
      (current) => {
        const fundsList = current.funds ?? [];
        const fund: Fund = {
          id: generateFundId(name),
          name,
          creator,
          color: nextFundColor(fundsList.length),
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
          holdings,
        };
        // Throws on first validation failure with a useful message.
        validateFund(fund);
        result = { fund };
        return { funds: [...fundsList, fund] };
      },
      emptyFundsFile()
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  invalidateFundsCache();
  // The Compare view + every page reading funds.json reads through the
  // server cache; bust both so a freshly-saved fund appears immediately.
  revalidatePath("/", "layout");
  return NextResponse.json({ fund: result!.fund }, { status: 201 });
}
