import type { Candidate, ExitReason, ExitTiming, Feat } from "./backtest-study";
import { mulberry32 } from "./robustness";

/** Pre-registration commit. Results must cite this and must not relax the rules below. */
export const ROUND2_PREREG = "fbc5d6b290459a0b0819ae30d36c10c7f5d65f68";
export const BOOTSTRAP_DRAWS = 10_000;
export const BOOTSTRAP_SEED = 20261003;
export const MAIN_Z = 2.05;
export const MAIN_Q = 0.02;
export const PRIMED_Z = 1.65;
export const PRIMED_Q = 0.05;

export type Verdict = "pass" | "fail" | "hold" | "not-judged";

/** IBKR US fixed: $0.005/share, minimum $1, maximum 1% of trade value. No regulatory pass-through. */
export function ibkrFixedFee(shares: number, price: number): number {
  if (!(shares > 0) || !(price > 0)) return 0;
  const perShare = 0.005 * shares;
  const cap = 0.01 * shares * price;
  return Math.min(Math.max(perShare, 1), cap);
}

export function etClock(iso: string): { date: string; minutes: number } | null {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(fmt.formatToParts(parsed).map((part) => [part.type, part.value]));
  if (!parts.year || !parts.month || !parts.day || parts.hour == null || parts.minute == null) return null;
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

function nextSession(sessions: readonly string[], date: string): string | null {
  const index = sessions.findIndex((session) => session > date);
  return index < 0 ? null : sessions[index];
}

function sessionOnOrAfter(sessions: readonly string[], date: string): string | null {
  const index = sessions.findIndex((session) => session >= date);
  return index < 0 ? null : sessions[index];
}

/** Map an Item 2.02 acceptance timestamp to the earnings reaction session. */
export function reactionDay(acceptance: string, sessions: readonly string[]): string | null {
  const clock = etClock(acceptance);
  if (!clock) return null;
  if (clock.minutes >= 16 * 60) return nextSession(sessions, clock.date);
  return sessionOnOrAfter(sessions, clock.date);
}

export function monthTurnSessions(sessions: readonly string[]): Set<string> {
  const byMonth = new Map<string, string[]>();
  for (const date of sessions) {
    const list = byMonth.get(date.slice(0, 7)) ?? [];
    list.push(date);
    byMonth.set(date.slice(0, 7), list);
  }
  const out = new Set<string>();
  for (const list of byMonth.values()) {
    if (!list.length) continue;
    out.add(list[list.length - 1]);
    for (const date of list.slice(0, 3)) out.add(date);
  }
  return out;
}

/** Entry is 1 to `within` sessions before a reaction day. The reaction day itself is allowed. */
export function entryBeforeEarnings(entry: string, reactions: readonly string[], sessions: readonly string[], within = 5): boolean {
  const at = sessions.indexOf(entry);
  if (at < 0) return false;
  for (const reaction of reactions) {
    const event = sessions.indexOf(reaction);
    if (event < 0) continue;
    const distance = event - at;
    if (distance >= 1 && distance <= within) return true;
  }
  return false;
}

export function sampleSd(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const acc = values.reduce((sum, value) => sum + (value - mean) ** 2, 0);
  return Math.sqrt(acc / (values.length - 1));
}

export function bootstrapMean(values: readonly number[], q: number, z: number, draws = BOOTSTRAP_DRAWS, seed = BOOTSTRAP_SEED): {
  mean: number | null;
  sd: number | null;
  lower: number | null;
  nRequired: number | null;
} {
  const n = values.length;
  if (!n) return { mean: null, sd: null, lower: null, nRequired: null };
  const mean = values.reduce((sum, value) => sum + value, 0) / n;
  const sd = sampleSd(values);
  const nRequired = sd != null && mean > 0 ? (z * sd / mean) ** 2 : sd === 0 && mean > 0 ? 0 : null;
  if (n < 2) return { mean, sd, lower: null, nRequired };
  const rng = mulberry32(seed);
  const means = new Array<number>(draws);
  for (let draw = 0; draw < draws; draw += 1) {
    let sum = 0;
    for (let i = 0; i < n; i += 1) sum += values[Math.floor(rng() * n)];
    means[draw] = sum / n;
  }
  means.sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil(q * draws) - 1);
  return { mean, sd, lower: means[index] ?? null, nRequired };
}

