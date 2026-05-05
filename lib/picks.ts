export type UserId = "brian" | "kevin";

export interface User {
  id: UserId;
  name: string;
  color: string;
  colorRgb: string;
  tickers: string[];
}

export const START_DATE = "2026-02-05";
export const PER_HOLDING_DOLLARS = 10_000;

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
};

export const USER_LIST: User[] = [USERS.brian, USERS.kevin];

export const TICKER_OWNER: Record<string, UserId> = (() => {
  const out: Record<string, UserId> = {};
  for (const u of USER_LIST) for (const t of u.tickers) out[t] = u.id;
  return out;
})();

export const ALL_TICKERS: string[] = USER_LIST.flatMap((u) => u.tickers);

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
};
