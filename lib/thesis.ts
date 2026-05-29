// Per-player investment theses — loader for the "Why these picks" section on
// a player's own portfolio page (components/PortfolioThesis.tsx).
//
// Source of truth is config/thesis.json, keyed by user id. A player only gets
// a thesis section if they have an entry there, so this is fully optional and
// additive: no entry → getThesis() returns null → the section doesn't render.
// `picks` is keyed by ticker and matched against the player's holdings at
// render time, so reordering or trimming the roster needs no change here.
import thesisData from "@/config/thesis.json";
import type { UserId } from "./picks";

export interface ThesisPick {
  /** One-line hook shown on the always-visible row. */
  summary: string;
  /** Full reasoning, revealed when the row is expanded. */
  full: string;
}

export interface Thesis {
  /** Short theme label, e.g. "Physical AI + On-Device Intelligence". */
  theme: string;
  /** Attribution line, e.g. "Personal research memo · Feb 5, 2026". */
  source: string;
  /** Top-level thesis paragraphs (the "why this whole portfolio" intro). */
  overview: string[];
  /** Optional one-line disclaimer rendered in muted text at the foot. */
  disclaimer?: string;
  /** Per-ticker reasoning, keyed by symbol. */
  picks: Record<string, ThesisPick>;
}

// JSON imports widen to `any`-ish records; the leading `_comment` key isn't
// part of the contract, so cast through unknown to the typed shape.
const raw = thesisData as unknown as Record<string, Thesis | undefined> & {
  _comment?: string;
};

export function getThesis(userId: UserId): Thesis | null {
  const t = raw[userId];
  if (!t || !t.overview || !t.picks) return null;
  return t;
}
