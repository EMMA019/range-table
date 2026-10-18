import type { Book, Candidate, Feat, NameSeries } from "./backtest-study";
import { ROUND_TRIP_FEE, nearEarnings, type MarketDay } from "./backtest-study";
import { aboveBoxTop } from "./round4";
import { gapVoids } from "./round3";
import { pathMarks } from "./round10";
import { totalNet190 } from "./round8";
import { planRound7Exit, planRound7TargetOrTimeout, type ExitBar } from "./round7";
import { ttmAt, type ConceptFacts } from "./round4";
import { BAND_HIGH_PCT, BAND_LOW_PCT } from "./morning";
import { paperShares, atrPct, spyMa20Allows, applyRound7C, boxLinePrice } from "./round16";
import { THEME_KEEP } from "./study-theme-lists";

/** Pre-registration commit (includes variant C exit comparison). Results must cite this. */
export const ROUND17_PREREG = "200b35f8189439abbce3671e58b0a18bdfb37e1e";

export const LINE_PCTS = [25, 35] as const;
export type BuyLinePct = (typeof LINE_PCTS)[number];
export type Round17Window = "in" | "oos";

export const WINDOW_BOUNDS: Record<Round17Window, { from: string; to: string }> = {
  oos: { from: "2022-10-03", to: "2024-10-02" },
  in: { from: "2024-10-03", to: "2026-10-02" },
};

/** Variant C windows (see prereg amendment 2026-10-04). */
export type Round17ExitCWindow = "live" | "in";
export const EXIT_C_WINDOW_BOUNDS: Record<Round17ExitCWindow, { from: string; to: string }> = {
  live: { from: "2026-07-30", to: "2026-10-02" },
  in: WINDOW_BOUNDS.in,
};
export type Round17ExitCVariantId = "exit-c0" | "exit-c1-20" | "exit-c1-40";
export const DEEP_UNDERWATER_USD = 30;

export const PRICE_MAX = 550;
export const ATR_MIN_PCT = 3;
export const AI_DC_GROUP_IDS = new Set(["semi", "equipment", "network", "server", "cloud", "power"]);

export const PROFIT_DROP_FLAG = 0.15;
export const MIN_TRADES_FRAC = 0.7;

export type Round17VariantId =
  | "baseline"
  | "no-spy"
  | "spy-soxx-all"
  | `soxx-semi-${2 | 3}`
  | `soxx-all-${2 | 3}`
  | "exit-risk30"
  | `crash-${number}`
  | `stab-${2 | 3}`
  | "ai-dc-cap"
  | `semi-box-${5 | 10 | 20}`;

export type SoxxMode = "off" | "semi" | "all";

export type SignalFilters = {
  crashK?: number;
  stabN?: 2 | 3;
  requireSpy?: boolean;
  soxx?: SoxxMode;
  soxxN?: 2 | 3;
};

export type SoxxDay = { c: number; ma20: number | null };

export type SoxxByDate = ReadonlyMap<string, SoxxDay>;

export const PAPER_RISK_NET_USD = 30;

export function positionKey(ticker: string, pct: BuyLinePct): string {
  return `${ticker}-L${pct}`;
}

export function inLiveBand(boxPct: number | null): boolean {
  return boxPct != null && Number.isFinite(boxPct) && boxPct >= BAND_LOW_PCT && boxPct <= BAND_HIGH_PCT;
}

export function touchAtLine(feat: Feat, line: number): boolean {
  return feat.l <= line;
}

export function crashBlocksFirstBuy(feats: Feat[], index: number, k: number): boolean {
  const sig = feats[index];
  if (sig.atr == null || !(sig.atr > 0)) return true;
  const start = Math.max(0, index - 4);
  let high5 = sig.h;
  for (let j = start; j < index; j += 1) high5 = Math.max(high5, feats[j].h);
  return high5 - sig.c >= k * sig.atr;
}

export function recentLow10(feats: readonly Feat[], index: number): number {
  const start = Math.max(0, index - 9);
  let low = feats[index].l;
  for (let j = start; j <= index; j += 1) low = Math.min(low, feats[j].l);
  return low;
}

