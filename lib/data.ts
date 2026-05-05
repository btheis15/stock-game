import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { PriceData } from "./types";

let cached: PriceData | null = null;

export async function loadPriceData(): Promise<PriceData> {
  if (cached) return cached;
  const file = resolve(process.cwd(), "public", "data", "prices.json");
  const raw = await readFile(file, "utf8");
  cached = JSON.parse(raw) as PriceData;
  return cached;
}
