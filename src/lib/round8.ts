import type { Book } from "./backtest-study";
import type { EtfEntryName, EtfReason } from "./etf-sleeve";
import { MAIN_Q, MAIN_Z, bootstrapMean, type Verdict } from "./round2";
import { SPY_BENCH, round3Verdict, type Round3Universe, type Round3Window } from "./round3";
import { ROUND7_PREREG } from "./round7";

/** Pre-registration commit. Results must cite this and must not relax the rules. */
export const ROUND8_PREREG = "4235eface3528f5e1ca4a13e1cf1d0a75742a1f5";
/** Amendment commit. The ATR exit cites this. The box exit stays on the original lock. */
export const ROUND8_AMENDMENT = "52b73ed249d46e5d3af26d61c1148af5e83397a5";
/** Second amendment. The entry grid cites this. E15 stays the published fresh cross. */
export const ROUND8_AMENDMENT2 = "54dcc909b06c22fe7e1a0c36be8aa334ee910eda";

export type EtfExitName = "box" | "atr";

/**
 * Close confirms the signal. The fill is the next session's open.
 * The entry session does not sell a target or a stop at the open.
 * After that, an open at or above the target sells at the open, and an open strictly below the stop sells at the open.
 * A high at or above the target sells at the target. A close strictly below the stop sells at the close.
 * The same bar takes the stop and does not take the target.
 */
export const ROUND8_FILL =
  "終値でシグナル、翌営業日の始値で約定。入りの日は始値で利確も損切りもしない。その後は始値が目標以上なら始値、始値が損切り未満なら始値。高値が目標以上なら目標、終値が損切り未満なら終値。同じ足は損切りが先。";

export const ROUND8_IDS = ["C", "SOXX20", "SOXX40", "SOXX60", "QQQ20", "QQQ40", "QQQ60"] as const;
export type Round8Id = (typeof ROUND8_IDS)[number];

export const ETF_REASONS = ["target", "stop", "timeout", "preempted", "window"] as const;
export type EtfExitTotals = Record<EtfReason, { n: number; pnlUsd: number }>;

const ENGINE_SELL_FEE = 0.7;
const ALT_FEE = 1.9;
const CAPITAL = 3200;

export type Round8Row = {
  id: Round8Id;
  universe: Round3Universe;
  window: Round3Window;
  /** Null on the stock book alone. */
  exit: EtfExitName | null;
  /** Null on the stock book alone. E15 is the published fresh cross. */
  entry: EtfEntryName | null;
  totalUsd: number;
  mtmDdUsd: number;
  stockUtil: number;
  etfUtil: number;
  etfPnlUsd: number;
  etfN: number;
  etfWinRate: number | null;
  etfAvgWinUsd: number | null;
  etfAvgLossUsd: number | null;
  etfNet190Usd: number;
  meanQty: number | null;
  forcedOneN: number;
  etfExits: EtfExitTotals;
  bothNegativeDays: number;
  /** Same count as bothNegativeDays: both sleeves down on the day. */
  jointLossDays: number;
  sameDayStops: number;
  totalNet190Usd: number;
  n: number;
  stockN: number;
  ratio: number | null;
  ciLow: number | null;
  nRequired: number | null;
  meanUsd: number | null;
  verdict: Verdict;
};

export type Round8Hold = {
  symbol: "SPY" | "QQQ" | "SOXX";
  window: Round3Window;
  units: number;
  pnlUsd: number;
  mtmDdUsd: number;
  pnlNet190Usd: number;
};

export type Round8Report = {
  v: 3;
  prereg: string;
  rulesCommit: string;
  amendment: string;
  amendment2: string;
  round7Commit: string;
  generatedAt: string;
  fill: string;
  spy: typeof SPY_BENCH;
  hold: Round8Hold[];
  rows: Round8Row[];
  summary: Array<{ id: "SOXX20" | "QQQ20"; pit: Verdict; adv: Verdict; verdict: Verdict }>;
};

function r2(value: number): number {
  return Math.round(value * 100) / 100;
}

function r4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export function emptyEtfExits(): EtfExitTotals {
  return {
    target: { n: 0, pnlUsd: 0 },
    stop: { n: 0, pnlUsd: 0 },
    timeout: { n: 0, pnlUsd: 0 },
    preempted: { n: 0, pnlUsd: 0 },
    window: { n: 0, pnlUsd: 0 },
  };
}

/** Engine P&L with each $0.70 sell put back, then one $1.90 round trip per position. */
export function totalNet190(trades: readonly { pnlUsd: number; sells: number }[]): number {
  const sum = trades.reduce((total, trade) => total + trade.pnlUsd + ENGINE_SELL_FEE * trade.sells - ALT_FEE, 0);
  return r2(sum);
}

