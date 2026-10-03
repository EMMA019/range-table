import { mulberry32 } from "./robustness";

/** Descriptive ledger stats. Nothing here is a pass, fail, or a new rule. */

export const DECOMPOSE_DRAWS = 2_000;
export const DECOMPOSE_SEED = 20261003;

export type LedgerTrade = {
  ticker: string;
  entryDate: string;
  exitDate: string;
  pnlUsd: number;
  sector: string;
  atrPct: number | null;
  boxWidthPct: number | null;
  entryPosPct: number | null;
  rs20: number | null;
  /** Signal close above that session's 50-day average. Null when the average is missing. */
  above50: boolean | null;
  weekday: string;
  /** SPY sessions from the entry session to the exit session. Same-day exit is 0. */
  holdSessions: number;
  /**
   * SPY sessions from the entry session to the next 8-K reaction day on or after it.
   * Zero when the entry session is a reaction day. Null when the cache has none.
   */
  daysToNextReaction: number | null;
  gapThrough: boolean;
  /** Prior session: SPY close above its 20-day average. Null when the average is missing. */
  spyAbove20: boolean | null;
  exitReason: string;
  slices: string[];
};

export type SectorRow = {
  sector: string;
  n: number;
  winRate: number | null;
  avgWinUsd: number | null;
  avgLossUsd: number | null;
  totalUsd: number;
  worstUsd: number | null;
};

export type ContinuousFact = {
  feature: string;
  family: "entry" | "path" | "calendar";
  nWin: number;
  nLoss: number;
  nMissing: number;
  medianWin: number | null;
  medianLoss: number | null;
  stdDiff: number | null;
  mannWhitneyP: number | null;
  medianDiffCiLow: number | null;
  medianDiffCiHigh: number | null;
};

export type CategoryBucket = {
  bucket: string;
  n: number;
  winRate: number | null;
  avgPnlUsd: number | null;
};

export type CategoryFact = {
  feature: string;
  family: "entry" | "path" | "calendar";
  buckets: CategoryBucket[];
  stdDiff: number | null;
  mannWhitneyP: number | null;
};

export type RankRow = {
  feature: string;
  family: "entry" | "path" | "calendar";
  stdDiff: number | null;
  absEffect: number | null;
};

const CONTINUOUS: Array<{ id: keyof LedgerTrade; family: RankRow["family"] }> = [
  { id: "atrPct", family: "entry" },
  { id: "boxWidthPct", family: "entry" },
  { id: "entryPosPct", family: "entry" },
  { id: "rs20", family: "entry" },
  { id: "holdSessions", family: "path" },
  { id: "daysToNextReaction", family: "calendar" },
];

const BINARY: Array<{ id: keyof LedgerTrade; family: RankRow["family"]; yes: string; no: string }> = [
  { id: "above50", family: "entry", yes: "above", no: "notAbove" },
  { id: "gapThrough", family: "path", yes: "yes", no: "no" },
  { id: "spyAbove20", family: "entry", yes: "above", no: "notAbove" },
];

export function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

export function mean(values: readonly number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** (mean of a − mean of b) / pooled within-group sd. Combined-sample sd when a group has no spread. */
export function standardizedDiff(a: readonly number[], b: readonly number[]): number | null {
  if (a.length < 2 || b.length < 2) return null;
  const ma = mean(a);
  const mb = mean(b);
  if (ma == null || mb == null) return null;
  const variance = (values: readonly number[], center: number) => values.reduce((sum, value) => sum + (value - center) ** 2, 0) / (values.length - 1);
  let sp2 = ((a.length - 1) * variance(a, ma) + (b.length - 1) * variance(b, mb)) / (a.length + b.length - 2);
  if (!(sp2 > 0)) {
    const all = [...a, ...b];
    const mall = mean(all);
    if (mall == null) return null;
    sp2 = variance(all, mall);
  }
  if (!(sp2 > 0)) return ma === mb ? 0 : null;
  return (ma - mb) / Math.sqrt(sp2);
}

function normalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) * Math.exp(-x * x);
  return 0.5 * (1 + sign * erf);
}

