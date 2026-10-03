import { round3Verdict, SPY_BENCH, type Round3Universe, type Round3Window } from "./round3";
import type { Verdict } from "./round2";

/** Pre-registration commit. Results must cite this and must not relax the rules. */
export const ROUND4_PREREG = "1c2da22ba844c94ece16595262deddf5c606fbfb";
export const FACTS_MAX_BYTES = 40_000_000;
export const STALE_DAYS = 200;

export const CONCEPTS = ["NetIncomeLoss", "ProfitLoss", "NetIncomeLossAvailableToCommonStockholdersBasic"] as const;
export type ConceptName = (typeof CONCEPTS)[number];
export type Round4Book = "base" | "R1";
export type Round4Filter = "none" | "F1x" | "F1i" | "F2" | "F1xF2" | "F1iF2";
export type TtmStatus = "negative" | "nonnegative" | "unknown";

const FORMS = new Set(["10-Q", "10-Q/A", "10-K", "10-K/A"]);

export type IncomeFact = {
  start: string;
  end: string;
  val: number;
  filed: string;
  form: string;
  accn: string;
};

export type ConceptFacts = Partial<Record<ConceptName, IncomeFact[]>>;

export type Flow = { n: number; pnlUsd: number };

export function emptyFlow(): Flow {
  return { n: 0, pnlUsd: 0 };
}

export function sumFlow(pnls: readonly number[]): Flow {
  return { n: pnls.length, pnlUsd: pnls.reduce((sum, value) => sum + value, 0) };
}