/** Whole shares from the first open, marked at each close, one $0.70 fee on the last close. */
export function buyAndHold(
  sessions: readonly string[],
  bars: ReadonlyMap<string, { o: number; c: number }>,
  capital = CAPITAL,
): { shares: number; pnlUsd: number; mtmDdUsd: number; pnlNet190Usd: number } {
  if (!sessions.length) throw new Error("sessions empty");
  const first = bars.get(sessions[0]);
  if (!first || !(first.o > 0)) throw new Error(`始値がない ${sessions[0]}`);
  const shares = Math.floor(capital / first.o);
  const cash = capital - shares * first.o;
  const fee = shares > 0 ? ENGINE_SELL_FEE : 0;
  let peak = capital;
  let maxDd = 0;
  let end = capital;
  for (let i = 0; i < sessions.length; i += 1) {
    const bar = bars.get(sessions[i]);
    if (!bar) throw new Error(`終値がない ${sessions[i]}`);
    let equity = cash + shares * bar.c;
    if (i === sessions.length - 1) equity -= fee;
    end = equity;
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, peak - equity);
  }
  const pnl = end - capital;
  return {
    shares,
    pnlUsd: r2(pnl),
    mtmDdUsd: r2(maxDd),
    pnlNet190Usd: r2(shares > 0 ? pnl + fee - ALT_FEE : 0),
  };
}

export function scoreBook(
  book: Book,
  id: Round8Id,
  universe: Round3Universe,
  window: Round3Window,
  exit: EtfExitName | null,
  entry: EtfEntryName | null,
  judged: boolean,
): Round8Row {
  const stock = book.fills;
  const etf = book.etfFills;
  const sleeve = book.sleeve;
  if (!stock || !etf || !sleeve) throw new Error(`内訳がない ${id} ${universe} ${window}`);
  const exits = emptyEtfExits();
  const trades: Array<{ pnlUsd: number; sells: number }> = [];
  const pnls: number[] = [];
  for (const fill of stock) {
    const sells = fill.legs?.length || 1;
    trades.push({ pnlUsd: fill.pnlUsd, sells });
    pnls.push(fill.pnlUsd);
  }
  for (const fill of etf) {
    if (!fill.legs.length) throw new Error(`ETFの足がない ${fill.entryDate}`);
    trades.push({ pnlUsd: fill.pnlUsd, sells: fill.legs.length });
    pnls.push(fill.pnlUsd);
    for (const leg of fill.legs) {
      if (!ETF_REASONS.includes(leg.reason)) throw new Error(`ETFの理由が違う ${leg.reason}`);
      exits[leg.reason].n += 1;
      exits[leg.reason].pnlUsd += leg.pnlUsd;
    }
  }
  for (const reason of ETF_REASONS) exits[reason].pnlUsd = r2(exits[reason].pnlUsd);
  const etfWins = etf.filter((fill) => fill.pnlUsd > 0);
  const etfLosses = etf.filter((fill) => fill.pnlUsd < 0);
  const etfTrades = etf.map((fill) => ({ pnlUsd: fill.pnlUsd, sells: fill.legs.length }));
  const shareSum = etf.reduce((sum, fill) => sum + (fill.qty || fill.legs.reduce((qty, leg) => qty + leg.qty, 0)), 0);
  const boot = bootstrapMean(pnls, MAIN_Q, MAIN_Z);
  const ratio = book.maxDrawdownUsd > 0 ? r2(book.totalUsd / book.maxDrawdownUsd) : null;
  const spy = SPY_BENCH[window];
  return {
    id,
    universe,
    window,
    exit,
    entry,
    totalUsd: book.totalUsd,
    mtmDdUsd: book.maxDrawdownUsd,
    stockUtil: sleeve.stockUtil,
    etfUtil: sleeve.etfUtil,
    etfPnlUsd: r2(etf.reduce((sum, fill) => sum + fill.pnlUsd, 0)),
    etfN: etf.length,
    etfWinRate: etf.length ? r4(etfWins.length / etf.length) : null,
    etfAvgWinUsd: etfWins.length ? r2(etfWins.reduce((sum, fill) => sum + fill.pnlUsd, 0) / etfWins.length) : null,
    etfAvgLossUsd: etfLosses.length ? r2(etfLosses.reduce((sum, fill) => sum + fill.pnlUsd, 0) / etfLosses.length) : null,
    etfNet190Usd: totalNet190(etfTrades),
    meanQty: etf.length ? r2(shareSum / etf.length) : null,
    forcedOneN: etf.filter((fill) => fill.forcedOne).length,
    etfExits: exits,
    bothNegativeDays: sleeve.bothNegativeDays,
    jointLossDays: sleeve.bothNegativeDays,
    sameDayStops: sleeve.sameDayStops,
    totalNet190Usd: totalNet190(trades),
    n: pnls.length,
    stockN: stock.length,
    ratio,
    ciLow: boot.lower == null ? null : r4(boot.lower),
    nRequired: boot.nRequired == null ? null : r2(boot.nRequired),
    meanUsd: pnls.length ? r2(pnls.reduce((sum, value) => sum + value, 0) / pnls.length) : null,
    verdict: round3Verdict({
      judged,
      totalUsd: book.totalUsd,
      n: pnls.length,
      ratio,
      spyRatio: spy.ratio,
      lower: boot.lower,
      nRequired: boot.nRequired,
    }),
  };
}

export type { EtfEntryName };
export { ROUND7_PREREG, SPY_BENCH };