export function buildSoxxByDate(soxx: readonly Feat[]): SoxxByDate {
  const out = new Map<string, SoxxDay>();
  for (let i = 0; i < soxx.length; i += 1) {
    const bar = soxx[i];
    let ma20: number | null = null;
    if (i >= 19) {
      let sum = 0;
      for (let j = i - 19; j <= i; j += 1) sum += soxx[j].c;
      ma20 = Math.round((sum / 20) * 10000) / 10000;
    }
    out.set(bar.date, { c: bar.c, ma20 });
  }
  return out;
}

export function soxxMa20Allows(soxxByDate: SoxxByDate, signalDate: string): boolean {
  const row = soxxByDate.get(signalDate);
  if (!row || row.ma20 == null || !(row.ma20 > 0)) return false;
  return row.c >= row.ma20;
}

export function soxxStabilizationOk(soxx: readonly Feat[], signalDate: string, n: 2 | 3): boolean {
  const index = soxx.findIndex((bar) => bar.date === signalDate);
  if (index < 0) return false;
  return stabilizationOk(soxx as Feat[], index, n);
}

export function soxxEntryAllows(
  soxx: readonly Feat[],
  soxxByDate: SoxxByDate,
  signalDate: string,
  n: 2 | 3,
): boolean {
  return soxxMa20Allows(soxxByDate, signalDate) && soxxStabilizationOk(soxx, signalDate, n);
}

export function stabilizationOk(feats: readonly Feat[], index: number, n: 2 | 3): boolean {
  const recentLow = recentLow10(feats, index);
  for (let back = 0; back < n; back += 1) {
    const j = index - back;
    if (j < 0) return false;
    if (feats[j].c <= recentLow) return false;
  }
  return true;
}

export function dollarStopPrice(entry: number, boxLow: number, qty: number): { effective: number; dollarLed: boolean } {
  const dollarStop = entry - (PAPER_RISK_NET_USD + ROUND_TRIP_FEE) / qty;
  const effective = Math.max(boxLow, dollarStop);
  return { effective, dollarLed: effective > boxLow + 1e-9 };
}

export function applyRound7C1NoStop(
  cand: Candidate,
  feats: readonly Feat[],
  qty: number,
  targetHigh: number | null,
  maxHold: number,
): Candidate {
  const bars: ExitBar[] = feats.map((bar) => ({ date: bar.date, o: bar.o, h: bar.h, l: bar.l, c: bar.c }));
  const plan = planRound7TargetOrTimeout({
    bars,
    entryIndex: cand.entryIndex,
    target: targetHigh,
    qty,
    maxHold,
  });
  if (!plan) throw new Error(`出口がない ${cand.ticker} ${cand.entryDate}`);
  const reason = plan.reason === "target" ? "target" : plan.reason === "timeout" ? "timeout" : plan.reason === "window" ? "window" : "stop";
  return {
    ...cand,
    exitIndex: plan.exitIndex,
    exitDate: plan.exitDate,
    exit: plan.exit,
    exitTiming: plan.timing,
    reason,
    voided: gapVoids(
      bars.map((bar) => bar.c),
      cand.entryIndex,
      plan.exitIndex,
    ),
    round7Legs: plan.legs.map(({ date, timing, qty: shares, price, reason: legReason }) => ({
      date,
      timing,
      qty: shares,
      price,
      reason: legReason,
    })),
  };
}

