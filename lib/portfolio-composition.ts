import "server-only";
import type { FundamentalsData, HoldingRow, TickerFundamentals } from "./types";
import { TICKER_NAMES, USERS, type UserId } from "./picks";

// Aggregates a player's holdings into composition slices for the donut chart
// and writes a narrative "About this portfolio" analysis. Runs at build time
// on the server — the result is a pure data structure that PortfolioComposition
// renders.

export type MarketCapBucket =
  | "Mega cap"
  | "Large cap"
  | "Mid cap"
  | "Small cap"
  | "Micro cap"
  | "Unknown";

export interface CompositionTickerRow {
  ticker: string;
  name: string;
  value: number;
  /** Share within the slice (0..1). */
  pct: number;
  /** Share of the whole portfolio (0..1). */
  portfolioPct: number;
}

export interface CompositionSlice {
  key: string;
  value: number;
  pct: number;
  color: string;
  tickers: CompositionTickerRow[];
}

export interface PortfolioAnalysis {
  headline: string;
  styleLabel: string;
  paragraphs: string[];
  highlights: Array<{ label: string; value: string; tone?: "accent" | "neutral" }>;
  themes: Array<{ name: string; tickers: string[] }>;
  // Concentration metrics so the UI can render an HHI-style gauge.
  hhi: number; // 0..1 (sum of squared sector shares)
  topSectorPct: number;
}

export interface PortfolioComposition {
  totalValue: number;
  bySector: CompositionSlice[];
  byIndustry: CompositionSlice[];
  byMarketCap: CompositionSlice[];
  analysis: PortfolioAnalysis;
}

// Per-sector palette so the donut color matches the user's mental model of
// "this is the Tech wedge." Industries and market caps fall back to a generic
// palette that's distinct from the player accent colors used elsewhere.
const SECTOR_COLORS: Record<string, string> = {
  Technology: "#00C805",
  "Communication Services": "#5AC8FA",
  "Consumer Cyclical": "#FF9F0A",
  "Consumer Defensive": "#BF5AF2",
  Healthcare: "#FF375F",
  Industrials: "#FFD60A",
  "Financial Services": "#30D158",
  Energy: "#FF6482",
  Utilities: "#64D2FF",
  "Real Estate": "#A6B4C2",
  "Basic Materials": "#FFAD32",
  Uncategorized: "#71717A",
};

const PALETTE = [
  "#00C805", "#5AC8FA", "#FF9F0A", "#BF5AF2",
  "#FF375F", "#FFD60A", "#30D158", "#FF6482",
  "#64D2FF", "#A78BFA", "#34D399", "#F472B6",
  "#60A5FA", "#FBBF24",
];

const MARKET_CAP_COLORS: Record<MarketCapBucket, string> = {
  "Mega cap": "#00C805",
  "Large cap": "#5AC8FA",
  "Mid cap": "#FF9F0A",
  "Small cap": "#BF5AF2",
  "Micro cap": "#FF375F",
  Unknown: "#71717A",
};

const MARKET_CAP_ORDER: MarketCapBucket[] = [
  "Mega cap",
  "Large cap",
  "Mid cap",
  "Small cap",
  "Micro cap",
  "Unknown",
];

function bucketForMarketCap(mc: number | null | undefined): MarketCapBucket {
  if (mc == null || !Number.isFinite(mc)) return "Unknown";
  if (mc >= 200e9) return "Mega cap";
  if (mc >= 10e9) return "Large cap";
  if (mc >= 2e9) return "Mid cap";
  if (mc >= 300e6) return "Small cap";
  return "Micro cap";
}

interface RowWithMeta {
  ticker: string;
  name: string;
  value: number;
  sector: string;
  industry: string;
  marketCap: number | null;
  bucket: MarketCapBucket;
}

