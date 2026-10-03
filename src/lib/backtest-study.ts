import { computeQuote, sharesForMove } from "./compute";
import { CHART_SESSIONS, GAP_THRESHOLD } from "./constants";
import { legSplit, scaleActions, type ScaleAction } from "./scale-exit";
import type { Bar, EntrySignal } from "./types";

/**
 * Weekend study of the range pattern and a few other books.
 * Indicators on bar i use bars up to i only. Entries fill at the next open.
 * Nothing here runs on the server; scripts/backtest-study.ts writes the JSON.
 */

export const STUDY_FROM = "2024-10-03";
export const STUDY_TO = "2026-10-02";
export const YEAR2_FROM = "2025-10-03";
export const START_CAPITAL = 3200;
export const POSITION_MIN = 300;
export const POSITION_MAX = 450;
export const MAX_POSITIONS = 5;
export const ROUND_TRIP_FEE = 0.7;
export const BROAD_PRICE_MAX = 550;
export const BROAD_DOLLAR_MIN = 5_000_000;

export type Feat = {
  date: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  atr: number | null;
  low20: number | null;
  high20: number | null;
  priorHigh20: number | null;
  boxPct: number | null;
  line15: number | null;
  mid: number | null;
  rebound: number | null;
  entrySignal: EntrySignal | null;
  gapWarning: boolean;
  avgDollar20: number | null;
  ma5: number | null;
  ma50: number | null;
  ma200: number | null;
  rsi2: number | null;
  ret10: number | null;
  ret20: number | null;
  ret40: number | null;
  ret60: number | null;
  ret63: number | null;
  down3: boolean;
  /** Open ÷ previous close − 1. Null on the first bar. */
  gapPct: number | null;
  bullish: boolean;
};

const round = (n: number, digits = 2) => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

/** Rolling features. Bar i does not read past i. */
export function buildFeatures(bars: Bar[]): Feat[] {
  const out: Feat[] = new Array(bars.length);
  let sum5 = 0;
  let sum50 = 0;
  let sum200 = 0;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < bars.length; i += 1) {
    const bar = bars[i];
    const c = bar.c;
    sum5 += c;
    sum50 += c;
    sum200 += c;
    if (i >= 5) sum5 -= bars[i - 5].c;
    if (i >= 50) sum50 -= bars[i - 50].c;
    if (i >= 200) sum200 -= bars[i - 200].c;

    let rsi2: number | null = null;
    if (i === 2) {
      let g = 0;
      let l = 0;
      for (let k = 1; k <= 2; k += 1) {
        const ch = bars[k].c - bars[k - 1].c;
        if (ch >= 0) g += ch;
        else l -= ch;
      }
      avgGain = g / 2;
      avgLoss = l / 2;
    } else if (i > 2) {
      const ch = c - bars[i - 1].c;
      avgGain = (avgGain + Math.max(ch, 0)) / 2;
      avgLoss = (avgLoss + Math.max(-ch, 0)) / 2;
    }
    if (i >= 2) {
      if (avgLoss === 0) rsi2 = avgGain === 0 ? null : 100;
      else rsi2 = 100 - 100 / (1 + avgGain / avgLoss);
    }

    const window = bars.slice(Math.max(0, i + 1 - CHART_SESSIONS), i + 1);
    const quote = computeQuote(window);
    const ok = quote.ok ? quote.quote : null;
    const prev = i > 0 ? bars[i - 1].c : null;
    out[i] = {
      date: bar.date,
      o: bar.o,
      h: bar.h,
      l: bar.l,
      c,
      v: bar.v,
      atr: ok ? ok.atr14 : null,
      low20: ok ? ok.low20 : null,
      high20: ok ? ok.high20 : null,
      priorHigh20: ok ? ok.priorHigh20 : null,
      boxPct: ok ? ok.boxPct : null,
      line15: ok ? ok.line15 : null,
      mid: ok ? round((ok.low20 + ok.high20) / 2, 4) : null,
      rebound: ok ? ok.reboundDays : null,
      entrySignal: ok ? ok.entrySignal : null,
      gapWarning: ok ? ok.gapWarning : false,
      avgDollar20: ok ? ok.avgDollarVolume20 : null,
      ma5: i >= 4 ? sum5 / 5 : null,
      ma50: i >= 49 ? sum50 / 50 : null,
      ma200: i >= 199 ? sum200 / 200 : null,
      rsi2,
      ret10: i >= 10 && bars[i - 10].c > 0 ? c / bars[i - 10].c - 1 : null,
      ret20: i >= 20 && bars[i - 20].c > 0 ? c / bars[i - 20].c - 1 : null,
      ret40: i >= 40 && bars[i - 40].c > 0 ? c / bars[i - 40].c - 1 : null,
      ret60: i >= 60 && bars[i - 60].c > 0 ? c / bars[i - 60].c - 1 : null,
      ret63: i >= 63 && bars[i - 63].c > 0 ? c / bars[i - 63].c - 1 : null,
      down3: i >= 3 && c < bars[i - 1].c && bars[i - 1].c < bars[i - 2].c && bars[i - 2].c < bars[i - 3].c,
      gapPct: prev != null && prev > 0 ? bar.o / prev - 1 : null,
      bullish: bar.c > bar.o,
    };
  }
  return out;
}

/** Drop sessions after `to`. Earlier bars stay so moving averages are already warm. */
export function clipTo(feats: Feat[], to = STUDY_TO): Feat[] {
  let end = feats.length;
  while (end > 0 && feats[end - 1].date > to) end -= 1;
  return end === feats.length ? feats : feats.slice(0, end);
}

export type MarketDay = {
  spyClose: number;
  spyMa50: number | null;
  spyMa200: number | null;
  spyRet10: number | null;
  spyRet20: number | null;
  spyRet40: number | null;
  spyRet60: number | null;
  soxxClose: number | null;
  soxxMa50: number | null;
  soxxMa200: number | null;
};

export function marketByDate(spy: Feat[], soxx: Feat[]): Map<string, MarketDay> {
  const sx = new Map(soxx.map((bar) => [bar.date, bar]));
  const map = new Map<string, MarketDay>();
  for (const bar of spy) {
    const other = sx.get(bar.date);
    map.set(bar.date, {
      spyClose: bar.c,
      spyMa50: bar.ma50,
      spyMa200: bar.ma200,
      spyRet10: bar.ret10,
      spyRet20: bar.ret20,
      spyRet40: bar.ret40,
      spyRet60: bar.ret60,
      soxxClose: other?.c ?? null,
      soxxMa50: other?.ma50 ?? null,
      soxxMa200: other?.ma200 ?? null,
    });
  }
  return map;
}

/** Whole shares whose cost lands in [$300, $450]. Null when no integer lot fits. */
export function sharesForBudget(price: number, min = POSITION_MIN, max = POSITION_MAX): number | null {
  if (!(price > 0) || price > max) return null;
  const qty = Math.floor(max / price);
  if (qty < 1) return null;
  if (qty * price < min) return null;
  return qty;
}

export function tradingDistance(sessions: string[], signalDate: string, eventDate: string): number | null {
  const sig = sessions.indexOf(signalDate);
  if (sig < 0) return null;
  let ev = sessions.indexOf(eventDate);
  if (ev < 0) {
    ev = sessions.findIndex((date) => date >= eventDate);
    if (ev < 0) return null;
  }
  return Math.abs(ev - sig);
}

export function nearEarnings(sessions: string[], signalDate: string, events: readonly string[], within = 5): boolean {
  for (const event of events) {
    const distance = tradingDistance(sessions, signalDate, event);
    if (distance != null && distance <= within) return true;
  }
  return false;
}

export type ExitReason = "target" | "stop" | "timeout" | "sharp" | "ma" | "window";
export type ExitTiming = "open" | "intraday" | "close";

export type Candidate = {
  ticker: string;
  sector: string;
  semi: boolean;
  signalIndex: number;
  entryIndex: number;
  exitIndex: number;
  signalDate: string;
  entryDate: string;
  exitDate: string;
  entry: number;
  exit: number;
  atr: number;
  atrPct: number;
  boxPct: number | null;
  rebound: number | null;
  rs20: number | null;
  rs10?: number | null;
  rs40?: number | null;
  rs60?: number | null;
  /** Stop known on the signal day. The box rule uses that day's 20-day low. */
  stop?: number | null;
  /** ceil($10 / ATR). 0 when this candidate is not a $10-sized range trade. */
  qty10: number;
  reason: ExitReason;
  exitTiming: ExitTiming;
  /** A 35% gap between entry and exit. The day is consumed and the trade is not scored. */
  voided: boolean;
  /**
   * Scale-out planned at the signal. Prices at or below the entry are already null.
   * The walker sells the midpoint half and the top remainder, and ignores the single exit above.
   */
  scale?: ScalePlan;
};

export type ScalePlan = {
  mid: number | null;
  top: number | null;
  stop: number | null;
  /** Close of entryIndex + 5. Null when this row has no day-5 check or that session does not exist. */
  timeStopDate: string | null;
  /** Close of entryIndex + 20, clipped to the last bar of the series. */
  maxHoldDate: string;
};

export type DayQuote = { o: number; h: number; c: number };

type ExitSpec = {
  target: number | null;
  /** Drop the trade when the next open is already through the target. */
  skipIfOpenThrough: boolean;
  sharp: boolean;
  stopClose: number | null;
  /** After the entry day, an open below the stop fills at that open. */
  gapThroughStop?: boolean;
  trail: boolean;
  exitMa5: boolean;
  maxHold: number | null;
  /** When set, a trade still open on this bar sells at that close. Earlier target and stop fills stand. */
  forceExitIndex?: number | null;
};

function gapInside(feats: Feat[], from: number, to: number): boolean {
  for (let k = Math.max(1, from); k <= to; k += 1) {
    if (feats[k - 1].c > 0 && Math.abs(feats[k].c / feats[k - 1].c - 1) >= GAP_THRESHOLD) return true;
  }
  return false;
}

