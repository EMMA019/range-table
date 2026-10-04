import type { Book, Candidate, Feat, NameSeries } from "./backtest-study";
import { nearEarnings, START_CAPITAL, type MarketDay } from "./backtest-study";
import { aboveBoxTop } from "./round4";
import { gapVoids } from "./round3";
import { pathMarks } from "./round10";
import { totalNet190 } from "./round8";
import { planRound7Exit, type ExitBar } from "./round7";
import { ttmAt, type ConceptFacts } from "./round4";
import { EXCEPTION_KEEP } from "./round12";

/** Pre-registration commit. Results must cite this and must not relax the rules. */
export const ROUND16_PREREG = "e83fba0f9494556d02231535fbec48f23c804e04";

export const LINE_PCTS = [15, 25, 30, 35] as const;
export const JUDGED_PCTS = [25, 30, 35] as const;
export type LinePct = (typeof LINE_PCTS)[number];
export const FLAVORS = ["touch", "rebound"] as const;
export type LineFlavor = (typeof FLAVORS)[number];
export type Round16Window = "in" | "oos";

export const WINDOW_BOUNDS: Record<Round16Window, { from: string; to: string }> = {
  oos: { from: "2022-10-03", to: "2024-10-02" },
  in: { from: "2024-10-03", to: "2026-10-02" },
};

export const PRICE_MAX = 550;
export const ATR_MIN_PCT = 3;
export const PAPER_RISK_USD = 30;
export const PAPER_COST_CAP = 450;

export function variantId(pct: LinePct, flavor: LineFlavor): string {
  return `L${pct}-${flavor}`;
}

export function boxLinePrice(low20: number, high20: number, pct: number): number {
  return Math.round((low20 + (pct / 100) * (high20 - low20)) * 10000) / 10000;
}

/** Same formula as the morning screen and the round-16 pre-registration. */
export function paperShares(entry: number, stop: number): number | null {
  if (!(entry > 0) || !Number.isFinite(stop) || !(entry > stop)) return null;
  const risk = Math.floor(PAPER_RISK_USD / (entry - stop));
  const cap = Math.floor(PAPER_COST_CAP / entry);
  if (cap < 1) return risk >= 1 ? risk : null;
  const shares = Math.min(risk, cap);
  return shares >= 1 ? shares : null;
}

export function atrPct(atr: number, close: number): number {
  if (!(close > 0) || !Number.isFinite(atr)) return 0;
  return (atr / close) * 100;
}

export function touchQualifies(feat: Feat, line: number): boolean {
  return feat.l <= line;
}

export function reboundQualifies(feat: Feat, line: number): boolean {
  return (feat.rebound ?? 0) >= 1 && feat.l <= line && feat.c >= line;
}

export function flavorQualifies(feat: Feat, line: number, flavor: LineFlavor): boolean {
  return flavor === "touch" ? touchQualifies(feat, line) : reboundQualifies(feat, line);
}

export function spyMa20Allows(spyByDate: ReadonlyMap<string, { c: number; ma20: number | null }>, signalDate: string): boolean {
  const row = spyByDate.get(signalDate);
  if (!row || row.ma20 == null || !(row.ma20 > 0)) return false;
  return row.c >= row.ma20;
}