export function windowVerdict(args: {
  totalUsd: number;
  n: number;
  ratio: number | null;
  spyRatio: number | null;
  lower: number | null;
  nRequired: number | null;
}): Verdict {
  if (args.n < 2 || args.lower == null) return "hold";
  if (!(args.totalUsd > 0)) return "fail";
  const underpowered = args.nRequired == null || args.n < args.nRequired;
  if (underpowered) return "hold";
  const ratioOk = args.ratio != null && args.spyRatio != null && args.ratio > args.spyRatio;
  const ciOk = args.lower > 0;
  if (!ratioOk || !ciOk) return "fail";
  return "pass";
}

export function overallVerdict(parts: readonly Verdict[]): Verdict {
  if (!parts.length || parts.every((part) => part === "not-judged")) return "not-judged";
  if (parts.some((part) => part === "fail")) return "fail";
  if (parts.some((part) => part === "hold" || part === "not-judged")) return "hold";
  return "pass";
}

type ExitPlan = {
  entryIndex: number;
  exitIndex: number;
  entry: number;
  exit: number;
  reason: ExitReason;
  exitTiming: ExitTiming;
};

/** Same target, stop, and hold order as the box simulator. The stop is not active on the entry session. */
export function plannedExit(bars: readonly Feat[], signalIndex: number, target: number | null, stop: number | null, maxHold: number): ExitPlan | null {
  const entryIndex = signalIndex + 1;
  if (entryIndex >= bars.length) return null;
  const entry = bars[entryIndex].o;
  if (!(entry > 0)) return null;
  const lastIndex = Math.min(bars.length - 1, entryIndex + maxHold);
  for (let j = entryIndex; j <= lastIndex; j += 1) {
    const bar = bars[j];
    if (target != null && j > entryIndex && bar.o >= target) return { entryIndex, exitIndex: j, entry, exit: bar.o, reason: "target", exitTiming: "open" };
    if (stop != null && j > entryIndex && bar.o < stop) return { entryIndex, exitIndex: j, entry, exit: bar.o, reason: "stop", exitTiming: "open" };
    if (target != null && bar.h >= target) return { entryIndex, exitIndex: j, entry, exit: target, reason: "target", exitTiming: "intraday" };
    if (stop != null && bar.c < stop) return { entryIndex, exitIndex: j, entry, exit: bar.c, reason: "stop", exitTiming: "close" };
    if (j === entryIndex + maxHold) return { entryIndex, exitIndex: j, entry, exit: bar.c, reason: "timeout", exitTiming: "close" };
  }
  return { entryIndex, exitIndex: lastIndex, entry, exit: bars[lastIndex].c, reason: "window", exitTiming: "close" };
}

function candidateFrom(ticker: string, semi: boolean, bars: readonly Feat[], signalIndex: number, plan: ExitPlan, rs20: number | null): Candidate {
  const sig = bars[signalIndex];
  const atr = sig.atr ?? 0;
  return {
    ticker,
    sector: "",
    semi,
    signalIndex,
    entryIndex: plan.entryIndex,
    exitIndex: plan.exitIndex,
    signalDate: sig.date,
    entryDate: bars[plan.entryIndex].date,
    exitDate: bars[plan.exitIndex].date,
    entry: plan.entry,
    exit: plan.exit,
    atr,
    atrPct: atr > 0 && sig.c > 0 ? (atr / sig.c) * 100 : 0,
    boxPct: sig.boxPct,
    rebound: sig.rebound,
    rs20,
    qty10: 1,
    reason: plan.reason,
    exitTiming: plan.exitTiming,
    voided: false,
  };
}

function priorVolume(bars: readonly Feat[], index: number): number | null {
  if (index < 20) return null;
  let sum = 0;
  for (let i = index - 20; i < index; i += 1) sum += bars[i].v;
  return sum / 20;
}

export function driftCandidates(
  ticker: string,
  semi: boolean,
  bars: readonly Feat[],
  reactions: readonly string[],
  spyRet: ReadonlyMap<string, number | null>,
  bounds: { from: string; to: string },
): Candidate[] {
  const reactionSet = new Set(reactions);
  const out: Candidate[] = [];
  for (let i = 1; i < bars.length - 1; i += 1) {
    const bar = bars[i];
    if (!reactionSet.has(bar.date) || bar.date > bounds.to) continue;
    const prior = bars[i - 1];
    const atr = bar.atr;
    if (atr == null || !(atr > 0) || !(bar.c > 0) || !(bar.c < 550)) continue;
    if ((atr / bar.c) * 100 < 3) continue;
    if (!(bar.o - prior.c >= 1.5 * atr)) continue;
    if (!(bar.c > bar.o)) continue;
    const base = priorVolume(bars, i);
    if (base == null || !(bar.v >= 2 * base)) continue;
    const plan = plannedExit(bars, i, bars[i + 1].o + atr, bar.l, 10);
    const entryDate = plan ? bars[plan.entryIndex].date : "";
    if (!plan || !(plan.entry < 550) || entryDate < bounds.from || entryDate > bounds.to) continue;
    const stock = bar.ret20;
    const spy = spyRet.get(bar.date) ?? null;
    out.push(candidateFrom(ticker, semi, bars, i, plan, stock == null || spy == null ? null : stock - spy));
  }
  return out;
}