export function applyRound7CWithStop(
  cand: Candidate,
  feats: readonly Feat[],
  qty: number,
  stop: number,
  targetHigh?: number | null,
  maxHold?: number,
): Candidate {
  if (!Number.isFinite(stop)) throw new Error(`損切りがない ${cand.ticker} ${cand.entryDate}`);
  const bars: ExitBar[] = feats.map((bar) => ({ date: bar.date, o: bar.o, h: bar.h, l: bar.l, c: bar.c }));
  const plan = planRound7Exit({
    variant: "C",
    bars,
    entryIndex: cand.entryIndex,
    atr: cand.atr,
    stop,
    high20: targetHigh ?? feats[cand.signalIndex]?.high20 ?? null,
    qty,
    maxHold,
  });
  if (!plan) throw new Error(`出口がない ${cand.ticker} ${cand.entryDate}`);
  const reason = plan.reason === "target" ? "target" : plan.reason === "timeout" ? "timeout" : plan.reason === "window" ? "window" : "stop";
  return {
    ...cand,
    exitIndex: plan.exitIndex,
    exitDate: plan.exitDate,
    exit: plan.exit,
    exitTiming: plan.timing,
    reason,
    voided: gapVoids(
      bars.map((bar) => bar.c),
      cand.entryIndex,
      plan.exitIndex,
    ),
    round7Legs: plan.legs.map(({ date, timing, qty: shares, price, reason: legReason }) => ({
      date,
      timing,
      qty: shares,
      price,
      reason: legReason,
    })),
  };
}

export function generateLiveBandSignals(args: {
  name: NameSeries;
  from: string;
  to: string;
  sessions: readonly string[];
  spyByDate: ReadonlyMap<string, { c: number; ma20: number | null }>;
  soxx?: readonly Feat[];
  soxxByDate?: SoxxByDate;
  market: ReadonlyMap<string, MarketDay>;
  earningsBlock: boolean;
  concepts: ConceptFacts | null;
  filters?: SignalFilters;
  exitRisk30?: boolean;
  exitNoStop?: boolean;
  exitMaxHold?: number;
  /** When true, every candidate is marked bucket-heavy (AI DC cap variant). */
  allBucketHeavy?: boolean;
}): Candidate[] {
  const { name, from, to, sessions, spyByDate, market, concepts } = args;
  const feats = name.feats;
  const out: Candidate[] = [];
  const after: Record<BuyLinePct, string> = { 25: from, 35: from };
  const filters = args.filters ?? {};
  const requireSpy = filters.requireSpy !== false;
  const soxxMode = filters.soxx ?? "off";
  const soxxN = filters.soxxN ?? 2;
  const soxxFeats = args.soxx ?? [];
  const soxxByDate = args.soxxByDate ?? new Map<string, SoxxDay>();

  for (let i = 0; i < feats.length - 1; i += 1) {
    const sig = feats[i];
    if (sig.date < from || sig.date > to) continue;
    if (sig.gapWarning || sig.atr == null || !(sig.atr > 0) || sig.low20 == null || sig.high20 == null || sig.boxPct == null) continue;
    if (sig.c > PRICE_MAX) continue;
    if (atrPct(sig.atr, sig.c) < ATR_MIN_PCT) continue;
    if (!inLiveBand(sig.boxPct)) continue;
    if (requireSpy && !spyMa20Allows(spyByDate, sig.date)) continue;
    const useSoxx = soxxMode === "all" || (soxxMode === "semi" && name.semi);
    if (useSoxx && !soxxEntryAllows(soxxFeats, soxxByDate, sig.date, soxxN)) continue;
    if (args.earningsBlock && nearEarnings([...sessions], sig.date, name.earnings)) continue;
    if (name.ticker !== THEME_KEEP && ttmAt(concepts, sig.date).status === "negative") continue;

    for (const pct of LINE_PCTS) {
      if (sig.date < after[pct]) continue;
      const line = boxLinePrice(sig.low20, sig.high20, pct);
      if (!touchAtLine(sig, line)) continue;
      if (pct === 25 && filters.crashK != null && crashBlocksFirstBuy(feats, i, filters.crashK)) continue;
      if (filters.stabN != null && !stabilizationOk(feats, i, filters.stabN)) continue;

      const entryIndex = i + 1;
      const entryBar = feats[entryIndex];
      if (!entryBar || entryBar.date > to) continue;
      const entry = entryBar.o;
      const stop = sig.low20;
      if (aboveBoxTop(entry, sig.high20)) continue;
      const qty = paperShares(entry, stop);
      if (qty == null) continue;
      const day = market.get(sig.date);
      const rs20 = day && sig.ret20 != null && day.spyRet20 != null ? sig.ret20 - day.spyRet20 : null;
      let cand: Candidate = {
        ticker: name.ticker,
        sector: name.sector,
        semi: name.semi,
        signalIndex: i,
        entryIndex,
        exitIndex: entryIndex,
        signalDate: sig.date,
        entryDate: entryBar.date,
        exitDate: entryBar.date,
        entry,
        exit: entry,
        atr: sig.atr,
        atrPct: atrPct(sig.atr, sig.c),
        boxPct: sig.boxPct,
        rebound: sig.rebound,
        rs20,
        qty10: 0,
        reason: "window",
        exitTiming: "close",
        voided: false,
        stop,
        positionKey: positionKey(name.ticker, pct),
        bucketHeavy: args.allBucketHeavy === true || (name as NameSeries & { aiDc?: boolean }).aiDc === true || name.semi,
      };
      if (args.exitNoStop) {
        cand = applyRound7C1NoStop(cand, feats, qty, sig.high20, args.exitMaxHold ?? 20);
      } else if (args.exitRisk30) {
        const { effective, dollarLed } = dollarStopPrice(entry, stop, qty);
        cand = applyRound7CWithStop(cand, feats, qty, effective);
        if (dollarLed) (cand as Candidate & { dollarStopLed?: boolean }).dollarStopLed = true;
      } else {
        cand = applyRound7C(cand, feats, qty);
      }
      if (cand.voided) {
        after[pct] = sessionAfter(sessions, cand.exitDate) ?? to;
        continue;
      }
      out.push(cand);
      after[pct] = sessionAfter(sessions, cand.exitDate) ?? to;
    }
  }
  return out;
}

