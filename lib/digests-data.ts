import "server-only";
import type { DigestsJson } from "./digests";
import { createRemoteJsonLoader } from "./remote-json";

// Server-side loader behind /api/digests. The client used to fetch the
// same-origin static /digests.json, but that file is baked per-deploy —
// once data commits stopped triggering builds it would freeze. This loader
// serves the latest committed digests from origin/main (60s TTL, filesystem
// fallback), same pattern as lib/data.ts.
const load = createRemoteJsonLoader<DigestsJson>({
  repoPath: "public/digests.json",
  ttlMs: 60_000,
});

export async function loadDigestsData(): Promise<DigestsJson | null> {
  return load();
}
