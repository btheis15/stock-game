import type { PriceData } from "./types";
import { createRemoteJsonLoader } from "./remote-json";

// Request-time price loader. Reads origin/main via the GitHub Contents API
// (60s TTL) so the mini's 15-min data commits go live WITHOUT a Vercel
// rebuild; falls back to the committed snapshot baked into this deploy for
// dev / build / GitHub outages. See lib/remote-json.ts for the failure
// ladder.
const load = createRemoteJsonLoader<PriceData>({
  repoPath: "public/data/prices.json",
  ttlMs: 60_000,
});

export async function loadPriceData(): Promise<PriceData> {
  const data = await load();
  if (!data) {
    throw new Error(
      "prices.json unavailable from both GitHub and the deploy filesystem"
    );
  }
  return data;
}