function sessionAfter(sessions: readonly string[], date: string): string | null {
  const idx = sessions.indexOf(date);
  if (idx < 0 || idx + 1 >= sessions.length) return null;
  return sessions[idx + 1];
}

export type Round17Row = {
  id: Round17VariantId;
  window: Round17Window;
  trades: number;
  winRate: number | null;
  totalNet190Usd: number;
  avgNet190Usd: number | null;
  mtmDdUsd: number;
  maxConsecLosses: number;
  stopOutRate: number | null;
  lowDate: string;
  lowUsd: number;
  engineTotalUsd: number;
};

export function scoreRound17Book(book: Book, id: Round17VariantId, window: Round17Window): Round17Row {
  const fills = book.fills ?? [];
  const trades = fills.map((fill) => {
    const legs = fill.legs ?? [];
    const last = legs[legs.length - 1];
    return {
      pnlUsd: fill.pnlUsd,
      sells: legs.length || 1,
      reason: (last?.reason === "stop" ? "stop" : last?.reason === "target" ? "target" : "window") as "stop" | "target" | "window",
    };
  });
  const pnls = trades.map((trade) => trade.pnlUsd);
  const wins = pnls.filter((pnl) => pnl > 0).length;
  const stops = trades.filter((trade) => trade.reason === "stop").length;
  const daily = book.daily;
  if (!daily) throw new Error(`日足がない ${id} ${window}`);
  const path = pathMarks(daily);
  const net = totalNet190(trades);
  return {
    id,
    window,
    trades: trades.length,
    winRate: trades.length ? Math.round((wins / trades.length) * 10000) / 10000 : null,
    totalNet190Usd: net,
    avgNet190Usd: trades.length ? Math.round((net / trades.length) * 100) / 100 : null,
    mtmDdUsd: book.maxDrawdownUsd,
    maxConsecLosses: book.maxConsecLosses,
    stopOutRate: trades.length ? Math.round((stops / trades.length) * 10000) / 10000 : null,
    lowDate: path.lowDate,
    lowUsd: path.lowUsd,
    engineTotalUsd: book.totalUsd,
  };
}

export type PassVerdict =
  | { kind: "pass" }
  | { kind: "fail"; reasons: string[] }
  | { kind: "flag-profit"; reasons: string[] }
  | { kind: "descriptive" };

export type Round17ExitCRow = {
  id: Round17ExitCVariantId;
  window: Round17ExitCWindow;
  trades: number;
  totalNet190Usd: number;
  mtmDdUsd: number;
  maxConsecLosses: number;
  worstOpenDrawdownUsd: number;
  deepUnderwaterTimeouts: number;
};