function simulate(feats: Feat[], signalIndex: number, spec: ExitSpec, qty10: number, meta: Pick<Candidate, "ticker" | "sector" | "semi">, rs20: number | null): Candidate | null {
  const sig = feats[signalIndex];
  const entryIndex = signalIndex + 1;
  if (entryIndex >= feats.length) return null;
  const entryBar = feats[entryIndex];
  const entry = entryBar.o;
  const atr = sig.atr ?? 0;
  if (!(entry > 0)) return null;
  if ((spec.trail || spec.sharp) && !(atr > 0)) return null;
  if (spec.skipIfOpenThrough && spec.target != null && entry >= spec.target) return null;

  const finish = (exitIndex: number, exit: number, reason: ExitReason, exitTiming: ExitTiming): Candidate => ({
    ...meta,
    signalIndex,
    entryIndex,
    exitIndex,
    signalDate: sig.date,
    entryDate: entryBar.date,
    exitDate: feats[exitIndex].date,
    entry,
    exit,
    atr,
    atrPct: atr > 0 && sig.c > 0 ? (atr / sig.c) * 100 : 0,
    boxPct: sig.boxPct,
    rebound: sig.rebound,
    rs20,
    qty10,
    reason,
    exitTiming,
    voided: gapInside(feats, entryIndex, exitIndex),
  });

  if (spec.trail) {
    let peak = entry;
    let stop = entry - atr;
    for (let j = entryIndex; j < feats.length; j += 1) {
      const bar = feats[j];
      if (bar.l <= stop) {
        const gap = bar.o <= stop;
        return finish(j, gap ? bar.o : stop, "stop", gap && j > entryIndex ? "open" : "intraday");
      }
      if (bar.c > peak) {
        peak = bar.c;
        stop = peak - atr;
      }
      if (spec.maxHold != null && j === entryIndex + spec.maxHold) return finish(j, bar.c, "timeout", "close");
    }
    const last = feats.length - 1;
    return finish(last, feats[last].c, "window", "close");
  }

  const holdEnd = spec.maxHold == null ? feats.length - 1 : Math.min(feats.length - 1, entryIndex + spec.maxHold);
  const lastIndex = spec.forceExitIndex != null && spec.forceExitIndex >= entryIndex ? Math.min(holdEnd, spec.forceExitIndex) : holdEnd;
  for (let j = entryIndex; j <= lastIndex; j += 1) {
    const bar = feats[j];
    if (spec.target != null && j > entryIndex && bar.o >= spec.target) return finish(j, bar.o, "target", "open");
    if (spec.gapThroughStop && spec.stopClose != null && j > entryIndex && bar.o < spec.stopClose) return finish(j, bar.o, "stop", "open");
    if (spec.target != null && bar.h >= spec.target) return finish(j, spec.target, "target", "intraday");
    if (spec.exitMa5 && bar.ma5 != null && bar.c > bar.ma5) return finish(j, bar.c, "ma", "close");
    if (spec.sharp && bar.c >= feats[j - 1].c + atr) return finish(j, bar.c, "sharp", "close");
    if (spec.stopClose != null && bar.c < spec.stopClose) return finish(j, bar.c, "stop", "close");
    if (spec.forceExitIndex != null && j === spec.forceExitIndex) return finish(j, bar.c, "window", "close");
    if (spec.maxHold != null && j === entryIndex + spec.maxHold) return finish(j, bar.c, "timeout", "close");
  }
  if (spec.maxHold != null && lastIndex < entryIndex + spec.maxHold) {
    return finish(lastIndex, feats[lastIndex].c, "window", "close");
  }
  return finish(lastIndex, feats[lastIndex].c, spec.maxHold == null ? "window" : "timeout", "close");
}

export type Band = "above15" | "in_ok" | "upto35" | "upto50";
export type StopMode = "low20" | "half" | "none";
export type MarketFilter = "none" | "spy50" | "spy200" | "soxx50" | "soxx200";

export type RangeRules = {
  id: string;
  label: string;
  minRebound: number;
  band: Band;
  atrMin: number | null;
  /** Inclusive. Null means no cap. */
  atrMax: number | null;
  /** ATR multiple. Null means no fixed target. */
  tp: number | null;
  sharp: boolean;
  stop: StopMode;
  maxHold: number;
  market: MarketFilter;
  earnings: boolean;
  priceMax: number | null;
  dollarMin: number | null;
  semisOnly: boolean;
  /** Open below the signal stop fills at that open, after the entry day. */
  gapThroughStop: boolean;
};

export const BASE_RULES: RangeRules = {
  id: "base",
  label: "基準（反発≥1・終値≥15%線・利確1ATR・20日安値・20営業日）",
  minRebound: 1,
  band: "above15",
  atrMin: null,
  atrMax: null,
  tp: 1,
  sharp: false,
  stop: "low20",
  maxHold: 20,
  market: "none",
  earnings: false,
  priceMax: null,
  dollarMin: null,
  semisOnly: false,
  gapThroughStop: false,
};

export function withRules(patch: Partial<RangeRules> & Pick<RangeRules, "id" | "label">): RangeRules {
  return { ...BASE_RULES, ...patch };
}

export type NameSeries = {
  ticker: string;
  sector: string;
  semi: boolean;
  core: boolean;
  broad: boolean;
  feats: Feat[];
  earnings: readonly string[];
};

function marketAllows(rules: RangeRules, semi: boolean, day: MarketDay | undefined): boolean {
  if (rules.market === "spy50" && !(day && day.spyMa50 != null && day.spyClose > day.spyMa50)) return false;
  if (rules.market === "spy200" && !(day && day.spyMa200 != null && day.spyClose > day.spyMa200)) return false;
  if (rules.market === "soxx50" && semi && !(day && day.soxxMa50 != null && day.soxxClose != null && day.soxxClose > day.soxxMa50)) return false;
  if (rules.market === "soxx200" && semi && !(day && day.soxxMa200 != null && day.soxxClose != null && day.soxxClose > day.soxxMa200)) return false;
  return true;
}

function isRangeBar(
  feat: Feat,
  rules: RangeRules,
  semi: boolean,
  day: MarketDay | undefined,
  sessions: string[],
  earnings: readonly string[],
  from = STUDY_FROM,
  to = STUDY_TO,
): boolean {
  if (feat.date < from || feat.date > to) return false;
  if (rules.semisOnly && !semi) return false;
  if (feat.gapWarning || feat.atr == null || !(feat.atr > 0) || feat.low20 == null || feat.line15 == null || feat.boxPct == null) return false;
  if ((feat.rebound ?? 0) < rules.minRebound) return false;
  if (!(feat.c >= feat.line15)) return false;
  if (rules.band === "in_ok" && feat.entrySignal !== "in_ok") return false;
  if (rules.band === "upto35" && !(feat.boxPct <= 35)) return false;
  if (rules.band === "upto50" && !(feat.boxPct <= 50)) return false;
  const atrPct = (feat.atr / feat.c) * 100;
  if (rules.atrMin != null && atrPct < rules.atrMin) return false;
  if (rules.atrMax != null && atrPct > rules.atrMax) return false;
  if (rules.priceMax != null && feat.c > rules.priceMax) return false;
  if (rules.dollarMin != null && !(feat.avgDollar20 != null && feat.avgDollar20 >= rules.dollarMin)) return false;
  if (!marketAllows(rules, semi, day)) return false;
  if (rules.earnings && nearEarnings(sessions, feat.date, earnings)) return false;
  return true;
}

function excess(stock: number | null, spy: number | null | undefined): number | null {
  if (stock == null || spy == null) return null;
  return stock - spy;
}

export function rangeCandidates(
  name: NameSeries,
  rules: RangeRules,
  market: Map<string, MarketDay>,
  sessions: string[],
  bounds?: { from: string; to: string },
  forceExitOn?: (entryDate: string) => string | null,
  stopAt?: (feat: Feat) => number | null,
): Candidate[] {
  const from = bounds?.from ?? STUDY_FROM;
  const to = bounds?.to ?? STUDY_TO;
  const { feats } = name;
  const out: Candidate[] = [];
  const indexOf = forceExitOn ? new Map(feats.map((bar, index) => [bar.date, index])) : null;
  for (let i = 0; i < feats.length - 1; i += 1) {
    const feat = feats[i];
    if (!isRangeBar(feat, rules, name.semi, market.get(feat.date), sessions, name.earnings, from, to)) continue;
    const sized = sharesForMove(feat.atr, feats[i + 1].o);
    if (sized.shares10 == null) continue;
    const stopClose = stopAt
      ? stopAt(feat)
      : rules.stop === "low20"
        ? feat.low20
        : rules.stop === "half"
          ? (feat.low20 as number) - 0.5 * (feat.atr as number)
          : null;
    const day = market.get(feat.date);
    const rs20 = excess(feat.ret20, day?.spyRet20);
    const trade = simulate(
      feats,
      i,
      {
        target: rules.tp == null ? null : feats[i + 1].o + rules.tp * (feat.atr as number),
        skipIfOpenThrough: false,
        sharp: rules.sharp,
        stopClose,
        gapThroughStop: rules.gapThroughStop,
        trail: false,
        exitMa5: false,
        maxHold: rules.maxHold,
        forceExitIndex: forceExitOn ? (indexOf?.get(forceExitOn(feats[i + 1].date) ?? "") ?? null) : null,
      },
      sized.shares10,
      { ticker: name.ticker, sector: name.sector, semi: name.semi },
      rs20,
    );
    if (trade && trade.entryDate <= to) {
      trade.stop = stopClose;
      trade.rs10 = excess(feat.ret10, day?.spyRet10);
      trade.rs40 = excess(feat.ret40, day?.spyRet40);
      trade.rs60 = excess(feat.ret60, day?.spyRet60);
      out.push(trade);
    }
  }
  return out;
}

/** One open position per ticker, same resume point as runTicker. */
export function takeOneAtATime(cands: Candidate[]): { trades: Candidate[]; open: number } {
  const byTicker = new Map<string, Candidate[]>();
  for (const cand of cands) {
    const list = byTicker.get(cand.ticker);
    if (list) list.push(cand);
    else byTicker.set(cand.ticker, [cand]);
  }
  const trades: Candidate[] = [];
  let open = 0;
  for (const list of byTicker.values()) {
    list.sort((a, b) => a.signalIndex - b.signalIndex);
    let resume = -1;
    for (const cand of list) {
      if (cand.signalIndex < resume) continue;
      if (cand.reason === "window") {
        open += 1;
        break;
      }
      resume = Math.max(cand.exitIndex, cand.signalIndex + 1);
      if (!cand.voided) trades.push(cand);
    }
  }
  return { trades, open };
}

export type StudyStats = {
  n: number;
  winRate: number | null;
  avgUsd: number | null;
  profitFactor: number | null;
  maxConsecLosses: number;
  /** Peak-to-trough of closed P&L in exit-date order, starting at 0. Not a cash-account drawdown. */
  maxDrawdownUsd: number;
  totalUsd: number;
  avgHold: number | null;
  targets: number;
  stops: number;
  timeouts: number;
  sharps: number;
};

