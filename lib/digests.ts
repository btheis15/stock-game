// Types + client-side loader for the news digest feed.
//
// `public/digests.json` is generated daily by `scripts/digest.swift` (Apple
// Intelligence on the Mac mini) and committed alongside the rest of the
// repo. The web app fetches it once per session via `useDigests()`.

"use client";

import { useEffect, useState } from "react";
import type { Range } from "./types";

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
}

export interface DigestsJson {
  generatedAt: string;
  aiEngine: string;
  holdings: Record<string, Partial<Record<DigestWindow, WindowDigest>>>;
}

// The app's chart-tab Range uses "1YR"; the digest pipeline writes "1Y".
// Map between the two so the panel can look up by active range.
export function rangeToDigestWindow(range: Range): DigestWindow {
  return range === "1YR" ? "1Y" : range;
}

// Module-level cache so a session only fetches digests.json once even when
// the user navigates between stock pages.
const cache: { data: DigestsJson | null; loaded: boolean; promise: Promise<DigestsJson | null> | null } = {
  data: null,
  loaded: false,
  promise: null,
};

export function useDigests() {
  const [data, setData] = useState<DigestsJson | null>(cache.data);
  const [loading, setLoading] = useState<boolean>(!cache.loaded);

  useEffect(() => {
    if (cache.loaded) {
      setLoading(false);
      return;
    }
    if (!cache.promise) {
      cache.promise = fetch("/digests.json", { cache: "no-store" })
        .then((r) => (r.ok ? (r.json() as Promise<DigestsJson>) : null))
        .catch(() => null)
        .then((d) => {
          cache.data = d;
          cache.loaded = true;
          return d;
        });
    }
    let cancelled = false;
    cache.promise.then((d) => {
      if (cancelled) return;
      setData(d);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function getDigest(ticker: string, range: Range): WindowDigest | null {
    const w = rangeToDigestWindow(range);
    return data?.holdings?.[ticker.toUpperCase()]?.[w] ?? null;
  }

  return { loading, data, getDigest };
}