export function applyRound7C(cand: Candidate, feats: readonly Feat[], qty: number): Candidate {
  if (cand.stop == null || !Number.isFinite(cand.stop)) throw new Error(`損切りがない ${cand.ticker} ${cand.entryDate}`);
  const bars: ExitBar[] = feats.map((bar) => ({ date: bar.date, o: bar.o, h: bar.h, l: bar.l, c: bar.c }));
  const plan = planRound7Exit({
    variant: "C",
    bars,
    entryIndex: cand.entryIndex,
    atr: cand.atr,
    stop: cand.stop,
    high20: feats[cand.signalIndex]?.high20 ?? null,
    qty,
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
    voided: gapVoids(bars.map((bar) => bar.c), cand.entryIndex, plan.exitIndex),
    round7Legs: plan.legs.map(({ date, timing, qty: shares, price, reason: legReason }) => ({
      date,
      timing,
      qty: shares,
      price,
      reason: legReason,
    })),
  };
}

export type Round16Row = {
  id: string;
  pct: LinePct;
  flavor: LineFlavor;
  window: Round16Window;
  trades: number;
  winRate: number | null;
  totalNet190Usd: number;
  avgNet190Usd: number | null;
  mtmDdUsd: number;
  lowDate: string;
  lowUsd: number;
  engineTotalUsd: number;
};

export type Round16Verdict =
  | { kind: "candidate"; pct: LinePct; flavor: LineFlavor }
  | { kind: "confirmed"; pct: LinePct; flavor: LineFlavor }
  | { kind: "no-meaningful-difference"; flavor: LineFlavor }
  | { kind: "none"; flavor: LineFlavor; note: string };

export function scoreBook(book: Book, pct: LinePct, flavor: LineFlavor, window: Round16Window): Round16Row {
  const fills = book.fills ?? [];
  const trades = fills.map((fill) => ({
    pnlUsd: fill.pnlUsd,
    sells: fill.legs?.length || 1,
  }));
  const pnls = trades.map((trade) => trade.pnlUsd);
  const wins = pnls.filter((pnl) => pnl > 0).length;
  const daily = book.daily;
  if (!daily) throw new Error(`日足がない ${pct} ${flavor} ${window}`);
  const path = pathMarks(daily);
  const net = totalNet190(trades);
  return {
    id: variantId(pct, flavor),
    pct,
    flavor,
    window,
    trades: trades.length,
    winRate: trades.length ? Math.round((wins / trades.length) * 10000) / 10000 : null,
    totalNet190Usd: net,
    avgNet190Usd: trades.length ? Math.round((net / trades.length) * 100) / 100 : null,
    mtmDdUsd: book.maxDrawdownUsd,
    lowDate: path.lowDate,
    lowUsd: path.lowUsd,
    engineTotalUsd: book.totalUsd,
  };
}

function rowOf(rows: readonly Round16Row[], pct: LinePct, flavor: LineFlavor, window: Round16Window): Round16Row | undefined {
  return rows.find((row) => row.pct === pct && row.flavor === flavor && row.window === window);
}

/** Pre-registered decision rules. 15% is never selected. */
export function verdictForFlavor(rows: readonly Round16Row[], flavor: LineFlavor): Round16Verdict {
  const inRows = JUDGED_PCTS.map((pct) => rowOf(rows, pct, flavor, "in")).filter((row): row is Round16Row => row != null);
  if (inRows.length !== JUDGED_PCTS.length) return { kind: "none", flavor, note: "in-sample rows missing" };
  const sorted = [...inRows].sort((a, b) => b.totalNet190Usd - a.totalNet190Usd);
  const best = sorted[0];
  const second = sorted[1];
  if (best.totalNet190Usd - second.totalNet190Usd < 100) {
    return { kind: "no-meaningful-difference", flavor };
  }
  const line25 = rowOf(rows, 25, flavor, "in");
  if (!line25) return { kind: "none", flavor, note: "25% in-sample row missing" };
  const ddLimit = line25.mtmDdUsd * 1.2;
  const winner = inRows.find(
    (row) =>
      row.totalNet190Usd === best.totalNet190Usd &&
      row.trades >= 30 &&
      row.mtmDdUsd <= ddLimit + 1e-9,
  );
  if (!winner) {
    return { kind: "none", flavor, note: "no line met candidate rules in 2024-26" };
  }
  const oosRows = JUDGED_PCTS.map((pct) => rowOf(rows, pct, flavor, "oos")).filter((row): row is Round16Row => row != null);
  if (oosRows.length !== JUDGED_PCTS.length) return { kind: "candidate", pct: winner.pct, flavor };
  const worstOos = [...oosRows].sort((a, b) => a.totalNet190Usd - b.totalNet190Usd)[0];
  if (worstOos.pct === winner.pct) return { kind: "candidate", pct: winner.pct, flavor };
  return { kind: "confirmed", pct: winner.pct, flavor };
}

export type Round16Report = {
  v: 1;
  prereg: string;
  generatedAt: string;
  universe: {
    watchlist: number;
    afterFilters: number;
    f1Unknown: string[];
    f1NegativeDropped: number;
    themeDropped: number;
    financialsDropped: number;
  };
  rows: Round16Row[];
  verdicts: Round16Verdict[];
  summaryJa: string;
};

export function buildSpyMa20(spy: readonly Feat[]): Map<string, { c: number; ma20: number | null }> {
  const out = new Map<string, { c: number; ma20: number | null }>();
  for (let i = 0; i < spy.length; i += 1) {
    const bar = spy[i];
    let ma20: number | null = null;
    if (i >= 19) {
      let sum = 0;
      for (let j = i - 19; j <= i; j += 1) sum += spy[j].c;
      ma20 = Math.round((sum / 20) * 10000) / 10000;
    }
    out.set(bar.date, { c: bar.c, ma20 });
  }
  return out;
}

export function generateSignals(args: {
  name: NameSeries;
  pct: LinePct;
  flavor: LineFlavor;
  from: string;
  to: string;
  sessions: readonly string[];
  spyByDate: ReadonlyMap<string, { c: number; ma20: number | null }>;
  market: ReadonlyMap<string, MarketDay>;
  earningsBlock: boolean;
  concepts: ConceptFacts | null;
}): Candidate[] {
  const { name, pct, flavor, from, to, sessions, spyByDate, market, concepts } = args;
  const feats = name.feats;
  const out: Candidate[] = [];
  let after = from;
  for (let i = 0; i < feats.length - 1; i += 1) {
    const sig = feats[i];
    if (sig.date < after || sig.date > to) continue;
    if (sig.gapWarning || sig.atr == null || !(sig.atr > 0) || sig.low20 == null || sig.high20 == null || sig.boxPct == null) continue;
    if (sig.c > PRICE_MAX) continue;
    if (atrPct(sig.atr, sig.c) < ATR_MIN_PCT) continue;
    if (!spyMa20Allows(spyByDate, sig.date)) continue;
    if (args.earningsBlock && nearEarnings([...sessions], sig.date, name.earnings)) continue;
    if (name.ticker !== EXCEPTION_KEEP && ttmAt(concepts, sig.date).status === "negative") continue;
    const line = boxLinePrice(sig.low20, sig.high20, pct);
    if (!flavorQualifies(sig, line, flavor)) continue;
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
    };
    cand = applyRound7C(cand, feats, qty);
    if (cand.voided) {
      after = sessionAfter(sessions, cand.exitDate) ?? to;
      continue;
    }
    out.push(cand);
    after = sessionAfter(sessions, cand.exitDate) ?? to;
  }
  return out;
}