export function statsOf(trades: Array<{ exitDate: string; ticker: string; pnlUsd: number; hold: number; reason: ExitReason }>): StudyStats {
  const n = trades.length;
  let grossWin = 0;
  let grossLoss = 0;
  let total = 0;
  let hold = 0;
  let wins = 0;
  let targets = 0;
  let stops = 0;
  let timeouts = 0;
  let sharps = 0;
  for (const trade of trades) {
    total += trade.pnlUsd;
    hold += trade.hold;
    if (trade.pnlUsd > 0) {
      wins += 1;
      grossWin += trade.pnlUsd;
    } else grossLoss -= trade.pnlUsd;
    if (trade.reason === "target") targets += 1;
    else if (trade.reason === "stop") stops += 1;
    else if (trade.reason === "timeout") timeouts += 1;
    else if (trade.reason === "sharp") sharps += 1;
  }
  const ordered = [...trades].sort((a, b) => a.exitDate.localeCompare(b.exitDate) || a.ticker.localeCompare(b.ticker));
  let equity = 0;
  let peak = 0;
  let maxDd = 0;
  let streak = 0;
  let worst = 0;
  for (const trade of ordered) {
    equity += trade.pnlUsd;
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, peak - equity);
    streak = trade.pnlUsd > 0 ? 0 : streak + 1;
    worst = Math.max(worst, streak);
  }
  return {
    n,
    winRate: n ? round(wins / n, 4) : null,
    avgUsd: n ? round(total / n) : null,
    profitFactor: grossLoss > 0 ? round(grossWin / grossLoss) : null,
    maxConsecLosses: worst,
    maxDrawdownUsd: round(maxDd),
    totalUsd: round(total),
    avgHold: n ? round(hold / n, 1) : null,
    targets,
    stops,
    timeouts,
    sharps,
  };
}

function pnl10(cand: Candidate): number {
  return cand.qty10 * (cand.exit - cand.entry) - ROUND_TRIP_FEE;
}

export type Row = {
  id: string;
  label: string;
  rawSignals: number;
  signalsPerWeek: number | null;
  open: number;
  stats: StudyStats;
  year1: StudyStats;
  year2: StudyStats;
};

function weeksOf(sessions: number): number {
  return sessions / 5;
}

export function rowFrom(id: string, label: string, cands: Candidate[], sessionCount: number): Row {
  const { trades, open } = takeOneAtATime(cands);
  const scored = trades.map((trade) => ({
    exitDate: trade.exitDate,
    ticker: trade.ticker,
    pnlUsd: pnl10(trade),
    hold: trade.exitIndex - trade.entryIndex,
    reason: trade.reason,
    entryDate: trade.entryDate,
  }));
  const y1 = scored.filter((trade) => trade.entryDate < YEAR2_FROM);
  const y2 = scored.filter((trade) => trade.entryDate >= YEAR2_FROM);
  const weeks = weeksOf(sessionCount);
  return {
    id,
    label,
    rawSignals: cands.filter((cand) => !cand.voided).length,
    signalsPerWeek: weeks > 0 ? round(cands.filter((cand) => !cand.voided).length / weeks, 2) : null,
    open,
    stats: statsOf(scored),
    year1: statsOf(y1),
    year2: statsOf(y2),
  };
}

export type Rank = "ticker" | "atr" | "box" | "rs";

export type Book = {
  id: string;
  label: string;
  universe: string;
  rank: Rank | "none";
  n: number;
  winRate: number | null;
  avgUsd: number | null;
  profitFactor: number | null;
  maxConsecLosses: number;
  totalUsd: number;
  maxDrawdownUsd: number;
  /** Daily equity with open positions carried at cost. Absent on the original study JSON. */
  realizedDrawdownUsd?: number;
  endEquity: number;
  worstMonth: string | null;
  worstMonthUsd: number | null;
  daysRealized10: number;
  exitDays: number;
  daysMtm10: number;
  sessions: number;
  rawSignals: number;
  signalsPerWeek: number | null;
  takenPerWeek: number | null;
  skippedPrice: number;
  skippedSlot: number;
  skippedCash: number;
  year1: StudyStats;
  year2: StudyStats;
  restartYear1: YearRestart;
  restartYear2: YearRestart;
  equity: Array<{ month: string; equity: number }>;
  skippedSemi?: number;
  fills?: Array<{ ticker: string; pnlUsd: number; entryDate: string; exitDate: string; qty?: number; riskUsd?: number | null }>;
  daily?: Array<{ date: string; equity: number; realizedEquity: number }>;
  /** Cash after the session's fills. Present only when the book asked for it. */
  exposure?: { investedFraction: number | null; daysOpenShare: number | null };
};

export type YearRestart = {
  n: number;
  totalUsd: number;
  maxDrawdownUsd: number;
  realizedDrawdownUsd?: number;
  daysRealized10: number;
};

const EMPTY_RESTART: YearRestart = { n: 0, totalUsd: 0, maxDrawdownUsd: 0, realizedDrawdownUsd: 0, daysRealized10: 0 };

type CloseMap = Map<string, Map<string, number>>;

function closesOf(names: NameSeries[]): CloseMap {
  const map: CloseMap = new Map();
  for (const name of names) {
    const days = new Map<string, number>();
    for (const bar of name.feats) days.set(bar.date, bar.c);
    map.set(name.ticker, days);
  }
  return map;
}

function rankCompare(rank: Rank) {
  return (a: Candidate, b: Candidate) => {
    if (rank === "atr" && b.atrPct !== a.atrPct) return b.atrPct - a.atrPct;
    if (rank === "box" && (a.boxPct ?? 999) !== (b.boxPct ?? 999)) return (a.boxPct ?? 999) - (b.boxPct ?? 999);
    if (rank === "rs") {
      if (a.rs20 == null && b.rs20 != null) return 1;
      if (a.rs20 != null && b.rs20 == null) return -1;
      if (a.rs20 != null && b.rs20 != null && a.rs20 !== b.rs20) return b.rs20 - a.rs20;
    }
    return a.ticker.localeCompare(b.ticker);
  };
}

type OpenPos = {
  cand: Candidate;
  qty: number;
  exit: number;
  exitDate: string;
  exitTiming: ExitTiming;
  reason: ExitReason;
  halfLeft: number;
  restLeft: number;
  pnl: number;
};

type WalkFill = {
  exitDate: string;
  ticker: string;
  pnlUsd: number;
  hold: number;
  reason: ExitReason;
  entryDate: string;
  qty: number;
  riskUsd: number | null;
};

function riskDollars(qty: number, entry: number, stop: number | null | undefined): number | null {
  if (stop == null || !Number.isFinite(stop)) return null;
  const risk = qty * (entry - stop);
  return Number.isFinite(risk) ? risk : null;
}

export type PortfolioOpts = {
  id: string;
  label: string;
  universe: string;
  rank: Rank | "none";
  sessions: string[];
  /** When set, a position still open on the last session is sold at that close. */
  flatten: boolean;
  capital?: number;
  maxPositions?: number;
  withRestart?: boolean;
  /** Restart boundary. Defaults to the in-sample year-2 start. */
  yearSplit?: string;
  /** Replaces the named rank when more than one signal falls on the same open. */
  order?: (list: Candidate[]) => void;
  /** At most this many semiconductor or equipment names among the open slots. */
  maxSemi?: number;
  /**
   * At most this many non-semiconductor slots. Omitted means no jab cap, so existing
   * books keep the same fills. A skip increments skippedSemi, the same counter as maxSemi.
   */
  maxNonSemi?: number;
  /** Below starting capital, cap the book at 2 slots and 1 new buy. */
  throttleBelowStart?: boolean;
  /** Replaces the $300–$450 lot. Null skips the name. */
  size?: (cand: Candidate, morningEquity: number) => number | null;
  /**
   * Per-order commission. When omitted, the entry is free and the exit pays the flat round trip,
   * which is the published book. Round 2 passes IBKR fixed on both orders.
   */
  orderFee?: (qty: number, price: number) => number;
  keepFills?: boolean;
  /** Adds the filled share count and initial dollar risk to each fill. */
  keepRisk?: boolean;
  keepDaily?: boolean;
  /** Opens, highs, and closes for a scale-out. Ignored when no candidate carries a scale plan. */
  quotes?: Map<string, Map<string, DayQuote>>;
  /** Average invested fraction and the share of sessions still holding a position at the close. */
  keepExposure?: boolean;
  closes: CloseMap;
};

export function runPortfolio(opts: PortfolioOpts, cands: Candidate[]): Book {
  return bookFrom(opts, cands);
}

function bookFrom(opts: PortfolioOpts, cands: Candidate[]): Book {
  const full = walkBook(opts, cands);
  const split = opts.yearSplit ?? YEAR2_FROM;
  const y1Sessions = opts.sessions.filter((date) => date < split);
  const y2Sessions = opts.sessions.filter((date) => date >= split);
  const restart = (sessions: string[]): YearRestart => {
    if (!opts.withRestart || sessions.length === 0) return EMPTY_RESTART;
    const walked = walkBook({ ...opts, sessions, flatten: true, withRestart: false, keepFills: false, keepDaily: false }, cands);
    return {
      n: walked.n,
      totalUsd: walked.totalUsd,
      maxDrawdownUsd: walked.maxDrawdownUsd,
      realizedDrawdownUsd: walked.realizedDrawdownUsd,
      daysRealized10: walked.daysRealized10,
    };
  };
  return { ...full, restartYear1: restart(y1Sessions), restartYear2: restart(y2Sessions) };
}