function groupBy<T extends string>(
  rows: RowWithMeta[],
  total: number,
  keyOf: (r: RowWithMeta) => T,
  colorOf: (key: T) => string,
  order?: T[]
): CompositionSlice[] {
  const buckets = new Map<T, RowWithMeta[]>();
  for (const r of rows) {
    const k = keyOf(r);
    const arr = buckets.get(k) ?? [];
    arr.push(r);
    buckets.set(k, arr);
  }
  const slices: CompositionSlice[] = [];
  for (const [key, items] of buckets) {
    const value = items.reduce((s, x) => s + x.value, 0);
    const tickers: CompositionTickerRow[] = items
      .map((x) => ({
        ticker: x.ticker,
        name: x.name,
        value: x.value,
        pct: value === 0 ? 0 : x.value / value,
        portfolioPct: total === 0 ? 0 : x.value / total,
      }))
      .sort((a, b) => b.value - a.value);
    slices.push({
      key,
      value,
      pct: total === 0 ? 0 : value / total,
      color: colorOf(key),
      tickers,
    });
  }
  // Sort: explicit order if provided (market cap), else descending by value.
  if (order) {
    const idx = new Map(order.map((k, i) => [k, i] as const));
    slices.sort((a, b) => (idx.get(a.key as T) ?? 99) - (idx.get(b.key as T) ?? 99));
  } else {
    slices.sort((a, b) => b.value - a.value);
  }
  return slices;
}

export function buildPortfolioComposition(
  userId: UserId,
  holdings: HoldingRow[],
  fundamentals: FundamentalsData | null
): PortfolioComposition {
  const fmap = fundamentals?.tickers ?? {};
  const rows: RowWithMeta[] = holdings.map((h) => {
    const f: TickerFundamentals | undefined = fmap[h.ticker];
    const sector = f?.sector ?? "Uncategorized";
    const industry = f?.industry ?? "Uncategorized";
    const marketCap = f?.marketCap ?? null;
    return {
      ticker: h.ticker,
      name: f?.name ?? TICKER_NAMES[h.ticker] ?? h.ticker,
      value: h.currentValue,
      sector,
      industry,
      marketCap,
      bucket: bucketForMarketCap(marketCap),
    };
  });
  const totalValue = rows.reduce((s, r) => s + r.value, 0);

  const bySector = groupBy<string>(
    rows,
    totalValue,
    (r) => r.sector,
    (k) => SECTOR_COLORS[k] ?? PALETTE[Math.abs(hashKey(k)) % PALETTE.length]
  );

  // Industries: assign palette colors by descending value order so the largest
  // industry takes the brand-green slot. Stable across renders since the slice
  // order is deterministic.
  const byIndustryRaw = groupBy<string>(
    rows,
    totalValue,
    (r) => r.industry,
    () => "#71717A" // overwritten below
  );
  const byIndustry = byIndustryRaw.map((s, i) => ({
    ...s,
    color: PALETTE[i % PALETTE.length],
  }));

  const byMarketCap = groupBy<MarketCapBucket>(
    rows,
    totalValue,
    (r) => r.bucket,
    (k) => MARKET_CAP_COLORS[k],
    MARKET_CAP_ORDER
  );

  const analysis = writeAnalysis({
    userId,
    rows,
    totalValue,
    bySector,
    byIndustry,
    byMarketCap,
  });

  return { totalValue, bySector, byIndustry, byMarketCap, analysis };
}