/** Two-sided Mann-Whitney p, normal approximation with tie and continuity corrections. */
export function mannWhitneyP(a: readonly number[], b: readonly number[]): number | null {
  const n1 = a.length;
  const n2 = b.length;
  if (n1 < 1 || n2 < 1) return null;
  const tagged = [...a.map((value) => ({ value, group: 0 })), ...b.map((value) => ({ value, group: 1 }))];
  tagged.sort((left, right) => left.value - right.value || left.group - right.group);
  const n = n1 + n2;
  let rank1 = 0;
  let tieSum = 0;
  let i = 0;
  while (i < n) {
    let j = i;
    while (j < n && tagged[j]?.value === tagged[i]?.value) j += 1;
    const ties = j - i;
    const avg = (i + 1 + j) / 2;
    for (let k = i; k < j; k += 1) if (tagged[k]?.group === 0) rank1 += avg;
    if (ties > 1) tieSum += ties ** 3 - ties;
    i = j;
  }
  const u1 = rank1 - (n1 * (n1 + 1)) / 2;
  const meanU = (n1 * n2) / 2;
  const tieTerm = n > 1 ? tieSum / (n * (n - 1)) : 0;
  const sigma2 = (n1 * n2 / 12) * (n + 1 - tieTerm);
  if (!(sigma2 > 0)) return 1;
  const gap = u1 - meanU;
  const corrected = Math.abs(gap) > 0.5 ? gap - Math.sign(gap) * 0.5 : gap;
  const z = corrected / Math.sqrt(sigma2);
  return Math.min(1, Math.max(0, 2 * (1 - normalCdf(Math.abs(z)))));
}

function bootstrapMedianCi(win: readonly number[], loss: readonly number[], rng: () => number, draws = DECOMPOSE_DRAWS): { low: number; high: number } | null {
  if (!win.length || !loss.length) return null;
  const diffs = new Array<number>(draws);
  for (let draw = 0; draw < draws; draw += 1) {
    const left: number[] = [];
    const right: number[] = [];
    for (let i = 0; i < win.length; i += 1) left.push(win[Math.floor(rng() * win.length)] ?? 0);
    for (let i = 0; i < loss.length; i += 1) right.push(loss[Math.floor(rng() * loss.length)] ?? 0);
    diffs[draw] = (median(left) ?? 0) - (median(right) ?? 0);
  }
  diffs.sort((a, b) => a - b);
  const low = Math.max(0, Math.ceil(0.025 * draws) - 1);
  const high = Math.max(0, Math.ceil(0.975 * draws) - 1);
  return { low: diffs[low] ?? 0, high: diffs[high] ?? 0 };
}

export function sectorRows(trades: readonly LedgerTrade[]): SectorRow[] {
  const groups = new Map<string, LedgerTrade[]>();
  for (const trade of trades) {
    const list = groups.get(trade.sector) ?? [];
    list.push(trade);
    groups.set(trade.sector, list);
  }
  const rows: SectorRow[] = [];
  for (const [sector, list] of groups) {
    const wins = list.filter((trade) => trade.pnlUsd > 0).map((trade) => trade.pnlUsd);
    const losses = list.filter((trade) => trade.pnlUsd < 0).map((trade) => trade.pnlUsd);
    rows.push({
      sector,
      n: list.length,
      winRate: list.length ? wins.length / list.length : null,
      avgWinUsd: mean(wins),
      avgLossUsd: mean(losses),
      totalUsd: list.reduce((sum, trade) => sum + trade.pnlUsd, 0),
      worstUsd: list.length ? Math.min(...list.map((trade) => trade.pnlUsd)) : null,
    });
  }
  rows.sort((a, b) => b.totalUsd - a.totalUsd || a.sector.localeCompare(b.sector));
  return rows;
}

function numbers(trades: readonly LedgerTrade[], key: keyof LedgerTrade, side: "win" | "loss"): number[] {
  const out: number[] = [];
  for (const trade of trades) {
    if (side === "win" ? !(trade.pnlUsd > 0) : !(trade.pnlUsd < 0)) continue;
    const value = trade[key];
    if (typeof value === "number" && Number.isFinite(value)) out.push(value);
  }
  return out;
}

function binaryNumbers(trades: readonly LedgerTrade[], key: keyof LedgerTrade, side: "win" | "loss"): { values: number[]; missing: number } {
  const values: number[] = [];
  let missing = 0;
  for (const trade of trades) {
    if (side === "win" ? !(trade.pnlUsd > 0) : !(trade.pnlUsd < 0)) continue;
    const value = trade[key];
    if (typeof value !== "boolean") {
      missing += 1;
      continue;
    }
    values.push(value ? 1 : 0);
  }
  return { values, missing };
}