export function scoreExitCRow(
  book: Book,
  cands: readonly Candidate[],
  featsByTicker: ReadonlyMap<string, readonly Feat[]>,
  id: Round17ExitCVariantId,
  window: Round17ExitCWindow,
): Round17ExitCRow {
  const fills = book.fills ?? [];
  const trades = fills.map((fill) => {
    const legs = fill.legs ?? [];
    return { pnlUsd: fill.pnlUsd, sells: legs.length || 1 };
  });
  const net = totalNet190(trades);
  const candByKey = new Map(cands.map((c) => [`${c.ticker}|${c.entryDate}`, c]));
  let worstOpen = 0;
  let deepTimeouts = 0;
  for (const fill of fills) {
    const cand = candByKey.get(`${fill.ticker}|${fill.entryDate}`);
    if (!cand) continue;
    const feats = featsByTicker.get(fill.ticker);
    const sized = fill.qty ?? paperShares(cand.entry, cand.stop ?? Number.NaN);
    if (sized == null || !(sized > 0) || !feats) continue;
    const qty = sized;
    const entry = cand.entry;
    let peak = 0;
    for (let j = cand.entryIndex; j <= cand.exitIndex && j < feats.length; j += 1) {
      const underwater = Math.max(0, (entry - feats[j].l) * qty);
      if (underwater > peak) peak = underwater;
    }
    if (peak > worstOpen) worstOpen = peak;
    if (id !== "exit-c0" && cand.reason === "timeout") {
      const mtmLoss = Math.max(0, (entry - cand.exit) * qty);
      if (mtmLoss > DEEP_UNDERWATER_USD) deepTimeouts += 1;
    }
  }
  return {
    id,
    window,
    trades: trades.length,
    totalNet190Usd: net,
    mtmDdUsd: book.maxDrawdownUsd,
    maxConsecLosses: book.maxConsecLosses,
    worstOpenDrawdownUsd: Math.round(worstOpen * 100) / 100,
    deepUnderwaterTimeouts: deepTimeouts,
  };
}

export function passVerdictExitC(c0: Round17ExitCRow, variant: Round17ExitCRow): PassVerdict {
  const reasons: string[] = [];
  if (variant.mtmDdUsd > c0.mtmDdUsd + 1e-9) reasons.push("max_dd");
  if (variant.maxConsecLosses > c0.maxConsecLosses) reasons.push("max_consec_losses");
  if (variant.trades < Math.floor(c0.trades * MIN_TRADES_FRAC)) reasons.push("trade_count");
  const profitDrop =
    c0.totalNet190Usd > 0 && variant.totalNet190Usd < c0.totalNet190Usd * (1 - PROFIT_DROP_FLAG);
  if (reasons.length) return { kind: "fail", reasons };
  if (profitDrop) return { kind: "flag-profit", reasons: ["profit_drop_15pct"] };
  return { kind: "pass" };
}

export function passVerdict(baseline: Round17Row, variant: Round17Row): PassVerdict {
  if (variant.id.startsWith("semi-box-")) return { kind: "descriptive" };
  if (variant.id === "no-spy") return { kind: "descriptive" };
  const reasons: string[] = [];
  if (variant.mtmDdUsd > baseline.mtmDdUsd + 1e-9) reasons.push("max_dd");
  if (variant.maxConsecLosses > baseline.maxConsecLosses) reasons.push("max_consec_losses");
  if (variant.trades < Math.floor(baseline.trades * MIN_TRADES_FRAC)) reasons.push("trade_count");
  const profitDrop =
    baseline.totalNet190Usd > 0 &&
    variant.totalNet190Usd < baseline.totalNet190Usd * (1 - PROFIT_DROP_FLAG);
  if (reasons.length) return { kind: "fail", reasons };
  if (profitDrop) return { kind: "flag-profit", reasons: ["profit_drop_15pct"] };
  return { kind: "pass" };
}

