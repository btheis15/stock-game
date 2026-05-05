"use client";

import { fmtPct, fmtSignedUSD } from "@/lib/portfolio";
import type { Range, RangeAnalysis } from "@/lib/types";
import { TICKER_NAMES, USERS } from "@/lib/picks";

const RANGE_LABEL: Record<Range, string> = {
  "1W": "this week",
  "1M": "this month",
  "3M": "this quarter",
  "1YR": "this year",
  ALL: "since Feb 5",
};

const MIN_BIG_MOVE_PCT = 0.08;

export function InsightsCard({ analysis }: { analysis: RangeAnalysis }) {
  const { brianPct, kevinPct, brianMovers, kevinMovers, topGainers, topLosers, range } = analysis;

  const leaderId = brianPct >= kevinPct ? "brian" : "kevin";
  const trailerId = leaderId === "brian" ? "kevin" : "brian";
  const leaderMovers = leaderId === "brian" ? brianMovers : kevinMovers;
  const trailerMovers = leaderId === "brian" ? kevinMovers : brianMovers;

  const leaderTop = leaderMovers[0];
  const trailerWorst = trailerMovers[trailerMovers.length - 1];
  const overallWinner = topGainers[0];
  const overallLoser = topLosers[0];

  const bullets: { tone: "good" | "bad" | "info"; node: React.ReactNode; key: string }[] = [];

  if (leaderTop && leaderTop.pct > 0) {
    bullets.push({
      tone: "good",
      key: `lead-${leaderTop.ticker}`,
      node: (
        <>
          <Tk t={leaderTop.ticker} /> <Pct n={leaderTop.pct} /> — {USERS[leaderId].name}'s
          top contributor ({fmtSignedUSD(leaderTop.dollars, 0)})
        </>
      ),
    });
  }

  if (trailerWorst && trailerWorst.pct < 0) {
    bullets.push({
      tone: "bad",
      key: `worst-${trailerWorst.ticker}`,
      node: (
        <>
          <Tk t={trailerWorst.ticker} /> <Pct n={trailerWorst.pct} /> — {USERS[trailerId].name}'s
          biggest drag ({fmtSignedUSD(trailerWorst.dollars, 0)})
        </>
      ),
    });
  }

  if (
    overallWinner &&
    overallWinner.pct >= MIN_BIG_MOVE_PCT &&
    overallWinner.ticker !== leaderTop?.ticker
  ) {
    bullets.push({
      tone: "good",
      key: `top-${overallWinner.ticker}`,
      node: (
        <>
          <Tk t={overallWinner.ticker} /> <Pct n={overallWinner.pct} /> — biggest mover{" "}
          {RANGE_LABEL[range]}
        </>
      ),
    });
  }

  if (
    overallLoser &&
    overallLoser.pct <= -MIN_BIG_MOVE_PCT &&
    overallLoser.ticker !== trailerWorst?.ticker
  ) {
    bullets.push({
      tone: "bad",
      key: `low-${overallLoser.ticker}`,
      node: (
        <>
          <Tk t={overallLoser.ticker} /> <Pct n={overallLoser.pct} /> — worst drop{" "}
          {RANGE_LABEL[range]}
        </>
      ),
    });
  }

  if (bullets.length === 0) {
    bullets.push({
      tone: "info",
      key: "quiet",
      node: <>Pretty quiet {RANGE_LABEL[range]} — no holding moved more than {fmtPct(MIN_BIG_MOVE_PCT, 0)}.</>,
    });
  }

  return (
    <div className="px-4 mt-5">
      <h2 className="text-[15px] font-semibold text-zinc-300 mb-2">
        What's driving it
      </h2>
      <div className="rounded-2xl bg-zinc-900/70 border border-zinc-800 p-4 space-y-2.5">
        {bullets.map((b) => (
          <div key={b.key} className="flex items-start gap-2.5 text-[13px] leading-snug text-zinc-200">
            <Dot tone={b.tone} />
            <span className="flex-1">{b.node}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Dot({ tone }: { tone: "good" | "bad" | "info" }) {
  const color =
    tone === "good" ? "#00C805" : tone === "bad" ? "#FF453A" : "#999";
  return (
    <span
      className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0"
      style={{ backgroundColor: color }}
    />
  );
}

function Tk({ t }: { t: string }) {
  return (
    <span className="font-semibold text-white">
      {t}
      <span className="text-zinc-500 font-normal text-[12px] ml-1">
        {TICKER_NAMES[t] ?? ""}
      </span>
    </span>
  );
}

function Pct({ n }: { n: number }) {
  const color = n >= 0 ? "#00C805" : "#FF453A";
  return (
    <span style={{ color }} className="font-semibold tabular-nums">
      {fmtPct(n)}
    </span>
  );
}