export function dedupeTrades(trades: readonly LedgerTrade[]): { trades: LedgerTrade[]; conflicts: number } {
  const byPnl = new Map<string, LedgerTrade>();
  const pnls = new Map<string, Set<number>>();
  for (const trade of trades) {
    const identity = `${trade.ticker}|${trade.entryDate}|${trade.exitDate}`;
    const seen = pnls.get(identity) ?? new Set<number>();
    seen.add(trade.pnlUsd);
    pnls.set(identity, seen);
    const key = `${identity}|${trade.pnlUsd}`;
    const prev = byPnl.get(key);
    if (!prev) {
      byPnl.set(key, { ...trade, slices: [...trade.slices] });
      continue;
    }
    for (const slice of trade.slices) if (!prev.slices.includes(slice)) prev.slices.push(slice);
  }
  let conflicts = 0;
  for (const seen of pnls.values()) if (seen.size > 1) conflicts += 1;
  return { trades: [...byPnl.values()], conflicts };
}

export type SliceFacts = {
  n: number;
  wins: number;
  losses: number;
  flats: number;
  tradePnlUsd: number;
  sectors: SectorRow[];
  continuous: ContinuousFact[];
  categorical: CategoryFact[];
  rank: RankRow[];
  tests: number;
};

export function sliceFacts(trades: readonly LedgerTrade[], rng: () => number = mulberry32(DECOMPOSE_SEED)): SliceFacts {
  const wins = trades.filter((trade) => trade.pnlUsd > 0);
  const losses = trades.filter((trade) => trade.pnlUsd < 0);
  const continuous: ContinuousFact[] = [];
  const categorical: CategoryFact[] = [];
  const rank: RankRow[] = [];
  let tests = 0;

  for (const spec of CONTINUOUS) {
    const winValues = numbers(trades, spec.id, "win");
    const lossValues = numbers(trades, spec.id, "loss");
    const nMissing = wins.length + losses.length - winValues.length - lossValues.length;
    const diff = standardizedDiff(winValues, lossValues);
    const p = mannWhitneyP(winValues, lossValues);
    if (p != null) tests += 1;
    const ci = bootstrapMedianCi(winValues, lossValues, rng);
    continuous.push({
      feature: spec.id,
      family: spec.family,
      nWin: winValues.length,
      nLoss: lossValues.length,
      nMissing,
      medianWin: median(winValues),
      medianLoss: median(lossValues),
      stdDiff: diff,
      mannWhitneyP: p,
      medianDiffCiLow: ci?.low ?? null,
      medianDiffCiHigh: ci?.high ?? null,
    });
    rank.push({ feature: spec.id, family: spec.family, stdDiff: diff, absEffect: diff == null ? null : Math.abs(diff) });
  }

  for (const spec of BINARY) {
    const left = binaryNumbers(trades, spec.id, "win");
    const right = binaryNumbers(trades, spec.id, "loss");
    const diff = standardizedDiff(left.values, right.values);
    const p = mannWhitneyP(left.values, right.values);
    if (p != null) tests += 1;
    const buckets = [true, false].map((flag) => {
      const list = trades.filter((trade) => trade[spec.id] === flag);
      const bucketWins = list.filter((trade) => trade.pnlUsd > 0);
      return {
        bucket: flag ? spec.yes : spec.no,
        n: list.length,
        winRate: list.length ? bucketWins.length / list.length : null,
        avgPnlUsd: mean(list.map((trade) => trade.pnlUsd)),
      };
    });
    categorical.push({ feature: spec.id, family: spec.family, buckets, stdDiff: diff, mannWhitneyP: p });
    rank.push({ feature: spec.id, family: spec.family, stdDiff: diff, absEffect: diff == null ? null : Math.abs(diff) });
  }

  const weekdays = [...new Set(trades.map((trade) => trade.weekday))].sort();
  const weekdayBuckets: CategoryBucket[] = weekdays.map((day) => {
    const list = trades.filter((trade) => trade.weekday === day);
    const bucketWins = list.filter((trade) => trade.pnlUsd > 0);
    return {
      bucket: day,
      n: list.length,
      winRate: list.length ? bucketWins.length / list.length : null,
      avgPnlUsd: mean(list.map((trade) => trade.pnlUsd)),
    };
  });
  let weekdayDiff: number | null = null;
  for (const day of weekdays) {
    const winValues = wins.map((trade) => (trade.weekday === day ? 1 : 0));
    const lossValues = losses.map((trade) => (trade.weekday === day ? 1 : 0));
    const diff = standardizedDiff(winValues, lossValues);
    if (diff != null && (weekdayDiff == null || Math.abs(diff) > Math.abs(weekdayDiff))) weekdayDiff = diff;
  }
  categorical.push({ feature: "weekday", family: "entry", buckets: weekdayBuckets, stdDiff: weekdayDiff, mannWhitneyP: null });
  rank.push({ feature: "weekday", family: "entry", stdDiff: weekdayDiff, absEffect: weekdayDiff == null ? null : Math.abs(weekdayDiff) });

  rank.sort((a, b) => (b.absEffect ?? -1) - (a.absEffect ?? -1) || a.feature.localeCompare(b.feature));
  return {
    n: trades.length,
    wins: wins.length,
    losses: losses.length,
    flats: trades.length - wins.length - losses.length,
    tradePnlUsd: trades.reduce((sum, trade) => sum + trade.pnlUsd, 0),
    sectors: sectorRows(trades),
    continuous,
    categorical,
    rank,
    tests,
  };
}