function walkBook(opts: PortfolioOpts, cands: Candidate[]): Book {
  const sessions = opts.sessions;
  const last = sessions[sessions.length - 1] ?? "";
  const first = sessions[0] ?? "";
  const usable = cands.filter((cand) => !cand.voided && cand.entryDate >= first && cand.entryDate <= last);
  const byEntry = new Map<string, Candidate[]>();
  for (const cand of usable) {
    const list = byEntry.get(cand.entryDate);
    if (list) list.push(cand);
    else byEntry.set(cand.entryDate, [cand]);
  }
  const cmp = rankCompare(opts.rank === "none" ? "ticker" : opts.rank);
  for (const list of byEntry.values()) {
    if (opts.order) opts.order(list);
    else list.sort(cmp);
  }

  const capital = opts.capital ?? START_CAPITAL;
  const maxPositions = opts.maxPositions ?? MAX_POSITIONS;
  let settled = capital;
  const pending: Array<{ date: string; amount: number }> = [];
  const positions: OpenPos[] = [];
  const fills: WalkFill[] = [];
  let skippedPrice = 0;
  let skippedSlot = 0;
  let skippedCash = 0;
  let skippedSemi = 0;
  const sessionIndex = new Map(sessions.map((date, index) => [date, index]));
  const equityPath: number[] = [];
  const realizedPath: number[] = [];
  const cashRatios: number[] = [];
  let openDays = 0;
  const daily: Array<{ date: string; equity: number; realizedEquity: number }> = [];
  const nextSession = new Map<string, string>();
  for (let i = 0; i < sessions.length - 1; i += 1) nextSession.set(sessions[i], sessions[i + 1]);

  const release = (date: string) => {
    let i = 0;
    while (i < pending.length) {
      if (pending[i].date <= date) {
        settled += pending[i].amount;
        pending.splice(i, 1);
      } else i += 1;
    }
  };

  const creditSale = (date: string, amount: number) => {
    const when = nextSession.get(date);
    if (!when) settled += amount;
    else pending.push({ date: when, amount });
  };

  const closePx = (ticker: string, date: string, fallback: number) => opts.closes.get(ticker)?.get(date) ?? fallback;

  const exitFee = (qty: number, price: number) => (opts.orderFee ? opts.orderFee(qty, price) : ROUND_TRIP_FEE);
  const entryFee = (qty: number, price: number) => (opts.orderFee ? opts.orderFee(qty, price) : 0);
  const markedQty = (pos: OpenPos) => (pos.cand.scale ? pos.halfLeft + pos.restLeft : pos.qty);
  const sell = (pos: OpenPos, date: string, price: number, reason: ExitReason) => {
    const proceeds = pos.qty * price - exitFee(pos.qty, price);
    creditSale(date, proceeds);
    const entryI = sessionIndex.get(pos.cand.entryDate) ?? 0;
    const exitI = sessionIndex.get(date) ?? entryI;
    fills.push({
      exitDate: date,
      ticker: pos.cand.ticker,
      pnlUsd: pos.qty * (price - pos.cand.entry) - entryFee(pos.qty, pos.cand.entry) - exitFee(pos.qty, price),
      hold: exitI - entryI,
      reason,
      entryDate: pos.cand.entryDate,
      qty: pos.qty,
      riskUsd: riskDollars(pos.qty, pos.cand.entry, pos.cand.stop),
    });
  };
  const quoteOf = (ticker: string, date: string): DayQuote | null => opts.quotes?.get(ticker)?.get(date) ?? null;
  const finishScale = (pos: OpenPos, date: string) => {
    const entryI = sessionIndex.get(pos.cand.entryDate) ?? 0;
    const exitI = sessionIndex.get(date) ?? entryI;
    fills.push({
      exitDate: date,
      ticker: pos.cand.ticker,
      pnlUsd: pos.pnl,
      hold: exitI - entryI,
      reason: pos.reason,
      entryDate: pos.cand.entryDate,
      qty: pos.qty,
      riskUsd: riskDollars(pos.qty, pos.cand.entry, pos.cand.scale?.stop ?? pos.cand.stop),
    });
  };
  const applyScale = (pos: OpenPos, date: string, actions: ScaleAction[]) => {
    for (const action of actions) {
      const qty = action.qty === "half" ? pos.halfLeft : action.qty === "rest" ? pos.restLeft : pos.halfLeft + pos.restLeft;
      if (!(qty > 0)) continue;
      const fee = exitFee(qty, action.price);
      creditSale(date, qty * action.price - fee);
      pos.pnl += qty * (action.price - pos.cand.entry) - fee;
      pos.reason = action.reason;
      pos.exit = action.price;
      pos.exitDate = date;
      pos.exitTiming = action.timing;
      if (action.qty === "half") pos.halfLeft = 0;
      else if (action.qty === "rest") pos.restLeft = 0;
      else {
        pos.halfLeft = 0;
        pos.restLeft = 0;
      }
    }
  };
  const runScale = (pos: OpenPos, date: string, phase: "open" | "rest"): boolean => {
    const plan = pos.cand.scale;
    if (!plan) return false;
    const bar = quoteOf(pos.cand.ticker, date);
    if (!bar) return false;
    applyScale(
      pos,
      date,
      scaleActions({
        phase,
        isEntryDay: date === pos.cand.entryDate,
        open: bar.o,
        high: bar.h,
        close: bar.c,
        entry: pos.cand.entry,
        mid: plan.mid,
        top: plan.top,
        stop: plan.stop,
        halfOpen: pos.halfLeft > 0,
        restOpen: pos.restLeft > 0,
        timeStop: plan.timeStopDate === date,
        timeout: plan.maxHoldDate === date,
      }),
    );
    if (pos.halfLeft + pos.restLeft > 0) return false;
    finishScale(pos, date);
    return true;
  };

  for (let si = 0; si < sessions.length; si += 1) {
    const date = sessions[si];
    release(date);
    for (let i = positions.length - 1; i >= 0; i -= 1) {
      const pos = positions[i];
      if (pos.cand.scale) {
        if (runScale(pos, date, "open")) positions.splice(i, 1);
      } else if (pos.exitDate === date && pos.exitTiming === "open") {
        sell(pos, date, pos.exit, pos.reason);
        positions.splice(i, 1);
      }
    }
    const prevDate = si > 0 ? sessions[si - 1] : null;
    let morning = settled + pending.reduce((sum, lot) => sum + lot.amount, 0);
    for (const pos of positions) {
      const px = prevDate ? closePx(pos.cand.ticker, prevDate, pos.cand.entry) : pos.cand.entry;
      morning += markedQty(pos) * px;
    }
    const throttled = opts.throttleBelowStart === true && morning < capital - 1e-9;
    const slotCap = throttled ? Math.min(maxPositions, 2) : maxPositions;
    const newCap = throttled ? 1 : Number.POSITIVE_INFINITY;
    let opened = 0;
    let semisHeld = positions.reduce((sum, pos) => sum + (pos.cand.semi ? 1 : 0), 0);
    let nonSemiHeld = opts.maxNonSemi == null ? 0 : positions.reduce((sum, pos) => sum + (pos.cand.semi ? 0 : 1), 0);
    const todays = byEntry.get(date) ?? [];
    const held = new Set(positions.map((pos) => pos.cand.ticker));
    for (const cand of todays) {
      if (held.has(cand.ticker)) continue;
      const qty = opts.size ? opts.size(cand, morning) : sharesForBudget(cand.entry);
      if (qty == null) {
        skippedPrice += 1;
        continue;
      }
      if (opts.maxSemi != null && cand.semi && semisHeld >= opts.maxSemi) {
        skippedSemi += 1;
        continue;
      }
      if (opts.maxNonSemi != null && !cand.semi && nonSemiHeld >= opts.maxNonSemi) {
        skippedSemi += 1;
        continue;
      }
      if (positions.length >= slotCap || opened >= newCap) {
        skippedSlot += 1;
        continue;
      }
      const cost = qty * cand.entry + entryFee(qty, cand.entry);
      if (cost > settled + 1e-9) {
        skippedCash += 1;
        continue;
      }
      settled -= cost;
      held.add(cand.ticker);
      opened += 1;
      if (cand.semi) semisHeld += 1;
      else if (opts.maxNonSemi != null) nonSemiHeld += 1;
      const exitDate = cand.exitDate > last ? last : cand.exitDate;
      const forced = !cand.scale && cand.exitDate > last;
      const legs = cand.scale ? legSplit(qty, cand.scale.mid != null) : { halfLeft: 0, restLeft: 0 };
      positions.push({
        cand,
        qty,
        exit: forced ? closePx(cand.ticker, last, cand.entry) : cand.exit,
        exitDate: cand.scale ? cand.exitDate : exitDate,
        exitTiming: forced ? "close" : cand.exitTiming,
        reason: forced ? "window" : cand.reason,
        halfLeft: legs.halfLeft,
        restLeft: legs.restLeft,
        pnl: cand.scale ? -entryFee(qty, cand.entry) : 0,
      });
    }
    for (let i = positions.length - 1; i >= 0; i -= 1) {
      const pos = positions[i];
      if (pos.cand.scale) {
        if (runScale(pos, date, "rest")) positions.splice(i, 1);
      } else if (pos.exitDate === date && pos.exitTiming !== "open") {
        sell(pos, date, pos.exit, pos.reason);
        positions.splice(i, 1);
      }
    }
    if (opts.flatten && date === last) {
      for (let i = positions.length - 1; i >= 0; i -= 1) {
        const pos = positions[i];
        if (pos.cand.scale) {
          const left = pos.halfLeft + pos.restLeft;
          if (left > 0) {
            const price = closePx(pos.cand.ticker, date, pos.cand.entry);
            const fee = exitFee(left, price);
            creditSale(date, left * price - fee);
            pos.pnl += left * (price - pos.cand.entry) - fee;
            pos.reason = "window";
            pos.halfLeft = 0;
            pos.restLeft = 0;
            finishScale(pos, date);
          }
        } else {
          sell(pos, date, closePx(pos.cand.ticker, date, pos.exit), "window");
        }
        positions.splice(i, 1);
      }
    }
    const cash = settled + pending.reduce((sum, lot) => sum + lot.amount, 0);
    let marked = cash;
    let realizedEq = cash;
    for (const pos of positions) {
      const qty = markedQty(pos);
      marked += qty * closePx(pos.cand.ticker, date, pos.cand.entry);
      realizedEq += qty * pos.cand.entry;
    }
    equityPath.push(marked);
    realizedPath.push(realizedEq);
    if (opts.keepExposure) {
      if (marked > 0) cashRatios.push(cash / marked);
      if (positions.length > 0) openDays += 1;
    }
    if (opts.keepDaily) daily.push({ date, equity: round(marked), realizedEquity: round(realizedEq) });
  }

  let peak = capital;
  let maxDd = 0;
  let realizedPeak = capital;
  let realizedDd = 0;
  let daysMtm10 = 0;
  let prev = capital;
  const monthEnd = new Map<string, number>();
  for (let i = 0; i < equityPath.length; i += 1) {
    const equity = equityPath[i];
    if (equity - prev >= 10) daysMtm10 += 1;
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, peak - equity);
    const realizedEquity = realizedPath[i] ?? capital;
    realizedPeak = Math.max(realizedPeak, realizedEquity);
    realizedDd = Math.max(realizedDd, realizedPeak - realizedEquity);
    prev = equity;
    monthEnd.set(sessions[i].slice(0, 7), equity);
  }
  const months = [...monthEnd.entries()];
  let worstMonth: string | null = null;
  let worstMonthUsd: number | null = null;
  let priorEquity = capital;
  for (const [month, equity] of months) {
    const change = equity - priorEquity;
    if (worstMonthUsd == null || change < worstMonthUsd) {
      worstMonth = month;
      worstMonthUsd = change;
    }
    priorEquity = equity;
  }
  const realized = new Map<string, number>();
  for (const fill of fills) realized.set(fill.exitDate, (realized.get(fill.exitDate) ?? 0) + fill.pnlUsd);
  let daysRealized10 = 0;
  for (const pnl of realized.values()) if (pnl >= 10) daysRealized10 += 1;

  const scored = statsOf(fills);
  const weeks = weeksOf(sessions.length);
  const endEquity = equityPath.length ? equityPath[equityPath.length - 1] : capital;
  const split = opts.yearSplit ?? YEAR2_FROM;
  return {
    id: opts.id,
    label: opts.label,
    universe: opts.universe,
    rank: opts.rank,
    n: scored.n,
    winRate: scored.winRate,
    avgUsd: scored.avgUsd,
    profitFactor: scored.profitFactor,
    maxConsecLosses: scored.maxConsecLosses,
    totalUsd: round(endEquity - capital),
    maxDrawdownUsd: round(maxDd),
    realizedDrawdownUsd: round(realizedDd),
    endEquity: round(endEquity),
    worstMonth,
    worstMonthUsd: worstMonthUsd == null ? null : round(worstMonthUsd),
    daysRealized10,
    exitDays: realized.size,
    daysMtm10,
    sessions: sessions.length,
    rawSignals: usable.length,
    signalsPerWeek: weeks > 0 ? round(usable.length / weeks, 2) : null,
    takenPerWeek: weeks > 0 ? round(scored.n / weeks, 2) : null,
    skippedPrice,
    skippedSlot,
    skippedCash,
    skippedSemi,
    year1: statsOf(fills.filter((fill) => fill.entryDate < split)),
    year2: statsOf(fills.filter((fill) => fill.entryDate >= split)),
    restartYear1: { ...EMPTY_RESTART },
    restartYear2: { ...EMPTY_RESTART },
    equity: months.map(([month, equity]) => ({ month, equity: round(equity) })),
    ...(opts.keepExposure
      ? {
          exposure: {
            investedFraction: cashRatios.length ? round(1 - cashRatios.reduce((sum, value) => sum + value, 0) / cashRatios.length, 4) : null,
            daysOpenShare: sessions.length ? round(openDays / sessions.length, 4) : null,
          },
        }
      : {}),
    ...(opts.keepFills
      ? {
          fills: fills.map((fill) => ({
            ticker: fill.ticker,
            pnlUsd: round(fill.pnlUsd),
            entryDate: fill.entryDate,
            exitDate: fill.exitDate,
            ...(opts.keepRisk ? { qty: fill.qty, riskUsd: fill.riskUsd == null ? null : round(fill.riskUsd, 4) } : {}),
          })),
        }
      : {}),
    ...(opts.keepDaily ? { daily } : {}),
  };
}

