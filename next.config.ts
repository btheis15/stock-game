import type { NextConfig } from "next";

// iOS home-screen PWAs (webclips) aggressively serve a cached HTML snapshot on
// cold launch — often WITHOUT revalidating, even under `max-age=0,
// must-revalidate`. That's how a shipped CSS/markup fix can fail to reach the
// phone for days: the springboard relaunch paints the stored snapshot, which
// still references the OLD content-hashed CSS bundle. `no-store` removes the
// snapshot entirely, so every open fetches fresh HTML and picks up the newest
// deploy. The JS/CSS in /_next/static/* keep their immutable hash-based
// caching (Next sets that itself), so this only re-fetches the small HTML +
// data JSON, never the bundles — negligible bandwidth, maximum freshness.
const freshDocument = {
  key: "Cache-Control",
  value: "no-cache, no-store, max-age=0, must-revalidate",
};

const nextConfig: NextConfig = {
  async headers() {
    // Every user-facing document route + the data snapshots the client reads
    // at request time. Enumerated (not a catch-all) so /_next/static/* assets
    // keep their long-lived immutable caching untouched.
    const freshSources = [
      "/",
      "/portfolio/:path*",
      "/stock/:path*",
      "/stocks",
      "/tee-times",
      "/fund/:path*",
      "/data/prices.json",
      "/data/fundamentals.json",
      "/digests.json",
      "/manifest.webmanifest",
    ];
    return freshSources.map((source) => ({
      source,
      headers: [freshDocument],
    }));
  },
};

export default nextConfig;