export function gapFillCandidates(
  ticker: string,
  semi: boolean,
  bars: readonly Feat[],
  blocked: ReadonlySet<string>,
  spyGapOk: ReadonlyMap<string, boolean>,
  spyRet: ReadonlyMap<string, number | null>,
  bounds: { from: string; to: string },
): Candidate[] {
  const out: Candidate[] = [];
  for (let i = 1; i < bars.length; i += 1) {
    const bar = bars[i];
    const prior = bars[i - 1];
    if (bar.date < bounds.from || bar.date > bounds.to) continue;
    const atr = prior.atr;
    if (atr == null || !(atr > 0) || !(prior.c > 0) || !(prior.c < 550) || !(bar.o < 550)) continue;
    if ((atr / prior.c) * 100 < 3) continue;
    if (!(bar.o <= prior.c - atr)) continue;
    if (spyGapOk.get(bar.date) !== true) continue;
    if (blocked.has(bar.date)) continue;
    const filled = bar.h >= prior.c;
    const stock = prior.ret20;
    const spy = spyRet.get(prior.date) ?? null;
    out.push({
      ticker,
      sector: "",
      semi,
      signalIndex: i,
      entryIndex: i,
      exitIndex: i,
      signalDate: bar.date,
      entryDate: bar.date,
      exitDate: bar.date,
      entry: bar.o,
      exit: filled ? prior.c : bar.c,
      atr,
      atrPct: (atr / prior.c) * 100,
      boxPct: null,
      rebound: null,
      rs20: stock == null || spy == null ? null : stock - spy,
      qty10: 1,
      reason: filled ? "target" : "timeout",
      exitTiming: "close",
      voided: false,
    });
  }
  return out;
}

export function dropMonthTurn(cands: readonly Candidate[], turns: ReadonlySet<string>): Candidate[] {
  return cands.filter((cand) => !turns.has(cand.entryDate));
}

export type InsiderLot = { ticker: string; owner: string; filingDate: string; valueUsd: number };

/** Filing dates that qualify. A pair uses the later filing date. */
export function insiderFilingSignals(lots: readonly InsiderLot[], sessions: readonly string[]): Array<{ ticker: string; filingDate: string }> {
  const byTicker = new Map<string, InsiderLot[]>();
  for (const lot of lots) {
    if (!(lot.valueUsd > 0)) continue;
    const list = byTicker.get(lot.ticker) ?? [];
    list.push(lot);
    byTicker.set(lot.ticker, list);
  }
  const out: Array<{ ticker: string; filingDate: string }> = [];
  for (const [ticker, rows] of byTicker) {
    const dated = rows
      .map((row) => ({ ...row, at: sessions.findIndex((session) => session >= row.filingDate) }))
      .filter((row) => row.at >= 0)
      .sort((a, b) => a.filingDate.localeCompare(b.filingDate) || a.owner.localeCompare(b.owner));
    const seen = new Set<string>();
    for (const row of dated) {
      if (row.valueUsd >= 100_000 && !seen.has(row.filingDate)) {
        seen.add(row.filingDate);
        out.push({ ticker, filingDate: row.filingDate });
      }
    }
    for (let i = 0; i < dated.length; i += 1) {
      for (let j = 0; j < i; j += 1) {
        if (dated[i].owner === dated[j].owner) continue;
        if (dated[i].at - dated[j].at > 10) continue;
        const filingDate = dated[i].filingDate;
        if (seen.has(filingDate)) continue;
        seen.add(filingDate);
        out.push({ ticker, filingDate });
      }
    }
  }
  return out;
}

export function commonStockTitle(title: string): boolean {
  if (!/common stock|common share|ordinary share/i.test(title)) return false;
  return !/preferred|warrant|right|\bunit\b|note|bond|depositary/i.test(title);
}

export function insiderRole(relationship: string, title: string): boolean {
  if (/director/i.test(relationship)) return true;
  return /\bceo\b|chief executive|\bcfo\b|chief financial/i.test(title);
}

export function footnoteIsPlan(text: string): boolean {
  return /10b5-?1/i.test(text);
}

export function flagIsPlan(value: string | undefined): boolean {
  if (value == null) return false;
  return /^(1|true|y)$/i.test(value.trim());
}
