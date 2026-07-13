// Types + client-side loader for the news digest feed.
//
// `public/digests.json` is generated daily by `scripts/digest.swift` (Apple
// Intelligence on the Mac mini) and committed alongside the rest of the
// repo. The web app fetches it once per session via `useDigests()`.

"use client";

import { useEffect, useState } from "react";
import type { Range } from "./types";
import type { UserId } from "./picks";

export type DigestWindow = "1D" | "1W" | "1M" | "3M" | "1Y" | "ALL";

export interface DateRange {
  from: string;
  to: string;
}

export interface SourceArticle {
  title: string;
  link: string;
  source: string;
  date: string;
  score: number;
}

export type DataMaturity = "full" | "partial" | "insufficient";

export interface WindowDigest {
  digest: string | null;
  articleCount: number;
  dateRange: DateRange | null;
  avgRelevanceScore: number | null;
  generatedAt: string;
  aiEngine: string | null;
  dataMaturity: DataMaturity;
  daysOfData: number;
  daysRequired: number;
  sources: SourceArticle[] | null;
  // Game 1D / 1W / 1M digests carry a template with `{{TICKER}}` /
  // `{{user:USERID}}` placeholders. The cron's fast tier substitutes live
  // pcts into this every 15 min so `digest` reflects current standings
  // without an AI call. UI never reads this directly — `digest` is the
  // rendered, display-ready string.
  digestTemplate?: string | null;
}

export interface DigestsJson {
  generatedAt: string;
  aiEngine: string;
  holdings: Record<string, Partial<Record<DigestWindow, WindowDigest>>>;
  // Per-user portfolio rollups (Phase 2). Optional so older snapshots don't
  // break the page; missing → the panel renders nothing on /portfolio/[user].
  portfolios?: Partial<Record<UserId, Partial<Record<DigestWindow, WindowDigest>>>>;
  // Game-wide leaderboard analysis (Phase 3). Per-window analytical digests
  // explaining the live standings — references player names + actual %s. Renders
  // on the home Compare view.
  game?: Partial<Record<DigestWindow, WindowDigest>>;
  // Per-fund short briefings (Phase 4), keyed by fund id. Only 1D + 1W are
  // produced by the digest pipeline; other windows fall back to null. Optional
  // so snapshots predating fund digests don't break /fund/[id].
  funds?: Record<string, Partial<Record<DigestWindow, WindowDigest>>>;
}

// The app's chart-tab Range uses "1YR"; the digest pipeline writes "1Y".
// Map between the two so the panel can look up by active range.
export function rangeToDigestWindow(range: Range): DigestWindow {
  return range === "1YR" ? "1Y" : range;
}

// Module-level cache so a session only fetches the digests once per TTL even
// when the user navigates between stock pages. Fetched from /api/digests
// (which serves the latest commit on origin/main) — NOT the static
// /digests.json, which is frozen per-deploy now that data commits don't
// trigger builds. The TTL refetch keeps a long-lived session's digest
// numbers moving; while a refetch is in flight the previous data keeps
// rendering, so only the first-ever load shows the skeleton.
const DIGESTS_TTL_MS = 5 * 60 * 1000;
const cache: {
  data: DigestsJson | null;
  loaded: boolean;
  fetchedAt: number;
  promise: Promise<DigestsJson | null> | null;
} = {
  data: null,
  loaded: false,
  fetchedAt: 0,
  promise: null,
};

function fetchDigests(): Promise<DigestsJson | null> {
  if (!cache.promise) {
    cache.promise = fetch("/api/digests", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<DigestsJson>) : null))
      .catch(() => null)
      .then((d) => {
        // A failed refetch keeps the previous data (stale beats blank).
        if (d) cache.data = d;
        cache.loaded = true;
        cache.fetchedAt = Date.now();
        cache.promise = null;
        return cache.data;
      });
  }
  return cache.promise;
}

export function useDigests() {
  const [data, setData] = useState<DigestsJson | null>(cache.data);
  const [loading, setLoading] = useState<boolean>(!cache.loaded);

  useEffect(() => {
    const fresh = cache.loaded && Date.now() - cache.fetchedAt < DIGESTS_TTL_MS;
    if (fresh) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    fetchDigests().then((d) => {
      if (cancelled) return;
      setData(d);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Long-lived sessions: refetch when the TTL lapses while the panel stays
  // mounted (poll check) or when the app returns to the foreground stale.
  // The previous data keeps rendering during the refetch — no skeleton.
  useEffect(() => {
    let cancelled = false;
    const refreshIfStale = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - cache.fetchedAt < DIGESTS_TTL_MS) return;
      fetchDigests().then((d) => {
        if (!cancelled && d) setData(d);
      });
    };
    const id = setInterval(refreshIfStale, 60_000);
    document.addEventListener("visibilitychange", refreshIfStale);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", refreshIfStale);
    };
  }, []);

  function getDigest(ticker: string, range: Range): WindowDigest | null {
    const w = rangeToDigestWindow(range);
    return data?.holdings?.[ticker.toUpperCase()]?.[w] ?? null;
  }

  function getPortfolioDigest(userId: UserId, range: Range): WindowDigest | null {
    const w = rangeToDigestWindow(range);
    return data?.portfolios?.[userId]?.[w] ?? null;
  }

  function getGameDigest(range: Range): WindowDigest | null {
    const w = rangeToDigestWindow(range);
    return data?.game?.[w] ?? null;
  }

  function getFundDigest(fundId: string, range: Range): WindowDigest | null {
    const w = rangeToDigestWindow(range);
    return data?.funds?.[fundId]?.[w] ?? null;
  }

  return {
    loading,
    data,
    getDigest,
    getPortfolioDigest,
    getGameDigest,
    getFundDigest,
  };
}