export function methodCandidates(
  name: NameSeries,
  kind: MethodKind,
  market: Map<string, MarketDay>,
  bounds?: { from: string; to: string },
): Candidate[] {
  const from = bounds?.from ?? STUDY_FROM;
  const to = bounds?.to ?? STUDY_TO;
  const { feats } = name;
  const meta = { ticker: name.ticker, sector: name.sector, semi: name.semi };
  const out: Candidate[] = [];
  for (let i = 0; i < feats.length - 1; i += 1) {
    const feat = feats[i];
    if (feat.date < from || feat.date > to || feat.gapWarning) continue;
    const day = market.get(feat.date);
    const rs20 = feat.ret20 != null && day?.spyRet20 != null ? feat.ret20 - day.spyRet20 : null;
    const atr = feat.atr ?? 0;
    let spec: ExitSpec | null = null;
    if (kind === "breakout") {
      if (feat.priorHigh20 == null || !(feat.c > feat.priorHigh20) || !(atr > 0)) continue;
      spec = { target: null, skipIfOpenThrough: false, sharp: false, stopClose: null, trail: true, exitMa5: false, maxHold: null };
    } else if (kind === "pullback") {
      if (feat.ma50 == null || !(feat.c > feat.ma50) || !((feat.rsi2 != null && feat.rsi2 < 10) || feat.down3) || !(atr > 0)) continue;
      spec = { target: null, skipIfOpenThrough: false, sharp: false, stopClose: null, trail: false, exitMa5: true, maxHold: 20 };
    } else if (kind === "midpoint") {
      if ((feat.rebound ?? 0) < 1 || feat.boxPct == null || feat.boxPct > 15 || feat.mid == null || feat.low20 == null || !(atr > 0)) continue;
      spec = { target: feat.mid, skipIfOpenThrough: true, sharp: false, stopClose: feat.low20, trail: false, exitMa5: false, maxHold: 20 };
    } else if (kind === "gap") {
      const prev = i > 0 ? feats[i - 1].c : null;
      if (feat.gapPct == null || feat.gapPct > -0.02 || !feat.bullish || prev == null || feat.l <= 0) continue;
      spec = { target: prev, skipIfOpenThrough: true, sharp: false, stopClose: feat.l, trail: false, exitMa5: false, maxHold: 5 };
    } else if (kind === "oversold") {
      if (feat.rsi2 == null || feat.rsi2 >= 10 || !(atr > 0)) continue;
      spec = { target: null, skipIfOpenThrough: false, sharp: false, stopClose: null, trail: false, exitMa5: true, maxHold: 5 };
    }
    if (!spec) continue;
    const trade = simulate(feats, i, spec, 0, meta, rs20);
    if (trade && trade.entryDate <= to) out.push(trade);
  }
  return out;
}

export type MethodKind = "breakout" | "pullback" | "midpoint" | "gap" | "oversold";

