/** Pre-registration commit. Results must cite this and must not relax the rules. */
export const ROUND14_PREREG = "0de587a42425e23cabdef9b8e23f9e08a8161b17";

export const START = 3200;

export type YearSlice = { year: string; from: string; to: string };

/** Calendar years inside the window. The cut is the last session of that year, or the window end. */
export function yearSlices(sessions: readonly string[]): YearSlice[] {
  const out: YearSlice[] = [];
  let from = sessions[0] ?? "";
  for (let i = 0; i < sessions.length; i += 1) {
    const date = sessions[i];
    const next = sessions[i + 1];
    const end = !next || next.slice(0, 4) !== date.slice(0, 4);
    if (!end) continue;
    out.push({ year: date.slice(0, 4), from, to: date });
    from = next ?? "";
  }
  return out;
}

/** Equity at `to` minus equity at the session before `from`, or the starting capital when `from` is the first session. */
export function equityChange(daily: readonly { date: string; equity: number }[], from: string, to: string, capital: number): number {
  const end = daily.find((row) => row.date === to);
  if (!end) throw new Error(`年末の評価がない ${to}`);
  const prior = [...daily].reverse().find((row) => row.date < from);
  const start = prior ? prior.equity : capital;
  return Math.round((end.equity - start) * 100) / 100;
}

export function lowestEquity(daily: readonly { date: string; equity: number }[]): { usd: number; date: string } {
  const first = daily[0];
  if (!first) throw new Error("日次がない");
  let best = first;
  for (const row of daily) if (row.equity < best.equity) best = row;
  return { usd: best.equity, date: best.date };
}

/** One $1.90 per position, plus cash dividends that are not a position. */
export function netWithDividends(trades: readonly { pnlUsd: number; sells: number }[], dividends: number): number {
  const sum = trades.reduce((total, trade) => total + trade.pnlUsd + 0.7 * trade.sells - 1.9, 0) + dividends;
  return Math.round(sum * 100) / 100;
}

export type YearUplift = { year: string; from: string; to: string; upliftUsd: number; upliftFrac: number };

export type Round14Side = {
  totalUsd: number;
  totalNetUsd: number;
  stockUsd: number;
  soxxUsd: number;
  stockN: number;
  soxxN: number;
  mtmDdUsd: number;
  lowUsd: number;
  lowDate: string;
};

export type Round14Cell = {
  universe: "core" | "pit" | "adv";
  window: "oos" | "in";
  baseline: Round14Side;
  parked: Round14Side & {
    parkPriceUsd: number;
    parkDivUsd: number;
    parkUsd: number;
    sellN: number;
    cycles: number;
    feesUsd: number;
    bilSessions: number;
  };
  upliftUsd: number;
  upliftNetUsd: number;
  upliftFrac: number;
  upliftNetFrac: number;
  years: YearUplift[];
};

export type Round14Report = {
  v: 1;
  prereg: string;
  rulesCommit: string;
  generatedAt: string;
  cells: Round14Cell[];
};