function hashKey(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

// --- Analysis writer -------------------------------------------------------
//
// Heuristic narrative generator. Reads the actual composition and emits a
// 2-3 paragraph "About this portfolio" summary plus a handful of highlight
// chips and detected themes. The shape of the output is stable so the UI
// can rely on it; the wording adapts to the data.

interface AnalysisInput {
  userId: UserId;
  rows: RowWithMeta[];
  totalValue: number;
  bySector: CompositionSlice[];
  byIndustry: CompositionSlice[];
  byMarketCap: CompositionSlice[];
}

// Themes are recognized by ticker overlap. The blurb gets the *matched*
// tickers spliced in so the analysis only mentions stocks the player
// actually owns. Order matters — earlier themes "win" for shared tickers
// when summarizing the headline.
const THEMES: Array<{
  name: string;
  tickers: string[];
  // How many matches before this theme is considered material.
  threshold: number;
}> = [
  {
    name: "AI infrastructure",
    tickers: [
      "NVDA", "AVGO", "MRVL", "CRDO", "PLTR", "CRWV", "NBIS",
      "VST", "VRT", "ORCL", "ASML", "GFS", "ZS",
    ],
    threshold: 2,
  },
  {
    name: "Consumer staples & defensives",
    tickers: ["PEP", "TAP", "UL", "WMT", "PFE", "VZ"],
    threshold: 2,
  },
  {
    name: "Mega-cap incumbents",
    tickers: ["AAPL", "AMZN", "GOOGL", "MSFT", "META", "NVDA", "TSLA", "AVGO", "ORCL", "WMT", "HD"],
    threshold: 3,
  },
  {
    name: "Frontier tech",
    tickers: ["QBTS", "RKLB", "ASTS", "SERV", "OKLO", "SMR", "CRSP", "GLUE", "VVOS"],
    threshold: 2,
  },
  {
    name: "Crypto & digital assets",
    tickers: ["EXOD", "HUT"],
    threshold: 1,
  },
  {
    name: "EV & autos",
    tickers: ["TSLA", "GM"],
    threshold: 1,
  },
  {
    name: "Healthcare & biotech",
    tickers: ["CRSP", "GLUE", "VVOS", "ISRG", "PFE"],
    threshold: 2,
  },
  {
    name: "Cybersecurity",
    tickers: ["ZS", "S", "PLTR"],
    threshold: 2,
  },
  {
    name: "Space & aerospace",
    tickers: ["RKLB", "ASTS", "HON"],
    threshold: 2,
  },
  {
    name: "Brick-and-mortar retail",
    tickers: ["WMT", "HD", "DKS", "AMZN"],
    threshold: 2,
  },
];

function fmtPctShort(p: number): string {
  return `${(p * 100).toFixed(0)}%`;
}

function fmtPct1(p: number): string {
  return `${(p * 100).toFixed(1)}%`;
}

function fmtUSDCompact(n: number): string {
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

// Lowercase a theme name for use mid-sentence, but preserve leading acronyms
// like "AI infrastructure" or "EV & autos".
function midSentenceTheme(name: string): string {
  if (/^[A-Z]{2,}/.test(name)) return name;
  return name.charAt(0).toLowerCase() + name.slice(1);
}

function listJoin(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function writeAnalysis(input: AnalysisInput): PortfolioAnalysis {
  const { userId, rows, totalValue, bySector, byIndustry, byMarketCap } = input;
  const name = USERS[userId].name;

  // --- Concentration metrics ---
  const hhi = bySector.reduce((s, x) => s + x.pct * x.pct, 0);
  // For the narrative, skip "Uncategorized" when picking the leading sector —
  // it's a data-completeness bucket, not an investment thesis. The donut still
  // shows the slice; we just don't write "X's portfolio is built around
  // Uncategorized" in the headline.
  const namedSectors = bySector.filter((s) => s.key !== "Uncategorized");
  const topSector = namedSectors[0] ?? bySector[0];
  const secondSector = namedSectors[1] ?? bySector[1];
  const top3SectorShare = bySector.slice(0, 3).reduce((s, x) => s + x.pct, 0);
  const topHolding = [...rows].sort((a, b) => b.value - a.value)[0];
  const topHoldingPct = totalValue === 0 ? 0 : topHolding.value / totalValue;

  // --- Market-cap profile ---
  const megaPct = byMarketCap.find((s) => s.key === "Mega cap")?.pct ?? 0;
  const largePct = byMarketCap.find((s) => s.key === "Large cap")?.pct ?? 0;
  const midPct = byMarketCap.find((s) => s.key === "Mid cap")?.pct ?? 0;
  const smallPct = byMarketCap.find((s) => s.key === "Small cap")?.pct ?? 0;
  const microPct = byMarketCap.find((s) => s.key === "Micro cap")?.pct ?? 0;
  const speculativePct = smallPct + microPct;

  // --- Theme detection ---
  const ownedSet = new Set(rows.map((r) => r.ticker));
  const matchedThemes: Array<{ name: string; tickers: string[] }> = [];
  for (const t of THEMES) {
    const matched = t.tickers.filter((tk) => ownedSet.has(tk));
    if (matched.length >= t.threshold) {
      matchedThemes.push({ name: t.name, tickers: matched });
    }
  }
  // Reorder by relevance (number of matches), but keep the first hit if tied.
  matchedThemes.sort((a, b) => b.tickers.length - a.tickers.length);

  // --- Style label (one-line investor archetype) ---
  let styleLabel: string;
  if (speculativePct >= 0.35) {
    styleLabel = "Aggressive growth";
  } else if (megaPct >= 0.55) {
    styleLabel = hhi >= 0.45 ? "Concentrated blue-chip" : "Blue-chip core";
  } else if (megaPct + largePct >= 0.7 && hhi < 0.3) {
    styleLabel = "Balanced large-cap";
  } else if (hhi >= 0.5) {
    styleLabel = "Thematic concentration";
  } else if (matchedThemes[0]?.name === "Consumer staples & defensives") {
    styleLabel = "Defensive value";
  } else {
    styleLabel = "Growth-tilted diversified";
  }

  // --- Headline (1 line) ---
  // Preserve case for acronym-leading theme names (e.g. "AI infrastructure"
  // mustn't become "ai infrastructure"); only lowercase the first letter when
  // the original starts with a capitalized regular word.
  const rawTheme = matchedThemes[0]?.name;
  const themeForHeadline = rawTheme
    ? /^[A-Z]{2,}/.test(rawTheme)
      ? rawTheme
      : rawTheme.charAt(0).toLowerCase() + rawTheme.slice(1)
    : null;
  let headline: string;
  if (themeForHeadline && topSector) {
    headline = `${name}'s portfolio leans into ${themeForHeadline}, anchored by ${fmtPctShort(topSector.pct)} in ${topSector.key}.`;
  } else if (topSector) {
    headline = `${name}'s portfolio is built around ${topSector.key} (${fmtPctShort(topSector.pct)} of value).`;
  } else {
    headline = `${name}'s portfolio composition`;
  }

  // --- Paragraph 1: sector & concentration ---
  const sectorBits: string[] = [];
  if (topSector) {
    sectorBits.push(
      `${fmtPctShort(topSector.pct)} of ${name}'s capital sits in ${topSector.key}` +
        (topSector.tickers.length > 1
          ? `, spread across ${topSector.tickers.length} names`
          : ` via a single bet on ${topSector.tickers[0].ticker}`)
    );
  }
  if (secondSector) {
    sectorBits.push(
      `${fmtPctShort(secondSector.pct)} in ${secondSector.key}`
    );
  }
  if (bySector.length >= 4) {
    sectorBits.push(`with the rest scattered across ${bySector.length - 2} more sectors`);
  } else if (bySector.length === 3) {
    sectorBits.push(`and a third leg in ${bySector[2].key}`);
  }

  const concentrationVerdict = (() => {
    if (hhi >= 0.5) return "highly concentrated";
    if (hhi >= 0.3) return "concentrated but with multiple legs";
    if (hhi >= 0.18) return "moderately diversified";
    return "broadly diversified across sectors";
  })();

  const p1 = `${sectorBits.join("; ")}. By sector exposure, the book is ${concentrationVerdict} — the top three sectors absorb ${fmtPctShort(top3SectorShare)} of the portfolio.`;

  // --- Paragraph 2: market cap profile ---
  const mcBits: string[] = [];
  if (megaPct > 0.05) mcBits.push(`${fmtPctShort(megaPct)} mega cap`);
  if (largePct > 0.05) mcBits.push(`${fmtPctShort(largePct)} large cap`);
  if (midPct > 0.05) mcBits.push(`${fmtPctShort(midPct)} mid cap`);
  if (smallPct > 0.05) mcBits.push(`${fmtPctShort(smallPct)} small cap`);
  if (microPct > 0.05) mcBits.push(`${fmtPctShort(microPct)} micro cap`);

  let mcCharacter: string;
  if (megaPct >= 0.6) {
    mcCharacter = "a clear blue-chip lean — most of the dollar weight is in companies that move with the broad market, not with single-stock catalysts";
  } else if (speculativePct >= 0.4) {
    mcCharacter = `a high-volatility posture — roughly ${fmtPctShort(speculativePct)} sits in small- or micro-cap names where idiosyncratic news drives the curve`;
  } else if (megaPct + largePct >= 0.75) {
    mcCharacter = "a large-cap-anchored profile — index-correlated drift is the dominant risk, but a few mid-cap positions can still swing the leaderboard on earnings days";
  } else {
    mcCharacter = "a barbell shape — mega-cap anchors on one side, speculative growth names on the other, with not much in between";
  }

  const p2 = `Cap-size mix: ${mcBits.join(", ")}. That's ${mcCharacter}.`;

  // --- Paragraph 3: themes + notable positions ---
  const themeSentence = (() => {
    if (matchedThemes.length === 0) {
      return `No single sub-theme dominates — the picks read as ${name}'s personal conviction list rather than a top-down macro bet.`;
    }
    const top = matchedThemes[0];
    const secondary = matchedThemes[1];
    const lead = `The picks bunch up around ${midSentenceTheme(top.name)} (${listJoin(top.tickers)})`;
    if (secondary) {
      return `${lead}, with a secondary tilt toward ${midSentenceTheme(secondary.name)} (${listJoin(secondary.tickers)}).`;
    }
    return `${lead}.`;
  })();

  const concentrationNote = (() => {
    if (topHoldingPct >= 0.18) {
      return ` The single largest position is ${topHolding.ticker} at ${fmtPctShort(topHoldingPct)} of the portfolio — a meaningful concentration that will move the line on its own news days.`;
    }
    if (topHoldingPct >= 0.13) {
      return ` ${topHolding.ticker} is the heaviest single position at ${fmtPctShort(topHoldingPct)}, though no holding has runaway dominance.`;
    }
    return ` No single position sits above ~${fmtPctShort(Math.max(topHoldingPct, 0.12))}, so the curve reflects the basket rather than any one stock.`;
  })();

  const p3 = themeSentence + concentrationNote;

  const paragraphs = [p1, p2, p3];

  // --- Highlights chips ---
  const highlights: PortfolioAnalysis["highlights"] = [];
  if (topSector) {
    highlights.push({
      label: namedSectors.length > 0 ? "Top sector" : "Largest slice",
      value: `${topSector.key} · ${fmtPct1(topSector.pct)}`,
      tone: "accent",
    });
  }
  highlights.push({
    label: "Mega+Large cap",
    value: fmtPct1(megaPct + largePct),
  });
  if (speculativePct > 0.02) {
    highlights.push({
      label: "Small/Micro cap",
      value: fmtPct1(speculativePct),
    });
  }
  highlights.push({
    label: "Top holding",
    value: `${topHolding.ticker} · ${fmtPct1(topHoldingPct)}`,
  });
  highlights.push({
    label: "Sectors",
    value: `${bySector.length}`,
  });

  return {
    headline,
    styleLabel,
    paragraphs,
    highlights,
    themes: matchedThemes.slice(0, 4),
    hhi,
    topSectorPct: topSector?.pct ?? 0,
  };
}

// Tiny formatter the UI imports too — avoids a circular dep with
// lib/portfolio.ts (which only re-exports formatters).
export function fmtCompositionUSD(n: number): string {
  return fmtUSDCompact(n);
}