function isoWeek(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/**
 * Weekly top-5 by the prior session's 63-session return. Sells settle the next session.
 * `calendar` includes warmup sessions so the first rebalance can see the previous close.
 */
export function runMomentum(names: NameSeries[], sessions: string[], _closes: CloseMap, calendar: string[] = sessions): Book {
  const rebalance = new Set<string>();
  let prevWeek = "";
  for (const date of sessions) {
    const week = isoWeek(date);
    if (week !== prevWeek) {
      rebalance.add(date);
      prevWeek = week;
    }
  }
  const byDate = new Map<string, Map<string, Feat>>();
  for (const name of names) {
    if (!name.core) continue;
    for (const bar of name.feats) {
      let day = byDate.get(bar.date);
      if (!day) {
        day = new Map();
        byDate.set(bar.date, day);
      }
      day.set(name.ticker, bar);
    }
  }
  const index = new Map(sessions.map((date, i) => [date, i]));
  const capital = START_CAPITAL;
  let settled = capital;
  const pending: Array<{ date: string; amount: number }> = [];
  const positions = new Map<string, { qty: number; entry: number; entryDate: string }>();
  const fills: Array<{ exitDate: string; ticker: string; pnlUsd: number; hold: number; reason: ExitReason; entryDate: string }> = [];
  const equityPath: number[] = [];
  const next = new Map<string, string>();
  for (let i = 0; i < sessions.length - 1; i += 1) next.set(sessions[i], sessions[i + 1]);
  let rawSignals = 0;
  let skippedPrice = 0;

  const release = (date: string) => {
    let i = 0;
    while (i < pending.length) {
      if (pending[i].date <= date) {
        settled += pending[i].amount;
        pending.splice(i, 1);
      } else i += 1;
    }
  };

  for (const date of sessions) {
    release(date);
    if (rebalance.has(date)) {
      const calIndex = calendar.indexOf(date);
      const prevDate = calIndex > 0 ? calendar[calIndex - 1] : undefined;
      const prevBars = prevDate ? byDate.get(prevDate) : undefined;
      const today = byDate.get(date);
      const ranked: Array<{ ticker: string; ret: number; open: number }> = [];
      if (prevBars && today) {
        for (const [ticker, prevBar] of prevBars) {
          if (prevBar.ret63 == null) continue;
          const bar = today.get(ticker);
          if (!bar) continue;
          ranked.push({ ticker, ret: prevBar.ret63, open: bar.o });
        }
      }
      ranked.sort((a, b) => b.ret - a.ret || a.ticker.localeCompare(b.ticker));
      rawSignals += ranked.length;
      const target: string[] = [];
      for (const row of ranked) {
        if (target.length >= MAX_POSITIONS) break;
        if (sharesForBudget(row.open) == null) {
          skippedPrice += 1;
          continue;
        }
        target.push(row.ticker);
      }
      const keep = new Set(target);
      for (const [ticker, pos] of positions) {
        if (keep.has(ticker)) continue;
        const price = today?.get(ticker)?.o ?? pos.entry;
        const when = next.get(date);
        const cash = pos.qty * price - ROUND_TRIP_FEE;
        if (when) pending.push({ date: when, amount: cash });
        else settled += cash;
        const entryI = index.get(pos.entryDate) ?? 0;
        fills.push({
          exitDate: date,
          ticker,
          pnlUsd: pos.qty * (price - pos.entry) - ROUND_TRIP_FEE,
          hold: (index.get(date) ?? entryI) - entryI,
          reason: "timeout",
          entryDate: pos.entryDate,
        });
        positions.delete(ticker);
      }
      for (const ticker of target) {
        if (positions.has(ticker) || positions.size >= MAX_POSITIONS) continue;
        const row = ranked.find((item) => item.ticker === ticker);
        if (!row) continue;
        const qty = sharesForBudget(row.open);
        if (qty == null) continue;
        const cost = qty * row.open;
        if (cost > settled + 1e-9) continue;
        settled -= cost;
        positions.set(ticker, { qty, entry: row.open, entryDate: date });
      }
    }
    let marked = settled + pending.reduce((sum, lot) => sum + lot.amount, 0);
    const today = byDate.get(date);
    for (const [ticker, pos] of positions) marked += pos.qty * (today?.get(ticker)?.c ?? pos.entry);
    equityPath.push(marked);
  }

  if (sessions.length) {
    const date = sessions[sessions.length - 1];
    const today = byDate.get(date);
    for (const [ticker, pos] of positions) {
      const price = today?.get(ticker)?.c ?? pos.entry;
      settled += pos.qty * price - ROUND_TRIP_FEE;
      const entryI = index.get(pos.entryDate) ?? 0;
      fills.push({
        exitDate: date,
        ticker,
        pnlUsd: pos.qty * (price - pos.entry) - ROUND_TRIP_FEE,
        hold: (index.get(date) ?? entryI) - entryI,
        reason: "window",
        entryDate: pos.entryDate,
      });
    }
    positions.clear();
    equityPath[equityPath.length - 1] = settled + pending.reduce((sum, lot) => sum + lot.amount, 0);
  }

  return finishPath({
    id: "momentum",
    label: "週次モメンタム（63営業日リターン上位5）",
    universe: "core",
    rank: "rs",
    sessions,
    rawSignals,
    skippedPrice,
    skippedSlot: 0,
    skippedCash: 0,
    fills,
    equityPath,
    capital,
  });
}

export function runBuyHold(id: string, label: string, feats: Feat[], from = STUDY_FROM, to = STUDY_TO): Book {
  const inWindow = feats.filter((bar) => bar.date >= from && bar.date <= to);
  const capital = START_CAPITAL;
  if (!inWindow.length) {
    return emptyBook(id, label, "benchmark", []);
  }
  const first = inWindow[0];
  const last = inWindow[inWindow.length - 1];
  const qty = Math.floor(capital / first.o);
  const cash = capital - qty * first.o;
  const equityPath = inWindow.map((bar, index) => {
    const fee = index === inWindow.length - 1 ? ROUND_TRIP_FEE : 0;
    return cash + qty * bar.c - fee;
  });
  const realizedPath = inWindow.map((bar, index) => {
    if (index === inWindow.length - 1) return cash + qty * bar.c - ROUND_TRIP_FEE;
    return cash + qty * first.o;
  });
  const pnl = qty * (last.c - first.o) - ROUND_TRIP_FEE;
  const fills = [
    {
      exitDate: last.date,
      ticker: id,
      pnlUsd: pnl,
      hold: inWindow.length - 1,
      reason: "window" as const,
      entryDate: first.date,
    },
  ];
  return finishPath({
    id,
    label,
    universe: "benchmark",
    rank: "none",
    sessions: inWindow.map((bar) => bar.date),
    rawSignals: 1,
    skippedPrice: qty > 0 ? 0 : 1,
    skippedSlot: 0,
    skippedCash: 0,
    fills,
    equityPath,
    realizedPath,
    capital,
  });
}

function emptyBook(id: string, label: string, universe: string, sessions: string[]): Book {
  return finishPath({
    id,
    label,
    universe,
    rank: "none",
    sessions,
    rawSignals: 0,
    skippedPrice: 0,
    skippedSlot: 0,
    skippedCash: 0,
    fills: [],
    equityPath: sessions.map(() => START_CAPITAL),
    capital: START_CAPITAL,
  });
}

function finishPath(args: {
  id: string;
  label: string;
  universe: string;
  rank: Rank | "none";
  sessions: string[];
  rawSignals: number;
  skippedPrice: number;
  skippedSlot: number;
  skippedCash: number;
  fills: Array<{ exitDate: string; ticker: string; pnlUsd: number; hold: number; reason: ExitReason; entryDate: string }>;
  equityPath: number[];
  realizedPath?: number[];
  capital: number;
}): Book {
  const { sessions, equityPath, fills, capital } = args;
  const realizedPath = args.realizedPath ?? equityPath.map(() => capital);
  let peak = capital;
  let maxDd = 0;
  let realizedPeak = capital;
  let realizedDd = 0;
  let daysMtm10 = 0;
  let prev = capital;
  const monthEnd = new Map<string, number>();
  for (let i = 0; i < equityPath.length; i += 1) {
    const equity = equityPath[i];
    if (equity - prev >= 10) daysMtm10 += 1;
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, peak - equity);
    const realizedEquity = realizedPath[i] ?? capital;
    realizedPeak = Math.max(realizedPeak, realizedEquity);
    realizedDd = Math.max(realizedDd, realizedPeak - realizedEquity);
    prev = equity;
    monthEnd.set(sessions[i].slice(0, 7), equity);
  }
  const months = [...monthEnd.entries()];
  let worstMonth: string | null = null;
  let worstMonthUsd: number | null = null;
  let priorEquity = capital;
  for (const [month, equity] of months) {
    const change = equity - priorEquity;
    if (worstMonthUsd == null || change < worstMonthUsd) {
      worstMonth = month;
      worstMonthUsd = change;
    }
    priorEquity = equity;
  }
  const realized = new Map<string, number>();
  for (const fill of fills) realized.set(fill.exitDate, (realized.get(fill.exitDate) ?? 0) + fill.pnlUsd);
  let daysRealized10 = 0;
  for (const pnl of realized.values()) if (pnl >= 10) daysRealized10 += 1;
  const scored = statsOf(fills);
  const weeks = weeksOf(sessions.length);
  const endEquity = equityPath.length ? equityPath[equityPath.length - 1] : capital;
  const y1Sessions = sessions.filter((date) => date < YEAR2_FROM);
  const y2Sessions = sessions.filter((date) => date >= YEAR2_FROM);
  const sliceRestart = (sub: string[]): YearRestart => {
    if (!sub.length) return { ...EMPTY_RESTART };
    const from = sub[0];
    const to = sub[sub.length - 1];
    const subFills = fills.filter((fill) => fill.entryDate >= from && fill.entryDate <= to && fill.exitDate <= to);
    const startI = sessions.indexOf(from);
    const endI = sessions.indexOf(to);
    const path = startI >= 0 && endI >= startI ? equityPath.slice(startI, endI + 1) : [];
    const base = startI > 0 ? equityPath[startI - 1] : capital;
    let p = base;
    let dd = 0;
    let days = 0;
    let previous = base;
    for (const equity of path) {
      if (equity - previous >= 10) days += 1;
      p = Math.max(p, equity);
      dd = Math.max(dd, p - equity);
      previous = equity;
    }
    const end = path.length ? path[path.length - 1] : base;
    const rpath = startI >= 0 && endI >= startI ? realizedPath.slice(startI, endI + 1) : [];
    const rbase = startI > 0 ? (realizedPath[startI - 1] ?? capital) : capital;
    let rpeak = rbase;
    let rdd = 0;
    for (const equity of rpath) {
      rpeak = Math.max(rpeak, equity);
      rdd = Math.max(rdd, rpeak - equity);
    }
    return { n: subFills.length, totalUsd: round(end - base), maxDrawdownUsd: round(dd), realizedDrawdownUsd: round(rdd), daysRealized10: days };
  };
  return {
    id: args.id,
    label: args.label,
    universe: args.universe,
    rank: args.rank,
    n: scored.n,
    winRate: scored.winRate,
    avgUsd: scored.avgUsd,
    profitFactor: scored.profitFactor,
    maxConsecLosses: scored.maxConsecLosses,
    totalUsd: round(endEquity - capital),
    maxDrawdownUsd: round(maxDd),
    realizedDrawdownUsd: round(realizedDd),
    endEquity: round(endEquity),
    worstMonth,
    worstMonthUsd: worstMonthUsd == null ? null : round(worstMonthUsd),
    daysRealized10,
    exitDays: realized.size,
    daysMtm10,
    sessions: sessions.length,
    rawSignals: args.rawSignals,
    signalsPerWeek: weeks > 0 ? round(args.rawSignals / weeks, 2) : null,
    takenPerWeek: weeks > 0 ? round(scored.n / weeks, 2) : null,
    skippedPrice: args.skippedPrice,
    skippedSlot: args.skippedSlot,
    skippedCash: args.skippedCash,
    year1: statsOf(fills.filter((fill) => fill.entryDate < YEAR2_FROM)),
    year2: statsOf(fills.filter((fill) => fill.entryDate >= YEAR2_FROM)),
    restartYear1: sliceRestart(y1Sessions),
    restartYear2: sliceRestart(y2Sessions),
    equity: months.map(([month, equity]) => ({ month, equity: round(equity) })),
  };
}

export type StudyInput = {
  names: NameSeries[];
  spy: Feat[];
  qqq: Feat[];
  soxx: Feat[];
  /** Calendar gaps in the Nasdaq earnings pull. */
  earningsGaps: number;
  earningsDays: number;
  generatedAt: string;
  broadListed: number;
  missingCore: string[];
};

export type Headline = {
  chase: "justified" | "not_justified" | "mixed" | "thin";
  chaseNote: string;
  adopted: string[];
  notStacked: string;
  methodsNote: string;
  overfitting: string;
};

export type StudyReport = {
  v: 1;
  generatedAt: string;
  period: { from: string; to: string; sessions: number; year2From: string };
  universe: {
    core: number;
    broadListed: number;
    broadWithData: number;
    liquid50: string[];
    liquidNote: string;
    missingCore: string[];
    priceMax: number;
    atrMin: number;
    dollarMin: number;
  };
  earnings: {
    tickersWithDate: number;
    knownDates: number;
    signalsWithin5: number;
    calendarDays: number;
    calendarGaps: number;
    source: string;
  };
  base: Row;
  variations: {
    atr: Row[];
    entry: Row[];
    exit: Row[];
    stop: Row[];
    market: Row[];
    rebound: Row[];
    earnings: Row[];
  };
  chaseSlices: Row[];
  sectors: Row[];
  portfolio: Book[];
  universes: Book[];
  methods: Book[];
  headline: Headline;
  biases: string[];
};

const SCREEN: RangeRules = withRules({
  id: "screen",
  label: "ATR≥3%・終値≤$550",
  atrMin: 3,
  priceMax: BROAD_PRICE_MAX,
});

const BROAD_RULES: RangeRules = withRules({
  id: "broad",
  label: "S&P500+Nasdaq-100、ATR≥3%・終値≤$550・20日平均売買代金≥$5M",
  atrMin: 3,
  priceMax: BROAD_PRICE_MAX,
  dollarMin: BROAD_DOLLAR_MIN,
});

function sliceRow(id: string, label: string, trades: Candidate[], sessionCount: number, pred: (trade: Candidate) => boolean): Row {
  const picked = trades.filter(pred);
  const scored = picked.map((trade) => ({
    exitDate: trade.exitDate,
    ticker: trade.ticker,
    pnlUsd: pnl10(trade),
    hold: trade.exitIndex - trade.entryIndex,
    reason: trade.reason,
    entryDate: trade.entryDate,
  }));
  const weeks = weeksOf(sessionCount);
  return {
    id,
    label,
    rawSignals: picked.length,
    signalsPerWeek: weeks > 0 ? round(picked.length / weeks, 2) : null,
    open: 0,
    stats: statsOf(scored),
    year1: statsOf(scored.filter((trade) => trade.entryDate < YEAR2_FROM)),
    year2: statsOf(scored.filter((trade) => trade.entryDate >= YEAR2_FROM)),
  };
}