export function pickCrashK(rows: readonly Round17Row[]): number | null {
  const oos = rows.filter((row) => row.window === "oos" && String(row.id).startsWith("crash-"));
  if (!oos.length) return null;
  const sorted = [...oos].sort((a, b) => b.totalNet190Usd - a.totalNet190Usd);
  const best = sorted[0];
  const match = /^crash-(.+)$/.exec(String(best.id));
  return match ? Number(match[1]) : null;
}

export function boxAtWindow(feats: Feat[], index: number, window: number): { low: number; high: number; boxPct: number } | null {
  if (index < window - 1) return null;
  let low = feats[index].l;
  let high = feats[index].h;
  for (let j = index - window + 1; j <= index; j += 1) {
    low = Math.min(low, feats[j].l);
    high = Math.max(high, feats[j].h);
  }
  const range = high - low;
  const boxPct = range <= 0 ? 0 : ((feats[index].c - low) / range) * 100;
  return { low, high, boxPct };
}

/** Semis only: N-day box window, same portfolio exit as baseline. */
export function generateSemiBoxSignals(args: {
  name: NameSeries;
  boxWindow: 5 | 10 | 20;
  from: string;
  to: string;
  sessions: readonly string[];
  spyByDate: ReadonlyMap<string, { c: number; ma20: number | null }>;
  market: ReadonlyMap<string, MarketDay>;
  earningsBlock: boolean;
  concepts: ConceptFacts | null;
}): Candidate[] {
  const { name, boxWindow, from, to, sessions, spyByDate, market, concepts } = args;
  if (!name.semi) return [];
  const feats = name.feats;
  const out: Candidate[] = [];
  const after: Record<BuyLinePct, string> = { 25: from, 35: from };
  for (let i = 0; i < feats.length - 1; i += 1) {
    const sig = feats[i];
    if (sig.date < from || sig.date > to) continue;
    const box = boxAtWindow(feats, i, boxWindow);
    if (!box) continue;
    if (sig.gapWarning || sig.atr == null || !(sig.atr > 0)) continue;
    if (sig.c > PRICE_MAX) continue;
    if (atrPct(sig.atr, sig.c) < ATR_MIN_PCT) continue;
    if (!inLiveBand(box.boxPct)) continue;
    if (!spyMa20Allows(spyByDate, sig.date)) continue;
    if (args.earningsBlock && nearEarnings([...sessions], sig.date, name.earnings)) continue;
    if (name.ticker !== THEME_KEEP && ttmAt(concepts, sig.date).status === "negative") continue;
    const high20 = box.high;
    const low20 = box.low;
    for (const pct of LINE_PCTS) {
      if (sig.date < after[pct]) continue;
      const line = boxLinePrice(low20, high20, pct);
      if (!touchAtLine(sig, line)) continue;
      const entryIndex = i + 1;
      const entryBar = feats[entryIndex];
      if (!entryBar || entryBar.date > to) continue;
      const entry = entryBar.o;
      const stop = low20;
      if (aboveBoxTop(entry, high20)) continue;
      const qty = paperShares(entry, stop);
      if (qty == null) continue;
      const day = market.get(sig.date);
      const rs20 = day && sig.ret20 != null && day.spyRet20 != null ? sig.ret20 - day.spyRet20 : null;
      let cand: Candidate = {
        ticker: name.ticker,
        sector: name.sector,
        semi: name.semi,
        signalIndex: i,
        entryIndex,
        exitIndex: entryIndex,
        signalDate: sig.date,
        entryDate: entryBar.date,
        exitDate: entryBar.date,
        entry,
        exit: entry,
        atr: sig.atr,
        atrPct: atrPct(sig.atr, sig.c),
        boxPct: box.boxPct,
        rebound: sig.rebound,
        rs20,
        qty10: 0,
        reason: "window",
        exitTiming: "close",
        voided: false,
        stop,
        positionKey: positionKey(name.ticker, pct),
        bucketHeavy: name.semi,
      };
      cand = applyRound7CWithStop(cand, feats, qty, stop, high20);
      if (cand.voided) {
        after[pct] = sessionAfter(sessions, cand.exitDate) ?? to;
        continue;
      }
      out.push(cand);
      after[pct] = sessionAfter(sessions, cand.exitDate) ?? to;
    }
  }
  return out;
}

