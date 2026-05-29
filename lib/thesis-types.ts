// Thesis types + pure helpers — client-safe (NO node:fs imports).
//
// Split out from lib/thesis.ts so client components (PortfolioThesis,
// EditThesisModal) can import the Thesis type, field caps, and the
// thesisHasContent helper without dragging the server-only filesystem /
// GitHub loader into the browser bundle (which fails the Turbopack build:
// "the chunking context does not support external modules: node:fs/promises").
// The server loader in lib/thesis.ts re-exports everything here.
import { USERS, type UserId } from "./picks";

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

/** The on-disk shape: user id → thesis, plus a leading `_comment`. */
export type ThesisFile = { _comment?: string } & Record<string, Thesis>;

// Field caps — shared with the editor so the client mirrors what the server
// enforces (no silent truncation, clear "X left" affordances).
export const THESIS_LIMITS = {
  theme: 80,
  source: 80,
  disclaimer: 300,
  overviewParagraph: 2000,
  overviewParagraphs: 8,
  summary: 300,
  full: 4000,
} as const;

export const THESIS_PATH = "config/thesis.json";

/** True when a thesis carries any real content — used to decide whether the
 *  section renders its body or its empty "add yours" state. */
export function thesisHasContent(t: Thesis | null): boolean {
  if (!t) return false;
  if (t.overview.some((p) => p.trim().length > 0)) return true;
  return Object.values(t.picks).some(
    (p) => p.summary.trim().length > 0 || p.full.trim().length > 0
  );
}

// --- Validation / normalization (used by the API route) -------------------

export interface ThesisInput {
  theme?: string;
  source?: string;
  overview?: string | string[];
  disclaimer?: string;
  picks?: Record<string, { summary?: string; full?: string }>;
}

export class ThesisValidationError extends Error {}

function cap(label: string, value: string, max: number): string {
  if (value.length > max) {
    throw new ThesisValidationError(`${label} must be ${max} characters or fewer`);
  }
  return value;
}

/** Validate + normalize an editor payload into a clean Thesis for `userId`.
 *  Throws ThesisValidationError on any cap/shape violation. Tickers not in
 *  the player's roster are dropped (the editor only ever offers roster
 *  tickers, so this just guards against stale/forged payloads). Empty
 *  picks (no summary and no full) are dropped so the file stays tidy. */
export function normalizeThesisInput(userId: UserId, input: ThesisInput): Thesis {
  const user = USERS[userId];
  if (!user) throw new ThesisValidationError(`unknown player "${userId}"`);

  const theme = cap("Theme", (input.theme ?? "").trim(), THESIS_LIMITS.theme);
  const source = cap("Source", (input.source ?? "").trim(), THESIS_LIMITS.source);
  const disclaimer = cap(
    "Disclaimer",
    (input.disclaimer ?? "").trim(),
    THESIS_LIMITS.disclaimer
  );

  // Overview accepts a single textarea string (split on blank lines into
  // paragraphs) or a pre-split array.
  const rawParas = Array.isArray(input.overview)
    ? input.overview
    : (input.overview ?? "").split(/\n{2,}/);
  const overview = rawParas
    .map((p) => p.replace(/\s+$/g, "").trim())
    .filter((p) => p.length > 0)
    .map((p) => cap("Thesis paragraph", p, THESIS_LIMITS.overviewParagraph));
  if (overview.length > THESIS_LIMITS.overviewParagraphs) {
    throw new ThesisValidationError(
      `thesis is limited to ${THESIS_LIMITS.overviewParagraphs} paragraphs`
    );
  }

  const allowed = new Set(user.tickers);
  const picks: Record<string, ThesisPick> = {};
  for (const [rawTicker, p] of Object.entries(input.picks ?? {})) {
    const ticker = rawTicker.toUpperCase();
    if (!allowed.has(ticker)) continue;
    const summary = cap("Pick summary", (p?.summary ?? "").trim(), THESIS_LIMITS.summary);
    const full = cap("Pick reasoning", (p?.full ?? "").trim(), THESIS_LIMITS.full);
    if (!summary && !full) continue; // drop empty picks
    picks[ticker] = { summary, full };
  }

  const out: Thesis = { theme, source, overview, picks };
  if (disclaimer) out.disclaimer = disclaimer;
  return out;
}