export function improvesRow(row: Row, base: Row): boolean {
  const y1 = row.year1;
  const y2 = row.year2;
  const b1 = base.year1;
  const b2 = base.year2;
  if (y1.n < 30 || y2.n < 30) return false;
  if (y1.avgUsd == null || y2.avgUsd == null || b1.avgUsd == null || b2.avgUsd == null) return false;
  if (y1.profitFactor == null || y2.profitFactor == null) return false;
  if (y1.profitFactor < 1 || y2.profitFactor < 1) return false;
  if (!(y1.avgUsd > 0) || !(y2.avgUsd > 0)) return false;
  const worse = Math.min(y1.avgUsd - b1.avgUsd, y2.avgUsd - b2.avgUsd);
  return worse >= 0.05;
}

export function chaseFlag(ok: Row, above: Row): Headline["chase"] {
  if (ok.year1.n < 15 || ok.year2.n < 15 || above.year1.n < 15 || above.year2.n < 15) return "thin";
  const o1 = ok.year1.avgUsd;
  const o2 = ok.year2.avgUsd;
  const a1 = above.year1.avgUsd;
  const a2 = above.year2.avgUsd;
  if (o1 == null || o2 == null || a1 == null || a2 == null) return "thin";
  if (a1 >= o1 && a2 >= o2) return "not_justified";
  if (a1 < o1 && a2 < o2) return "justified";
  return "mixed";
}

function pickOne(rows: Row[], base: Row): Row | null {
  let best: Row | null = null;
  let bestMin = 0;
  for (const row of rows) {
    if (row.id === base.id || !improvesRow(row, base)) continue;
    const minAvg = Math.min(row.year1.avgUsd ?? 0, row.year2.avgUsd ?? 0);
    if (!best || minAvg > bestMin) {
      best = row;
      bestMin = minAvg;
    }
  }
  return best;
}

function liquidTickers(names: NameSeries[]): { tickers: string[]; from: string; to: string } {
  const scored: Array<{ ticker: string; med: number }> = [];
  let from = "";
  let to = "";
  for (const name of names) {
    if (!name.core) continue;
    const pre = name.feats.filter((bar) => bar.date < STUDY_FROM).slice(-63);
    if (pre.length < 40) continue;
    if (!from || pre[0].date < from) from = pre[0].date;
    if (!to || pre[pre.length - 1].date > to) to = pre[pre.length - 1].date;
    const vols = pre.map((bar) => bar.c * bar.v).sort((a, b) => a - b);
    scored.push({ ticker: name.ticker, med: vols[Math.floor(vols.length / 2)] });
  }
  scored.sort((a, b) => b.med - a.med || a.ticker.localeCompare(b.ticker));
  return { tickers: scored.slice(0, 50).map((row) => row.ticker), from, to };
}

function portfolioOf(id: string, label: string, universe: string, rank: Rank, cands: Candidate[], sessions: string[], closes: CloseMap): Book {
  return bookFrom(
    { id, label, universe, rank, sessions, flatten: true, withRestart: true, closes },
    cands,
  );
}