export function topLosses(trades: readonly LedgerTrade[], count = 10): LedgerTrade[] {
  return [...trades].sort((a, b) => a.pnlUsd - b.pnlUsd || a.ticker.localeCompare(b.ticker) || a.entryDate.localeCompare(b.entryDate)).slice(0, count);
}

export type SharedLosses = {
  n: number;
  gapThrough: number;
  above50: number;
  notAbove50: number;
  unknown50: number;
  spyAbove20: number;
  spyNotAbove20: number;
  unknownSpy: number;
  sectors: Array<{ bucket: string; n: number }>;
  weekdays: Array<{ bucket: string; n: number }>;
  exitReasons: Array<{ bucket: string; n: number }>;
  medianHold: number | null;
  medianAtrPct: number | null;
  medianBoxWidthPct: number | null;
  medianEntryPosPct: number | null;
  medianRs20: number | null;
  medianDaysToEarnings: number | null;
  earningsKnown: number;
};

function counts(trades: readonly LedgerTrade[], value: (trade: LedgerTrade) => string): Array<{ bucket: string; n: number }> {
  const map = new Map<string, number>();
  for (const trade of trades) map.set(value(trade), (map.get(value(trade)) ?? 0) + 1);
  return [...map.entries()].map(([bucket, n]) => ({ bucket, n })).sort((a, b) => b.n - a.n || a.bucket.localeCompare(b.bucket));
}

export type StoredSlice = {
  id: string;
  universe: "core" | "pit" | "adv" | "pooled";
  window: "oos" | "in" | "all";
  n: number;
  bookUsd: number;
  tradePnlUsd: number;
  wins: number;
  losses: number;
  flats: number;
  sectors: SectorRow[];
  continuous: ContinuousFact[];
  categorical: CategoryFact[];
  rank: RankRow[];
};

export type DecomposeReport = {
  v: 1;
  generatedAt: string;
  gicsSource: string;
  methods: string[];
  multipleComparisons: { tests: number; bonferroni: number | null; note: string };
  books: Array<{
    id: "base" | "R1";
    label: string;
    unmapped: string[];
    conflicts: number;
    slices: StoredSlice[];
    topLosses: LedgerTrade[];
    shared: SharedLosses;
  }>;
};

export function sharedLosses(trades: readonly LedgerTrade[]): SharedLosses {
  const nums = (key: keyof LedgerTrade) => trades.flatMap((trade) => (typeof trade[key] === "number" ? [trade[key] as number] : []));
  const days = trades.flatMap((trade) => (trade.daysToNextReaction == null ? [] : [trade.daysToNextReaction]));
  return {
    n: trades.length,
    gapThrough: trades.filter((trade) => trade.gapThrough).length,
    above50: trades.filter((trade) => trade.above50 === true).length,
    notAbove50: trades.filter((trade) => trade.above50 === false).length,
    unknown50: trades.filter((trade) => trade.above50 == null).length,
    spyAbove20: trades.filter((trade) => trade.spyAbove20 === true).length,
    spyNotAbove20: trades.filter((trade) => trade.spyAbove20 === false).length,
    unknownSpy: trades.filter((trade) => trade.spyAbove20 == null).length,
    sectors: counts(trades, (trade) => trade.sector),
    weekdays: counts(trades, (trade) => trade.weekday),
    exitReasons: counts(trades, (trade) => trade.exitReason),
    medianHold: median(nums("holdSessions")),
    medianAtrPct: median(nums("atrPct")),
    medianBoxWidthPct: median(nums("boxWidthPct")),
    medianEntryPosPct: median(nums("entryPosPct")),
    medianRs20: median(nums("rs20")),
    medianDaysToEarnings: median(days),
    earningsKnown: days.length,
  };
}
