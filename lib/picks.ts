export type UserId = "brian" | "kevin" | "rick" | "lee" | "gene";

export interface User {
  id: UserId;
  name: string;
  color: string;
  colorRgb: string;
  tickers: string[];
}

export const START_DATE = "2026-02-05";
export const STARTING_PORTFOLIO_DOLLARS = 100_000;

export const USERS: Record<UserId, User> = {
  brian: {
    id: "brian",
    name: "Brian",
    color: "#00C805",
    colorRgb: "0, 200, 5",
    tickers: ["ASTS", "AMZN", "UBER", "SERV", "AAPL", "QCOM", "ISRG", "CRSP", "HON", "EXOD"],
  },
  kevin: {
    id: "kevin",
    name: "Kevin",
    color: "#5AC8FA",
    colorRgb: "90, 200, 250",
    tickers: ["TSLA", "NVDA", "AVGO", "MRVL", "CRDO", "PLTR", "ORCL", "ZS", "VST", "VRT"],
  },
  rick: {
    id: "rick",
    name: "Rick",
    color: "#FF9F0A",
    colorRgb: "255, 159, 10",
    tickers: ["COHR", "CRWV", "GFS", "GOOGL", "NBIS", "QBTS", "NVDA", "RKLB", "S", "TSLA"],
  },
  lee: {
    id: "lee",
    name: "Lee",
    color: "#BF5AF2",
    colorRgb: "191, 90, 242",
    tickers: ["PEP", "GM", "TAP", "VZ", "UL", "DKS", "WMT", "PFE", "HD", "AAPL"],
  },
  gene: {
    id: "gene",
    name: "Gene",
    color: "#FF375F",
    colorRgb: "255, 55, 95",
    tickers: ["ASML", "CRSP", "OKLO", "GLUE", "VVOS", "HUT", "AMRZ", "SMR", "RKLB", "ZBRA"],
  },
};

export const USER_LIST: User[] = [USERS.brian, USERS.kevin, USERS.rick, USERS.lee, USERS.gene];

export function perHoldingDollars(userId: UserId): number {
  const u = USERS[userId];
  return STARTING_PORTFOLIO_DOLLARS / u.tickers.length;
}

export const TICKER_OWNERS: Record<string, UserId[]> = (() => {
  const out: Record<string, UserId[]> = {};
  for (const u of USER_LIST) {
    for (const t of u.tickers) {
      if (!out[t]) out[t] = [];
      out[t].push(u.id);
    }
  }
  return out;
})();

export const ALL_TICKERS: string[] = [
  ...new Set(USER_LIST.flatMap((u) => u.tickers)),
];

// Read-only market benchmark rendered alongside the human players on the
// Compare leaderboard + chart. Treated as a "player" for ranking purposes
// (its $100k-in-SPY-since-Feb-5 curve competes head-to-head) but explicitly
// NOT a User — it has no portfolio drill-down page, no digest entries, no
// stock detail, and never appears as a ticker owner. SPY is the implementation
// vehicle (an actual ETF with dividends, so the comparison reflects total
// return, not just price); we surface it to users under the more familiar
// "S&P 500" label.
export interface Baseline {
  id: string;
  name: string;
  color: string;
  colorRgb: string;
  ticker: string;
}

export const BASELINE: Baseline = {
  id: "sp500",
  name: "S&P 500",
  color: "#9CA3AF",
  colorRgb: "156, 163, 175",
  ticker: "SPY",
};

export const TICKER_NAMES: Record<string, string> = {
  ASTS: "AST SpaceMobile",
  AMZN: "Amazon",
  UBER: "Uber",
  SERV: "Serve Robotics",
  AAPL: "Apple",
  QCOM: "Qualcomm",
  ISRG: "Intuitive Surgical",
  CRSP: "CRISPR Therapeutics",
  HON: "Honeywell",
  EXOD: "Exodus Movement",
  TSLA: "Tesla",
  NVDA: "NVIDIA",
  AVGO: "Broadcom",
  MRVL: "Marvell",
  CRDO: "Credo Technology",
  PLTR: "Palantir",
  ORCL: "Oracle",
  ZS: "Zscaler",
  VST: "Vistra",
  VRT: "Vertiv",
  COHR: "Coherent",
  CRWV: "CoreWeave",
  GFS: "GlobalFoundries",
  GOOGL: "Alphabet",
  NBIS: "Nebius Group",
  QBTS: "D-Wave Quantum",
  RKLB: "Rocket Lab",
  S: "SentinelOne",
  PEP: "PepsiCo",
  GM: "General Motors",
  TAP: "Molson Coors Beverage",
  VZ: "Verizon",
  UL: "Unilever",
  DKS: "Dick's Sporting Goods",
  WMT: "Walmart",
  PFE: "Pfizer",
  HD: "Home Depot",
  ASML: "ASML Holding",
  OKLO: "Oklo",
  GLUE: "Monte Rosa Therapeutics",
  VVOS: "Vivos Therapeutics",
  HUT: "Hut 8",
  AMRZ: "Amrize",
  SMR: "NuScale Power",
  ZBRA: "Zebra Technologies",
};
