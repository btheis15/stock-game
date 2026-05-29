// Per-player investment theses — server-side loader for the "Why these
// picks" section (components/PortfolioThesis.tsx) and its open editor.
//
// Source of truth is config/thesis.json, keyed by user id. Like funds.json,
// it's read GitHub-first with a short in-process cache so a freshly-saved
// thesis shows up without waiting for a Vercel redeploy (a static JSON
// `import` would be frozen at build time — see the funds.ts note). The
// filesystem copy is the fallback for local dev and any env without a
// GITHUB_TOKEN.
//
// This module imports node:fs and so is SERVER-ONLY. The types, field caps,
// and validation live in lib/thesis-types.ts (client-safe) and are re-exported
// here for server callers that want a single import.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getGithubFile } from "./github-commit";
import type { UserId } from "./picks";
import { THESIS_PATH, type Thesis, type ThesisFile } from "./thesis-types";

export * from "./thesis-types";

const THESIS_CACHE_TTL_MS = 10_000;
let cached: { data: ThesisFile; ts: number } | null = null;

async function fetchFromGithub(): Promise<ThesisFile | null> {
  if (!process.env.GITHUB_TOKEN || !process.env.GITHUB_OWNER || !process.env.GITHUB_REPO) {
    return null;
  }
  try {
    const file = await getGithubFile(THESIS_PATH);
    if (!file) return {};
    return JSON.parse(file.content) as ThesisFile;
  } catch {
    return null;
  }
}

async function fetchFromFilesystem(): Promise<ThesisFile> {
  try {
    const file = resolve(process.cwd(), "config", "thesis.json");
    return JSON.parse(await readFile(file, "utf8")) as ThesisFile;
  } catch {
    return {};
  }
}

export async function loadThesisData(): Promise<ThesisFile> {
  if (cached && Date.now() - cached.ts < THESIS_CACHE_TTL_MS) return cached.data;
  const fromGithub = await fetchFromGithub();
  const data = fromGithub ?? (await fetchFromFilesystem());
  cached = { data, ts: Date.now() };
  return data;
}

/** Reset the in-process cache after a save so this instance serves fresh
 *  content on the next request. Mirrors invalidateFundsCache(). */
export function invalidateThesisCache(): void {
  cached = null;
}

export async function getThesis(userId: UserId): Promise<Thesis | null> {
  const data = await loadThesisData();
  const t = data[userId];
  if (!t || !Array.isArray(t.overview) || typeof t.picks !== "object") return null;
  return t;
}