/** Calendar days from `start` to `end`. The start day is not added. */
export function daysBetween(start: string, end: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return null;
  const left = Date.parse(`${start}T00:00:00Z`);
  const right = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
  return Math.round((right - left) / 86_400_000);
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

function asFact(row: unknown): IncomeFact | null {
  if (!row || typeof row !== "object") return null;
  const rec = row as Record<string, unknown>;
  if (typeof rec.start !== "string" || typeof rec.end !== "string" || typeof rec.filed !== "string" || typeof rec.form !== "string") return null;
  if (typeof rec.val !== "number" || !Number.isFinite(rec.val)) return null;
  return { start: rec.start, end: rec.end, val: rec.val, filed: rec.filed, form: rec.form, accn: typeof rec.accn === "string" ? rec.accn : "" };
}

/** Pull the three USD concept arrays out of a companyfacts document. */
export function readConceptFacts(json: unknown): ConceptFacts {
  const out: ConceptFacts = {};
  const gaap = (json as { facts?: { "us-gaap"?: Record<string, { units?: { USD?: unknown[] } }> } } | null)?.facts?.["us-gaap"];
  if (!gaap) return out;
  for (const name of CONCEPTS) {
    const rows = gaap[name]?.units?.USD;
    if (!Array.isArray(rows)) continue;
    const facts: IncomeFact[] = [];
    for (const row of rows) {
      const fact = asFact(row);
      if (fact) facts.push(fact);
    }
    if (facts.length) out[name] = facts;
  }
  return out;
}

function dedup(facts: readonly IncomeFact[], signal: string): IncomeFact[] {
  const best = new Map<string, IncomeFact>();
  for (const fact of facts) {
    if (!FORMS.has(fact.form) || fact.filed > signal) continue;
    const duration = daysBetween(fact.start, fact.end);
    if (duration == null || duration <= 0) continue;
    const key = `${fact.start}|${fact.end}`;
    const prev = best.get(key);
    if (!prev || fact.filed > prev.filed || (fact.filed === prev.filed && fact.accn > prev.accn)) best.set(key, fact);
  }
  return [...best.values()];
}

function deriveQuarters(quarters: readonly IncomeFact[], annuals: readonly IncomeFact[]): IncomeFact[] {
  const derived: IncomeFact[] = [];
  for (const year of annuals) {
    if (quarters.some((quarter) => quarter.end === year.end)) continue;
    const inside = quarters
      .filter((quarter) => quarter.start >= year.start && quarter.end < year.end)
      .sort((a, b) => a.end.localeCompare(b.end) || a.start.localeCompare(b.start));
    if (inside.length !== 3) continue;
    const lead = daysBetween(year.start, inside[0]?.start ?? "");
    if (lead == null || lead < 0 || lead > 7) continue;
    let aligned = true;
    for (let i = 1; i < inside.length; i += 1) {
      const gap = daysBetween(inside[i - 1]?.end ?? "", inside[i]?.start ?? "");
      if (gap == null || gap < 0 || gap > 5) aligned = false;
    }
    if (!aligned) continue;
    const third = inside[2];
    if (!third) continue;
    const filed = [year.filed, ...inside.map((quarter) => quarter.filed)].sort().at(-1) ?? year.filed;
    derived.push({
      start: addDays(third.end, 1),
      end: year.end,
      val: year.val - inside.reduce((sum, quarter) => sum + quarter.val, 0),
      filed,
      form: year.form,
      accn: year.accn,
    });
  }
  return derived;
}

/** Trailing four quarters for one concept. Null when the sequence is not usable. */
export function conceptTtm(facts: readonly IncomeFact[], signal: string): number | null {
  const kept = dedup(facts, signal);
  const quarters = kept.filter((fact) => {
    const duration = daysBetween(fact.start, fact.end);
    return duration != null && duration >= 80 && duration <= 105;
  });
  const annuals = kept.filter((fact) => {
    const duration = daysBetween(fact.start, fact.end);
    return duration != null && duration >= 330 && duration <= 380;
  });
  const series = [...quarters, ...deriveQuarters(quarters, annuals)].filter((fact) => fact.end <= signal);
  series.sort((a, b) => b.end.localeCompare(a.end) || b.filed.localeCompare(a.filed) || b.accn.localeCompare(a.accn));
  const picked = series.slice(0, 4);
  if (picked.length < 4) return null;
  picked.sort((a, b) => a.end.localeCompare(b.end) || a.start.localeCompare(b.start));
  for (let i = 1; i < picked.length; i += 1) {
    const gap = daysBetween(picked[i - 1]?.end ?? "", picked[i]?.start ?? "");
    const span = daysBetween(picked[i - 1]?.end ?? "", picked[i]?.end ?? "");
    if (gap == null || span == null || gap < 0 || gap > 5 || span < 80 || span > 110) return null;
  }
  const age = daysBetween(picked[3]?.end ?? "", signal);
  if (age == null || age < 0 || age > STALE_DAYS) return null;
  return picked.reduce((sum, fact) => sum + fact.val, 0);
}

export function ttmAt(concepts: ConceptFacts | null, signal: string): { status: TtmStatus; ttm: number | null; concept: ConceptName | null } {
  if (!concepts) return { status: "unknown", ttm: null, concept: null };
  for (const name of CONCEPTS) {
    const ttm = conceptTtm(concepts[name] ?? [], signal);
    if (ttm == null) continue;
    return { status: ttm < 0 ? "negative" : "nonnegative", ttm, concept: name };
  }
  return { status: "unknown", ttm: null, concept: null };
}

/** True when the entry open is above the signal box high, or the high is missing. */
export function aboveBoxTop(entry: number, high20: number | null): boolean {
  if (high20 == null || !Number.isFinite(high20)) return true;
  return entry > high20;
}

export function admits(filter: Round4Filter, status: TtmStatus, above: boolean): boolean {
  const loss = status === "negative";
  const unknown = status === "unknown";
  if (filter === "none") return true;
  if (filter === "F2") return !above;
  if (filter === "F1x") return !loss && !unknown;
  if (filter === "F1i") return !loss;
  if (filter === "F1xF2") return !loss && !unknown && !above;
  return !loss && !above;
}

export type FlowTrade = { ticker: string; entryDate: string; pnlUsd: number };

export function filterFlow(
  baseline: readonly FlowTrade[],
  filtered: readonly FlowTrade[],
  passes: (trade: FlowTrade) => boolean,
): { excludedOriginal: Flow; newlyAdmitted: Flow; crowdedOut: Flow } {
  const baseKeys = new Set(baseline.map((trade) => `${trade.ticker}|${trade.entryDate}`));
  const filteredKeys = new Set(filtered.map((trade) => `${trade.ticker}|${trade.entryDate}`));
  const excluded: number[] = [];
  const crowded: number[] = [];
  for (const trade of baseline) {
    const key = `${trade.ticker}|${trade.entryDate}`;
    if (!passes(trade)) excluded.push(trade.pnlUsd);
    else if (!filteredKeys.has(key)) crowded.push(trade.pnlUsd);
  }
  const admitted: number[] = [];
  for (const trade of filtered) {
    if (!baseKeys.has(`${trade.ticker}|${trade.entryDate}`)) admitted.push(trade.pnlUsd);
  }
  return { excludedOriginal: sumFlow(excluded), newlyAdmitted: sumFlow(admitted), crowdedOut: sumFlow(crowded) };
}

export function round4Verdict(args: {
  judged: boolean;
  totalUsd: number;
  n: number;
  ratio: number | null;
  spyRatio: number | null;
  lower: number | null;
  nRequired: number | null;
}): Verdict {
  return round3Verdict(args);
}

export type Round4Row = {
  book: Round4Book;
  filter: Round4Filter;
  universe: Round3Universe;
  window: Round3Window;
  totalUsd: number;
  n: number;
  winRate: number | null;
  avgWinUsd: number | null;
  avgLossUsd: number | null;
  worstUsd: number | null;
  mtmDdUsd: number;
  daysMtm10Share: number | null;
  profitFactor: number | null;
  expectancyR: number | null;
  investedFraction: number | null;
  scaledSpyUsd: number | null;
  ratio: number | null;
  ciLow: number | null;
  nRequired: number | null;
  verdict: Verdict;
  excludedOriginal: Flow;
  newlyAdmitted: Flow;
  crowdedOut: Flow;
  unknownBaseline: Flow;
  unknownExcluded: Flow | null;
};

export type Round4Report = {
  v: 1;
  prereg: string;
  rulesCommit: string;
  generatedAt: string;
  spy: typeof SPY_BENCH;
  rows: Round4Row[];
  summary: Array<{ book: Round4Book; filter: Round4Filter; pit: Verdict; adv: Verdict; verdict: Verdict }>;
};

export { SPY_BENCH };