function sessionAfter(sessions: readonly string[], date: string): string | null {
  const idx = sessions.indexOf(date);
  if (idx < 0 || idx + 1 >= sessions.length) return null;
  return sessions[idx + 1];
}

export function summarizeJa(rows: readonly Round16Row[], verdicts: readonly Round16Verdict[]): string {
  const facts: string[] = [];
  for (const flavor of FLAVORS) {
    const ref = rowOf(rows, 15, flavor, "in");
    const v = verdicts.find((item) => item.flavor === flavor);
    const judged = JUDGED_PCTS.map((pct) => rowOf(rows, pct, flavor, "in")).filter((row): row is Round16Row => row != null);
    if (judged.length === 3) {
      const best = [...judged].sort((a, b) => b.totalNet190Usd - a.totalNet190Usd)[0];
      facts.push(
        `${flavor === "touch" ? "タッチ" : "反発"}: 2024-26は${best.pct}%が最大（$1.90 ${formatUsd(best.totalNet190Usd)}、${best.trades}回）` +
          (ref ? `、参考15%は${formatUsd(ref.totalNet190Usd)}` : ""),
      );
    }
    if (v?.kind === "confirmed") facts.push(`${flavor}: 判定は${v.pct}%が確認`);
    else if (v?.kind === "candidate") facts.push(`${flavor}: 判定は${v.pct}%が候補（2022-24は未確認）`);
    else if (v?.kind === "no-meaningful-difference") facts.push(`${flavor}: 差が小さく有意差なし`);
    else if (v?.kind === "none") facts.push(`${flavor}: 候補なし（${v.note}）`);
  }
  const interpret =
    "解釈: 2024-26は金融除外後の今のリストで、Financialsを外したうえの線の比較なので、窓内の結果で線を選んだことにはならないが、候補判定の主窓はここ。2022-24は確認用。";
  return `${facts.join("。")}。${interpret}`;
}

function formatUsd(n: number): string {
  const body = Math.abs(n).toFixed(2);
  return n < 0 ? `−$${body}` : `+$${body}`;
}