export function pickSoxxN(rows: readonly Round17Row[]): 2 | 3 {
  const oos = rows.filter((row) => row.window === "oos" && (row.id === "soxx-all-2" || row.id === "soxx-all-3"));
  if (oos.length < 2) return 2;
  const n2 = oos.find((row) => row.id === "soxx-all-2");
  const n3 = oos.find((row) => row.id === "soxx-all-3");
  if (!n2 || !n3) return 2;
  if (n3.totalNet190Usd > n2.totalNet190Usd) return 3;
  return 2;
}

/** Descriptive: semis touching the 25% line under common filters (no portfolio). */
export function countSemiTouches(
  names: readonly (NameSeries & { aiDc?: boolean })[],
  boxWindow: 5 | 10 | 20,
  from: string,
  to: string,
  sessions: readonly string[],
  spyByDate: ReadonlyMap<string, { c: number; ma20: number | null }>,
  market: ReadonlyMap<string, MarketDay>,
  conceptsOf: ReadonlyMap<string, ConceptFacts | null>,
  earningsBlock: boolean,
): number {
  let count = 0;
  for (const name of names) {
    if (!name.semi) continue;
    const feats = name.feats;
    const concepts = conceptsOf.get(name.ticker) ?? null;
    for (let i = 0; i < feats.length - 1; i += 1) {
      const sig = feats[i];
      if (sig.date < from || sig.date > to) continue;
      const box = boxAtWindow(feats, i, boxWindow);
      if (!box) continue;
      if (sig.gapWarning || sig.atr == null || !(sig.atr > 0)) continue;
      if (sig.c > PRICE_MAX) continue;
      if (atrPct(sig.atr, sig.c) < ATR_MIN_PCT) continue;
      if (!inLiveBand(box.boxPct)) continue;
      if (!spyMa20Allows(spyByDate, sig.date)) continue;
      if (earningsBlock && nearEarnings([...sessions], sig.date, name.earnings)) continue;
      if (name.ticker !== THEME_KEEP && ttmAt(concepts, sig.date).status === "negative") continue;
      const line = box.low + 0.25 * (box.high - box.low);
      if (sig.l <= line) count += 1;
    }
  }
  return count;
}

export function summarizeJa(rows: readonly Round17Row[], crashK: number | null, excludedUnion: string[]): string {
  const baseIn = rows.find((row) => row.id === "baseline" && row.window === "in");
  const parts: string[] = [];
  if (baseIn) {
    parts.push(
      `基準（2024-26）: ${baseIn.trades}回、$1.90純益 ${baseIn.totalNet190Usd.toFixed(2)}、DD ${baseIn.mtmDdUsd.toFixed(2)}、連敗 ${baseIn.maxConsecLosses}`,
    );
  }
  if (crashK != null) parts.push(`急落フィルタは2022-24で k=${crashK} を採用`);
  parts.push(`テーマ除外 ${excludedUnion.length} 銘柄（宇宙は SPCX 以外、暗号は CORZ 等）`);
  return parts.join("。");
}

export type Round17Report = {
  v: 1;
  prereg: string;
  generatedAt: string;
  excluded: {
    solar: string[];
    crypto: string[];
    nuclear: string[];
    quantum: string[];
    space: string[];
    spaceWatchlist: string[];
    union: string[];
  };
  universe: {
    watchlist: number;
    afterFilters: number;
    f1Unknown: string[];
    themeDropped: number;
    financialsDropped: number;
  };
  rows: Round17Row[];
  crashKPick: number | null;
  soxxNPick: 2 | 3;
  verdicts: Array<{ id: Round17VariantId; window: Round17Window; verdict: PassVerdict }>;
  exitC?: Round17ExitCRow[];
  exitCVerdicts?: Array<{ id: Round17ExitCVariantId; window: Round17ExitCWindow; verdict: PassVerdict }>;
  emmaLiveReference?: { returnPct: number; maxDrawdownPct: number; note: string };
  summaryJa: string;
  diagnostics?: Record<string, unknown>;
};
