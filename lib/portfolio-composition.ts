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
  themes: Array<{ name: string; tickers: string[] }>;
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
// One-time, hand-written "About this portfolio" summary per player. The
// narrative is intentionally static and qualitative — it describes WHAT each
// player is investing in (themes, types of companies) without referencing
// percentages, dollar amounts, or any concentration metric that moves with
// prices. The donut + breakdown lists above handle live numbers; this card
// is the editorial layer.
//
// To add or change a player's blurb: edit `PER_USER_ANALYSIS` below. Themes
// are derived from ticker overlap (structural, not price-dependent), so they
// stay stable as long as picks don't change.

interface AnalysisInput {
  userId: UserId;
  rows: RowWithMeta[];
  totalValue: number;
  bySector: CompositionSlice[];
  byIndustry: CompositionSlice[];
  byMarketCap: CompositionSlice[];
}

// Themes are recognized by ticker overlap (structural, doesn't move with
// prices). The chips are decorative — the narrative paragraphs are the
// primary signal.
const THEMES: Array<{
  name: string;
  tickers: string[];
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

const PER_USER_ANALYSIS: Record<
  UserId,
  { styleLabel: string; headline: string; paragraphs: string[] }
> = {
  brian: {
    styleLabel: "Tech barbell",
    headline:
      "Brian's portfolio splits its weight between mega-cap tech platforms and a handful of speculative frontier bets.",
    paragraphs: [
      "The anchor positions are the kind of names that show up on every blue-chip list — Apple, Amazon, and Qualcomm. They're the dominant platforms of the smartphone, e-commerce, and wireless-chip eras respectively, and the exposure here looks more like \"own the incumbents who already won\" than a high-conviction growth wager.",
      "The other side of the book reads like a venture sleeve: AST SpaceMobile (satellite-to-phone connectivity), Serve Robotics (sidewalk delivery), CRISPR Therapeutics (gene editing), and Exodus (crypto self-custody). These are pre-revenue or early-revenue companies where the thesis isn't \"what are they earning today\" — it's \"what does the world look like if their bet works.\" Intuitive Surgical and Honeywell sit in the middle, adding surgical robotics and industrial-conglomerate exposure.",
      "Read together, the picks look like someone who believes the future will be both more concentrated (Apple's grip on hardware, Amazon's grip on logistics) and more disrupted (space-based broadband, robotic delivery, on-chain finance) than the consensus assumes. Uber rounds it out as the rare bet that's already crossed the line from \"speculative\" to \"profitable mobility platform.\"",
    ],
  },
  kevin: {
    styleLabel: "AI buildout — picks and shovels",
    headline:
      "Kevin's portfolio is a high-conviction thesis on the AI infrastructure buildout, expressed across every layer of the stack.",
    paragraphs: [
      "At the silicon layer: NVIDIA for GPUs, Broadcom and Marvell for networking and custom ASICs, Credo for the high-speed interconnect cables that tie data centers together. At the platform layer: Oracle for cloud + database, Palantir for the enterprise AI workflow stack, Zscaler for zero-trust security on top of it. These aren't separate bets — they're the same bet at different price points in the same supply chain.",
      "The most distinctive choice is the energy and cooling sleeve: Vistra (independent power producer) and Vertiv (data-center electrical equipment). Most AI-themed portfolios stop at the chip and software layer; this one reaches further, down to the power-grid bottleneck that AI training is creating. It's the rare bet that gets paid even if the headline AI narrative cools, because the power demand has already been booked.",
      "Tesla is the wildcard, fitting either as an EV maker or as the most ambitious robotaxi/Optimus AI bet in the public markets. Either way, the portfolio reads as someone who picked a single secular story and dug into it from every angle — no defensive sleeve, no consumer-staples ballast, no hedge.",
    ],
  },
  rick: {
    styleLabel: "Next-decade tech",
    headline:
      "Rick's portfolio reads like a bet on what the coming era of technology will look like, from quantum hardware to commercial spaceflight.",
    paragraphs: [
      "The center of gravity is AI compute, but with a more specialized take than the obvious picks. NVIDIA is there, but so are CoreWeave and Nebius — the GPU-as-a-service companies that buy NVIDIA's chips and rent them out. GlobalFoundries and Coherent provide the upstream foundry and optical-component layer. Alphabet sits as the diversified incumbent that participates in AI without being a pure-play.",
      "Around that core are frontier bets that most portfolios don't touch: Rocket Lab (small-launch and Neutron rocket development), D-Wave Quantum (annealing-based quantum computing), and SentinelOne (autonomous cyber defense). Each is a wager that a specific deep-tech category becomes commercially mainstream within the holding period — and none of them depend on the same news cycle.",
      "Tesla rounds out the book, slotting in as the EV and autonomy bet. There's no consumer-staples or industrial ballast here, which is consistent with the rest of the picks: the portfolio is built to compound if next-generation tech keeps shipping, and to look very different if it doesn't.",
    ],
  },
  lee: {
    styleLabel: "Defensive value",
    headline:
      "Lee's portfolio is a classic defensive book — companies people buy from in good markets and bad ones.",
    paragraphs: [
      "The core is consumer staples and large retail: PepsiCo, Molson Coors, Unilever, Walmart, Home Depot, and Dick's Sporting Goods. These are the companies that show up in everyone's monthly budget — drinks, household goods, groceries, weekend project supplies, kids' soccer cleats. They don't grow fast, but they grow steadily, they pay dividends, and they don't tend to crater in a recession.",
      "Verizon and Pfizer add more defensive flavors — telecom (recurring monthly bills) and pharma (regulated, slow-moving, dividend-paying). General Motors provides cyclical auto exposure, the least defensive name in the book, but rounds it out with industrial cash flow and a meaningful dividend.",
      "Apple is the one growth-shaped anchor, providing tech exposure without the speculative risk profile of the names showing up in other players' books. Read together, the portfolio looks like someone who wants the curve to go up smoothly rather than spike — the kind of holdings that produce a livable yield even if the broader market gets choppy.",
    ],
  },
  gene: {
    styleLabel: "Frontier venture",
    headline:
      "Gene's portfolio reads like a venture sleeve — every name is a bet that a specific frontier-tech category breaks through in the years ahead.",
    paragraphs: [
      "Nuclear takes the headline weight, with both small-modular-reactor pure-plays: Oklo (the Sam Altman–backed startup with the compact fast-reactor design) and NuScale (the most-permitted SMR developer in the US). Either could end up powering the next generation of data centers if licensing timelines accelerate.",
      "The biotech sleeve is similarly forward-looking: CRISPR Therapeutics (gene-editing therapies), Monte Rosa (targeted protein degradation), and Vivos Therapeutics (sleep-apnea devices). These are pre-blockbuster, clinical-stage names — high binary risk per ticker, but uncorrelated to the AI cycle that dominates other players' books. Rocket Lab adds commercial spaceflight; Hut 8 brings power-dense data center infrastructure for AI and HPC compute (with ASIC mining as a tenant workload); Zebra and ASML provide more conventional industrial-tech anchors (barcode scanners, lithography equipment).",
      "Amrize (the new spin-off from Holcim's North American cement business) is the odd one out — pure industrial-materials cash flow, providing a non-frontier counterweight to everything else. Read together, the portfolio looks like a \"what if\" deck where each name represents a different version of the future, and the question is which ones get built.",
    ],
  },
  legacyauto: {
    styleLabel: "Legacy automakers",
    headline:
      "Legacy Auto is a themed basket of the established global car manufacturers — the ICE-era incumbents still navigating the EV transition.",
    paragraphs: [
      "The five names cover the three regions that built the modern auto industry: Detroit (Ford and GM), Stuttgart-via-Italy (Stellantis — the Chrysler/Peugeot/Fiat combine), and Japan (Toyota and Honda). Each runs a multi-decade-old manufacturing footprint with deep dealer networks, established supplier relationships, and the cash flow that comes from selling tens of millions of vehicles a year.",
      "The implicit thesis is mean reversion: that the market has over-rewarded the EV pure-plays and under-priced the incumbents who actually know how to build cars at scale, manage warranties, and turn factories profitable. Toyota's hybrid-first transition strategy looks especially well-positioned if EV adoption proves slower than the bull case; Ford and GM have both pulled back on EV capex while keeping their truck franchises healthy.",
      "There's no growth-tech ballast here — no diversification away from the cycle. The book is built for the scenario where global auto demand stays roughly flat, hybrids outsell pure EVs through the late-2020s, and the incumbents reclaim some of the multiple they've ceded to Tesla and BYD. If that view is wrong, every name in the basket moves together.",
    ],
  },
};

function writeAnalysis(input: AnalysisInput): PortfolioAnalysis {
  const { userId, rows } = input;

  // Theme detection (structural — doesn't change with prices).
  const ownedSet = new Set(rows.map((r) => r.ticker));
  const matchedThemes: Array<{ name: string; tickers: string[] }> = [];
  for (const t of THEMES) {
    const matched = t.tickers.filter((tk) => ownedSet.has(tk));
    if (matched.length >= t.threshold) {
      matchedThemes.push({ name: t.name, tickers: matched });
    }
  }
  matchedThemes.sort((a, b) => b.tickers.length - a.tickers.length);

  const blurb = PER_USER_ANALYSIS[userId];

  return {
    headline: blurb.headline,
    styleLabel: blurb.styleLabel,
    paragraphs: blurb.paragraphs,
    themes: matchedThemes.slice(0, 4),
  };
}