export function buildStudy(input: StudyInput): StudyReport {
  const spy = clipTo(input.spy);
  const qqq = clipTo(input.qqq);
  const soxx = clipTo(input.soxx);
  const names = input.names.map((name) => ({ ...name, feats: clipTo(name.feats) }));
  const sessions = spy.map((bar) => bar.date).filter((date) => date >= STUDY_FROM && date <= STUDY_TO);
  const calendar = spy.map((bar) => bar.date);
  const market = marketByDate(spy, soxx);
  const sessionCount = sessions.length;
  const core = names.filter((name) => name.core);
  const closes = closesOf(names);

  const rules = {
    atr: [
      withRules({ id: "atr_3_6", label: "ATR 3–6%", atrMin: 3, atrMax: 6 }),
      withRules({ id: "atr_4_6", label: "ATR 4–6%", atrMin: 4, atrMax: 6 }),
      withRules({ id: "atr_3_7", label: "ATR 3–7%", atrMin: 3, atrMax: 7 }),
      withRules({ id: "atr_ge3", label: "ATR ≥3%（上限なし）", atrMin: 3 }),
    ],
    entry: [
      withRules({ id: "band_in_ok", label: "15–25%（IN OK）", band: "in_ok" }),
      withRules({ id: "band_35", label: "15–35%", band: "upto35" }),
      withRules({ id: "band_50", label: "15–50%", band: "upto50" }),
      withRules({ id: "band_above15", label: "15%以上（上限なし）", band: "above15" }),
    ],
    exit: [
      withRules({ id: "tp_0.5", label: "利確 0.5 ATR", tp: 0.5 }),
      withRules({ id: "tp_1", label: "利確 1 ATR", tp: 1 }),
      withRules({ id: "tp_1.5", label: "利確 1.5 ATR", tp: 1.5 }),
      withRules({ id: "tp_2", label: "利確 2 ATR", tp: 2 }),
      withRules({ id: "sharp", label: "急騰日で全売り（前日終値+1ATR）", tp: null, sharp: true }),
      withRules({ id: "sharp_tp1", label: "利確1ATR、届かなければ急騰日で全売り", tp: 1, sharp: true }),
    ],
    stop: [
      withRules({ id: "stop_low", label: "終値が20日安値割れ", stop: "low20" }),
      withRules({ id: "stop_half", label: "終値が20日安値−0.5ATR割れ", stop: "half" }),
      withRules({ id: "stop_none", label: "損切りなし（期限のみ）", stop: "none" }),
    ],
    market: [
      withRules({ id: "spy50", label: "SPY終値 > 50日線", market: "spy50" }),
      withRules({ id: "spy200", label: "SPY終値 > 200日線", market: "spy200" }),
      withRules({ id: "soxx50", label: "半導体だけ SOXX > 50日線", market: "soxx50" }),
      withRules({ id: "soxx200", label: "半導体だけ SOXX > 200日線", market: "soxx200" }),
      withRules({ id: "semis", label: "半導体・装置のみ（地合いフィルタなし）", semisOnly: true }),
      withRules({ id: "semis_soxx50", label: "半導体・装置かつ SOXX > 50日線", market: "soxx50", semisOnly: true }),
      withRules({ id: "semis_soxx200", label: "半導体・装置かつ SOXX > 200日線", market: "soxx200", semisOnly: true }),
    ],
    rebound: [
      withRules({ id: "reb1", label: "反発 1日以上", minRebound: 1 }),
      withRules({ id: "reb2", label: "反発 2日以上", minRebound: 2 }),
      withRules({ id: "reb3", label: "反発 3日以上", minRebound: 3 }),
    ],
    earnings: [withRules({ id: "earn", label: "決算が5営業日以内のシグナルを除外（日付があるものだけ）", earnings: true })],
  };

  const cached = new Map<string, Candidate[]>();
  const candsFor = (rule: RangeRules, list: NameSeries[]) => {
    const key = `${rule.id}:${list.map((name) => name.ticker).join(",")}`;
    const hit = cached.get(key);
    if (hit) return hit;
    const all = list.flatMap((name) => rangeCandidates(name, rule, market, calendar));
    cached.set(key, all);
    return all;
  };

  const baseCands = candsFor(BASE_RULES, core);
  const base = rowFrom(BASE_RULES.id, BASE_RULES.label, baseCands, sessionCount);
  const variations = {
    atr: rules.atr.map((rule) => rowFrom(rule.id, rule.label, candsFor(rule, core), sessionCount)),
    entry: rules.entry.map((rule) => rowFrom(rule.id, rule.label, candsFor(rule, core), sessionCount)),
    exit: rules.exit.map((rule) => rowFrom(rule.id, rule.label, candsFor(rule, core), sessionCount)),
    stop: rules.stop.map((rule) => rowFrom(rule.id, rule.label, candsFor(rule, core), sessionCount)),
    market: rules.market.map((rule) => rowFrom(rule.id, rule.label, candsFor(rule, core), sessionCount)),
    rebound: rules.rebound.map((rule) => rowFrom(rule.id, rule.label, candsFor(rule, core), sessionCount)),
    earnings: rules.earnings.map((rule) => rowFrom(rule.id, rule.label, candsFor(rule, core), sessionCount)),
  };

  const { trades: baseTrades } = takeOneAtATime(baseCands);
  const chaseSlices = [
    sliceRow("box_15_25", "箱 15–25%（基準トレードの内訳）", baseTrades, sessionCount, (trade) => trade.boxPct != null && trade.boxPct >= 15 && trade.boxPct <= 25),
    sliceRow("box_25_35", "箱 25–35%", baseTrades, sessionCount, (trade) => trade.boxPct != null && trade.boxPct > 25 && trade.boxPct <= 35),
    sliceRow("box_35_50", "箱 35–50%", baseTrades, sessionCount, (trade) => trade.boxPct != null && trade.boxPct > 35 && trade.boxPct <= 50),
    sliceRow("box_above50", "箱 50%超", baseTrades, sessionCount, (trade) => trade.boxPct != null && trade.boxPct > 50),
    sliceRow("box_above25", "箱 25%超（追いかけ+遅い）", baseTrades, sessionCount, (trade) => trade.boxPct != null && trade.boxPct > 25),
  ];

  const sectorIds = [...new Set(core.map((name) => name.sector))].sort((a, b) => a.localeCompare(b, "ja"));
  const sectors = sectorIds.map((sector) =>
    sliceRow(`sector_${sector}`, sector, baseTrades, sessionCount, (trade) => trade.sector === sector),
  );

  const ranks: Rank[] = ["ticker", "atr", "box", "rs"];
  const portfolio = ranks.map((rank) =>
    portfolioOf(`port_${rank}`, `基準ルール・最大5・$${POSITION_MIN}–${POSITION_MAX}・順位 ${rank}`, "core", rank, baseCands, sessions, closes),
  );

  const screenedCore = candsFor(SCREEN, core);
  const liquid = liquidTickers(names);
  const liquidSet = new Set(liquid.tickers);
  const liquidNames = core.filter((name) => liquidSet.has(name.ticker));
  const broadNames = names.filter((name) => name.broad);
  const screenedLiquid = candsFor(SCREEN, liquidNames);
  const broadCands = candsFor(BROAD_RULES, broadNames);
  const universes: Book[] = [];
  for (const [id, label, list] of [
    ["core_screen", "186銘柄・ATR≥3%・終値≤$550", screenedCore],
    ["liquid50", "流動性上位50・ATR≥3%・終値≤$550", screenedLiquid],
    ["broad", "S&P500+Nasdaq-100・ATR≥3%・終値≤$550・売買代金", broadCands],
  ] as const) {
    for (const rank of ranks) {
      universes.push(portfolioOf(`${id}_${rank}`, `${label}・順位 ${rank}`, id, rank, list, sessions, closes));
    }
  }

  const methodList: Array<{ id: MethodKind; label: string }> = [
    { id: "breakout", label: "20日高値ブレイク + ATRトレーリング" },
    { id: "pullback", label: "上昇トレンドの押し目（終値>50日線、RSI2<10 または3日続落、終値>5日線で売る）" },
    { id: "midpoint", label: "箱の下（≤15%）で反発後に買い、箱の50%で売る" },
    { id: "gap", label: "2%以上のギャップダウン陽線の翌日、ギャップ埋めか5日" },
    { id: "oversold", label: "RSI(2)<10 の売られすぎ、終値>5日線か5日" },
  ];
  const methods: Book[] = methodList.map((method) => {
    const cands = core.flatMap((name) => methodCandidates(name, method.id, market));
    return portfolioOf(method.id, method.label, "core", "ticker", cands, sessions, closes);
  });
  const y1Last = sessions.filter((date) => date < YEAR2_FROM).at(-1) ?? STUDY_FROM;
  const y2First = sessions.find((date) => date >= YEAR2_FROM) ?? YEAR2_FROM;
  const mom = runMomentum(core, sessions, closes, calendar);
  const mom1 = runMomentum(core, sessions.filter((date) => date < YEAR2_FROM), closes, calendar);
  const mom2 = runMomentum(core, sessions.filter((date) => date >= YEAR2_FROM), closes, calendar);
  mom.restartYear1 = { n: mom1.n, totalUsd: mom1.totalUsd, maxDrawdownUsd: mom1.maxDrawdownUsd, realizedDrawdownUsd: mom1.realizedDrawdownUsd, daysRealized10: mom1.daysRealized10 };
  mom.restartYear2 = { n: mom2.n, totalUsd: mom2.totalUsd, maxDrawdownUsd: mom2.maxDrawdownUsd, realizedDrawdownUsd: mom2.realizedDrawdownUsd, daysRealized10: mom2.daysRealized10 };
  methods.push(mom);
  for (const [id, label, feats] of [
    ["spy", "SPYを口座いっぱい保有", spy],
    ["qqq", "QQQを口座いっぱい保有", qqq],
    ["soxx", "SOXXを口座いっぱい保有", soxx],
  ] as const) {
    const book = runBuyHold(id, label, feats);
    const first = runBuyHold(id, label, feats, STUDY_FROM, y1Last);
    const second = runBuyHold(id, label, feats, y2First, STUDY_TO);
    book.restartYear1 = { n: first.n, totalUsd: first.totalUsd, maxDrawdownUsd: first.maxDrawdownUsd, realizedDrawdownUsd: first.realizedDrawdownUsd, daysRealized10: first.daysRealized10 };
    book.restartYear2 = { n: second.n, totalUsd: second.totalUsd, maxDrawdownUsd: second.maxDrawdownUsd, realizedDrawdownUsd: second.realizedDrawdownUsd, daysRealized10: second.daysRealized10 };
    methods.push(book);
  }

  const adopted: string[] = [];
  const families: Array<[string, Row[], Row]> = [
    ["ATR", variations.atr, base],
    ["エントリー帯", variations.entry.filter((row) => row.id !== "band_above15"), base],
    ["利確", variations.exit.filter((row) => row.id !== "tp_1"), base],
    ["損切り", variations.stop.filter((row) => row.id !== "stop_low"), base],
    ["地合い", variations.market.filter((row) => row.id === "spy50" || row.id === "spy200"), base],
    ["反発日数", variations.rebound.filter((row) => row.id !== "reb1"), base],
    ["決算", variations.earnings, base],
  ];
  const semisBase = variations.market.find((row) => row.id === "semis");
  if (semisBase) {
    families.push(["SOXX", variations.market.filter((row) => row.id === "semis_soxx50" || row.id === "semis_soxx200"), semisBase]);
  }
  for (const [family, rows, baseline] of families) {
    const best = pickOne(rows, baseline);
    if (best) adopted.push(`${family}: ${best.label}（両年とも平均が基準より $0.05 以上高く、PF≥1、各年 n≥30）`);
  }

  const above = chaseSlices.find((row) => row.id === "box_above25");
  const band = chaseSlices.find((row) => row.id === "box_15_25");
  const chase = above && band ? chaseFlag(band, above) : "thin";
  const chaseNote =
    chase === "justified"
      ? "箱25%超は両年とも15–25%より平均が低い。追いかけを避けるラベルは、この2年では数字と合う。"
      : chase === "not_justified"
        ? "箱25%超は両年とも15–25%以上の平均。『追いかけだから悪い』と一律に捨てる根拠は弱い。"
        : chase === "mixed"
          ? "箱25%超が悪い年と悪くない年がある。追いかけ禁止は年によって過学習になる。"
          : "箱の位置ごとの件数が足りず、追いかけラベルの可否は判断しない。";

  const rangeBook = portfolio[0];
  const spyBook = methods.find((book) => book.id === "spy");
  const methodNotes: string[] = [];
  for (const book of methods) {
    if (book.universe === "benchmark" || book.id === "momentum") {
      if (book.id === "momentum") {
        const both = book.restartYear1.totalUsd > 0 && book.restartYear2.totalUsd > 0;
        methodNotes.push(
          both
            ? `週次モメンタムは年ごとに資金を戻してやり直しても両年プラス（$${book.restartYear1.totalUsd} / $${book.restartYear2.totalUsd}）。箱のジャブとは別物。`
            : `週次モメンタムは年を分けてやり直すと両年プラスにならない（$${book.restartYear1.totalUsd} / $${book.restartYear2.totalUsd}）。`,
        );
      }
      continue;
    }
    const both = book.restartYear1.totalUsd > 0 && book.restartYear2.totalUsd > 0;
    const beats = rangeBook ? book.totalUsd > rangeBook.totalUsd && book.maxDrawdownUsd <= rangeBook.maxDrawdownUsd * 1.25 + 50 : false;
    if (both && beats) methodNotes.push(`${book.label} は資金制約つきで基準ポートフォリオを上回り、両年プラス。それでもこの2年だけの結果。`);
    else if (!both) methodNotes.push(`${book.label} はどちらかの年がマイナス（$${book.restartYear1.totalUsd} / $${book.restartYear2.totalUsd}）。採用しない。`);
  }
  if (spyBook && rangeBook) {
    methodNotes.unshift(
      `同じ $${START_CAPITAL} をSPYで持ち切ると $${spyBook.totalUsd}、最大DD $${spyBook.maxDrawdownUsd}。基準ポートフォリオは $${rangeBook.totalUsd}、最大DD $${rangeBook.maxDrawdownUsd}。`,
    );
  }

  let signalsWithin5 = 0;
  let knownDates = 0;
  let tickersWithDate = 0;
  for (const name of core) {
    if (!name.earnings.length) continue;
    tickersWithDate += 1;
    knownDates += name.earnings.length;
  }
  for (const cand of baseCands) {
    const name = core.find((row) => row.ticker === cand.ticker);
    if (name && nearEarnings(calendar, cand.signalDate, name.earnings)) signalsWithin5 += 1;
  }

  const headline: Headline = {
    chase,
    chaseNote,
    adopted,
    notStacked: "採用候補は単因子で別々に測ったもの。重ねたルールの成績は測っていない。重ねるほどこの2年に寄り、次の2年で崩れやすい。",
    methodsNote: methodNotes.join(" "),
    overfitting:
      "今のウォッチリストで過去を見ている（生存・選択バイアス）。S&P500 と Nasdaq-100 は2026-10-02時点の構成。流動性上位50はテスト開始前の63営業日だけで選んだ。年を半分にしても、ルールを結果のあとから選んだ時点でサンプル内。手数料と終値の約定だけで、スリッページは無い。",
  };

  return {
    v: 1,
    generatedAt: input.generatedAt,
    period: { from: sessions[0] ?? STUDY_FROM, to: sessions[sessions.length - 1] ?? STUDY_TO, sessions: sessionCount, year2From: YEAR2_FROM },
    universe: {
      core: core.length,
      broadListed: input.broadListed,
      broadWithData: names.filter((name) => name.broad && name.feats.some((bar) => bar.date >= STUDY_FROM && bar.date <= STUDY_TO)).length,
      liquid50: liquid.tickers,
      liquidNote: liquid.from ? `${liquid.from}..${liquid.to} の売買代金中央値。テスト期間の前だけ。` : "期間前の日足が足りず選べなかった",
      missingCore: input.missingCore,
      priceMax: BROAD_PRICE_MAX,
      atrMin: 3,
      dollarMin: BROAD_DOLLAR_MIN,
    },
    earnings: {
      tickersWithDate,
      knownDates,
      signalsWithin5,
      calendarDays: input.earningsDays,
      calendarGaps: input.earningsGaps,
      source: "Nasdaq earnings calendar（取得できた日）と watchlist の決算日。日付が無いシグナルは残す。",
    },
    base,
    variations,
    chaseSlices,
    sectors,
    portfolio,
    universes,
    methods,
    headline,
    biases: [
      "生存・選択バイアス: 186銘柄は今のウォッチリスト。広いユニバースは2026-10-02時点のS&P500とNasdaq-100",
      "指標はシグナル日の終値まで。買いは翌営業日の始値。SPY/SOXXの移動平均もシグナル日まで",
      "配当は未調整。分割はYahooの調整済み",
      "利確指値は、同じ日に損切り終値より先に約定したとみなす",
      "急騰日のATRはシグナル日のATR14（単純平均）",
      "売却代金は翌セッションまで使えない（T+1の近似）",
      "1株が$300未満または$450超の銘柄はポートフォリオでは買わない",
      "決算カレンダーが取れなかった日は、その日の決算を知らないものとして残している",
      "スリッページは見ていない。手数料は往復$0.70",
      headline.overfitting,
    ],
  };
}
