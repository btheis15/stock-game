import "server-only";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getGithubFileRaw } from "./github-commit";

// Shared loader for the data snapshots the Mac mini commits to main
// (prices.json / fundamentals.json / digests.json). Same architecture as
// lib/funds.ts: read from the GitHub Contents API at request time when the
// GITHUB_* env vars are configured (production), fall back to the file baked
// into the current deploy otherwise (dev / build / unconfigured). This is
// what decouples data freshness from Vercel deploys — the mini keeps
// committing every 15 min, but the app serves the latest commit without a
// rebuild.
//
// Failure ladder, in order:
//   1. fresh in-process cache (TTL) — protects GitHub rate limits
//   2. GitHub raw fetch of origin/main
//   3. stale cache (stale-on-error: last good copy keeps serving through a
//      GitHub outage; re-tried after the TTL window)
//   4. filesystem snapshot from the deploy
// The loader itself never throws, which is what makes builds data-proof.

interface RemoteJsonOptions<T> {
  /** Repo-relative path, e.g. "public/data/prices.json". */
  repoPath: string;
  ttlMs: number;
  /** Optional post-parse fixup (e.g. fundamentals overrides). */
  transform?: (parsed: T) => T;
}

function githubConfigured(): boolean {
  return Boolean(
    process.env.GITHUB_TOKEN && process.env.GITHUB_OWNER && process.env.GITHUB_REPO
  );
}

export function createRemoteJsonLoader<T>(opts: RemoteJsonOptions<T>) {
  let cached: { data: T; ts: number } | null = null;

  async function fromGithub(): Promise<T | null> {
    if (!githubConfigured()) return null;
    try {
      const raw = await getGithubFileRaw(opts.repoPath);
      if (raw == null) return null;
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async function fromFilesystem(): Promise<T | null> {
    try {
      const raw = await readFile(
        resolve(process.cwd(), ...opts.repoPath.split("/")),
        "utf8"
      );
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  return async function load(): Promise<T | null> {
    if (cached && Date.now() - cached.ts < opts.ttlMs) return cached.data;
    let data: T | null = await fromGithub();
    if (data == null && cached) {
      // Stale-on-error: keep serving the last good copy and don't hammer
      // GitHub again until the next TTL window.
      cached = { data: cached.data, ts: Date.now() };
      return cached.data;
    }
    if (data == null) data = await fromFilesystem();
    if (data == null) return null;
    if (opts.transform) data = opts.transform(data);
    cached = { data, ts: Date.now() };
    return data;
  };
}
