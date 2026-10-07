import { isIgnoredTicker } from "./holdings";
import { themeOf } from "./themes";

/** Shown on the weekly line and stored in data/paper/followup.json. */
export const HIT_DEFINITION =
  "的中は、通知日から10営業日後の終値が通知日の終値より高く、かつその10営業日のあいだに終値が20日安値（通知日を含む20本の最安値）を下回らないこと。終値が20日安値を下回った時点で外れ。+10日の足が無いあいだは未判定で、無い足のリターンは作らない。";

export const YAHOO_DAILY_SOURCE =
  "Yahoo Finance chart API query1 v8 日足（src/lib/yahoo.ts の fetchDailyBars）";

export type FollowupStatus = "hit" | "miss" | "pending";

export type FollowupInput = {
  signal_date: string;
  symbol: string;
  ref_close: number;
  low20: number;
  source: string;
};

export type FollowupRecord = FollowupInput & {
  /** Percent from ref_close to the 5th later close. Null when that bar does not exist yet. */
  ret5: number | null;
  /** Percent from ref_close to the 10th later close. Null when that bar does not exist yet. */
  ret10: number | null;
  /** True once a later close is under low20 inside 10 sessions. False after 10 clean sessions. Null while still open. */
  broke_low20: boolean | null;
  status: FollowupStatus;
  plus5_date: string | null;
  plus10_date: string | null;
  /** Trading bars strictly after the signal date. Null when the signal date is not in the series. */
  sessions_after: number | null;
  note: string | null;
  /** SOXX/SPY percent from their own close on signal_date to the 5th and 10th later close. */
  soxx5: number | null;
  soxx10: number | null;
  spy5: number | null;
  spy10: number | null;
  /** Signal return minus the SOXX return, in already-rounded percent points. Null if either side is missing. */
  excess5_soxx: number | null;
  excess10_soxx: number | null;
};

export type DailyClose = { date: string; c: number };

export type BenchmarkSeries = {
  soxx?: DailyClose[] | null;
  spy?: DailyClose[] | null;
};

export type FollowupFile = {
  source: string;
  fetchedAtJst: string;
  barsThrough: string | null;
  hitDefinition: string;
  records: FollowupRecord[];
};

export type FollowupSummary = {
  total: number;
  decided: number;
  hits: number;
  pending: number;
  /** Hits / decided, in percent. Null when nothing is decided. */
  hitRate: number | null;
  ret5Median: number | null;
  ret5Count: number;
  /** Medians among rows that already have ret5, using only the non-null benchmark values. */
  soxx5Median: number | null;
  soxx5Count: number;
  spy5Median: number | null;
  spy5Count: number;
  excess5Median: number | null;
  excess5Count: number;
  signalFrom: string | null;
  signalTo: string | null;
  fetchedAtJst: string;
  barsThrough: string | null;
  source: string;
};

const STATUSES = new Set<FollowupStatus>(["hit", "miss", "pending"]);

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function retPct(close: number, ref: number): number | null {
  if (!(ref > 0) || !Number.isFinite(close)) return null;
  return round2((close / ref - 1) * 100);
}

function byDate(bars: Array<{ date: string; c: number }>): Array<{ date: string; c: number }> {
  const map = new Map<string, number>();
  for (const bar of bars) {
    if (!Number.isFinite(bar.c)) continue;
    map.set(bar.date, bar.c);
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, c]) => ({ date, c }));
}

function windowReturn(bars: DailyClose[] | null | undefined, signalDate: string, sessions: 5 | 10): number | null {
  if (!bars) return null;
  const series = byDate(bars);
  const idx = series.findIndex((bar) => bar.date === signalDate);
  const ref = idx < 0 ? null : series[idx]?.c;
  const bar = idx < 0 ? null : series[idx + sessions];
  if (ref == null || !(ref > 0) || !bar) return null;
  return retPct(bar.c, ref);
}

function excess(signalRet: number | null, benchRet: number | null): number | null {
  if (signalRet == null || benchRet == null) return null;
  return round2(signalRet - benchRet);
}

function withBenchmarks(row: Omit<FollowupRecord, "soxx5" | "soxx10" | "spy5" | "spy10" | "excess5_soxx" | "excess10_soxx">, benchmarks?: BenchmarkSeries | null): FollowupRecord {
  const soxx5 = windowReturn(benchmarks?.soxx, row.signal_date, 5);
  const soxx10 = windowReturn(benchmarks?.soxx, row.signal_date, 10);
  const spy5 = windowReturn(benchmarks?.spy, row.signal_date, 5);
  const spy10 = windowReturn(benchmarks?.spy, row.signal_date, 10);
  return {
    ...row,
    soxx5,
    soxx10,
    spy5,
    spy10,
    excess5_soxx: excess(row.ret5, soxx5),
    excess10_soxx: excess(row.ret10, soxx10),
  };
}

/**
 * Score one logged notification from daily closes after the signal date.
 * A close under low20 inside the next 10 sessions is a miss immediately.
 * Otherwise the call waits for the 10th later close. Missing bars stay null.
 * SOXX and SPY use their own close on the signal date, then the same later-bar counts.
 */
export function measureFollowup(
  signal: FollowupInput,
  bars: DailyClose[] | null,
  benchmarks?: BenchmarkSeries | null,
): FollowupRecord {
  const blank = (note: string | null, sessions: number | null): FollowupRecord =>
    withBenchmarks({
      signal_date: signal.signal_date,
      symbol: signal.symbol,
      ref_close: signal.ref_close,
      low20: signal.low20,
      source: signal.source,
      ret5: null,
      ret10: null,
      broke_low20: null,
      status: "pending",
      plus5_date: null,
      plus10_date: null,
      sessions_after: sessions,
      note,
    }, benchmarks);
  if (!bars || !(signal.ref_close > 0) || !Number.isFinite(signal.low20)) {
    return blank("日足が無い", null);
  }
  const series = byDate(bars);
  const idx = series.findIndex((bar) => bar.date === signal.signal_date);
  if (idx < 0) return blank("通知日の足が無い", null);

  const after = series.slice(idx + 1);
  const window = after.slice(0, 10);
  const broke = window.some((bar) => bar.c < signal.low20);
  const bar5 = after[4] ?? null;
  const bar10 = after[9] ?? null;
  const ret5 = bar5 ? retPct(bar5.c, signal.ref_close) : null;
  const ret10 = bar10 ? retPct(bar10.c, signal.ref_close) : null;

  let status: FollowupStatus = "pending";
  let brokeLow: boolean | null = null;
  if (broke) {
    status = "miss";
    brokeLow = true;
  } else if (bar10 && bar10.c > signal.ref_close) {
    status = "hit";
    brokeLow = false;
  } else if (bar10) {
    status = "miss";
    brokeLow = false;
  }

  return withBenchmarks({
    signal_date: signal.signal_date,
    symbol: signal.symbol,
    ref_close: signal.ref_close,
    low20: signal.low20,
    source: signal.source,
    ret5,
    ret10,
    broke_low20: brokeLow,
    status,
    plus5_date: bar5?.date ?? null,
    plus10_date: bar10?.date ?? null,
    sessions_after: after.length,
    note: null,
  }, benchmarks);
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return round2(sorted[mid] ?? 0);
  const left = sorted[mid - 1];
  const right = sorted[mid];
  if (left == null || right == null) return null;
  return round2((left + right) / 2);
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asRecord(raw: unknown): FollowupRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const symbol = typeof row.symbol === "string" ? row.symbol.trim().toUpperCase() : "";
  const signalDate = typeof row.signal_date === "string" ? row.signal_date : "";
  const status = row.status;
  const ref = num(row.ref_close);
  const low = num(row.low20);
  if (!symbol || isIgnoredTicker(symbol) || themeOf(symbol) || !signalDate || ref == null || !(ref > 0) || low == null) return null;
  if (typeof status !== "string" || !STATUSES.has(status as FollowupStatus)) return null;
  return {
    signal_date: signalDate,
    symbol,
    ref_close: ref,
    low20: low,
    source: typeof row.source === "string" ? row.source : "",
    ret5: num(row.ret5),
    ret10: num(row.ret10),
    broke_low20: typeof row.broke_low20 === "boolean" ? row.broke_low20 : null,
    status: status as FollowupStatus,
    plus5_date: typeof row.plus5_date === "string" ? row.plus5_date : null,
    plus10_date: typeof row.plus10_date === "string" ? row.plus10_date : null,
    sessions_after: num(row.sessions_after),
    note: typeof row.note === "string" ? row.note : null,
    soxx5: num(row.soxx5),
    soxx10: num(row.soxx10),
    spy5: num(row.spy5),
    spy10: num(row.spy10),
    excess5_soxx: num(row.excess5_soxx),
    excess10_soxx: num(row.excess10_soxx),
  };
}

export function readFollowup(raw: unknown): FollowupFile {
  if (!raw || typeof raw !== "object") {
    return { source: "", fetchedAtJst: "", barsThrough: null, hitDefinition: HIT_DEFINITION, records: [] };
  }
  const doc = raw as Record<string, unknown>;
  const records = Array.isArray(doc.records) ? doc.records.flatMap((row) => {
    const parsed = asRecord(row);
    return parsed ? [parsed] : [];
  }) : [];
  return {
    source: typeof doc.source === "string" ? doc.source : "",
    fetchedAtJst: typeof doc.fetchedAtJst === "string" ? doc.fetchedAtJst : "",
    barsThrough: typeof doc.barsThrough === "string" ? doc.barsThrough : null,
    hitDefinition: typeof doc.hitDefinition === "string" && doc.hitDefinition ? doc.hitDefinition : HIT_DEFINITION,
    records,
  };
}

export function summarizeFollowup(raw: unknown): FollowupSummary {
  const file = readFollowup(raw);
  const records = file.records;
  const decidedRows = records.filter((row) => row.status === "hit" || row.status === "miss");
  const hits = decidedRows.filter((row) => row.status === "hit").length;
  const withRet5 = records.filter((row) => row.ret5 != null);
  const ret5s = withRet5.flatMap((row) => (row.ret5 == null ? [] : [row.ret5]));
  const soxx5s = withRet5.flatMap((row) => (row.soxx5 == null ? [] : [row.soxx5]));
  const spy5s = withRet5.flatMap((row) => (row.spy5 == null ? [] : [row.spy5]));
  const excess5s = withRet5.flatMap((row) => (row.excess5_soxx == null ? [] : [row.excess5_soxx]));
  const dates = records.map((row) => row.signal_date).sort();
  return {
    total: records.length,
    decided: decidedRows.length,
    hits,
    pending: records.filter((row) => row.status === "pending").length,
    hitRate: decidedRows.length === 0 ? null : Math.round((hits / decidedRows.length) * 1000) / 10,
    ret5Median: median(ret5s),
    ret5Count: ret5s.length,
    soxx5Median: median(soxx5s),
    soxx5Count: soxx5s.length,
    spy5Median: median(spy5s),
    spy5Count: spy5s.length,
    excess5Median: median(excess5s),
    excess5Count: excess5s.length,
    signalFrom: dates[0] ?? null,
    signalTo: dates.at(-1) ?? null,
    fetchedAtJst: file.fetchedAtJst,
    barsThrough: file.barsThrough,
    source: file.source,
  };
}

function formatSignedPct(n: number): string {
  if (Math.abs(n) < 0.005) return "0%";
  const body = `${Math.abs(n).toFixed(2)}%`;
  return n > 0 ? `+${body}` : `−${body}`;
}

/** One plain Japanese line for the weekly section. */
export function followupLine(summary: FollowupSummary): string {
  const span = summary.signalFrom && summary.signalTo ? `${summary.signalFrom}〜${summary.signalTo}` : "日付なし";
  const through = summary.barsThrough ?? "なし";
  const fetched = summary.fetchedAtJst || "取得時刻なし";
  const source = summary.source || "データ源なし";
  const basis = `日足は${through}まで、取得 ${fetched}、${source}`;
  const head = `通知のその後: 判定済み ${summary.decided} / 全${summary.total}（data/paper/signals.json、${span}）。`;
  const decision =
    summary.decided === 0
      ? "判定済みなし（+10日の足待ち）。"
      : `的中率 ${summary.hitRate == null ? "—" : `${summary.hitRate.toFixed(1)}%`}（的中 ${summary.hits} / 判定済み ${summary.decided}。定義: ${HIT_DEFINITION}）。`;
  const pending = `未判定 ${summary.pending}（${basis}）。`;
  const medianBasis = `日足は${through}まで、取得 ${fetched}`;
  const benchPct = (value: number | null) => (value == null ? "—" : formatSignedPct(value));
  const medianText =
    summary.ret5Median == null
      ? `+5日の中央値はまだない（+5日の終値が無い。${medianBasis}）。`
      : `+5日の中央値 ${formatSignedPct(summary.ret5Median)}（同期間SOXX 中央値 ${benchPct(summary.soxx5Median)}、SPY ${benchPct(summary.spy5Median)}、対SOXX超過 中央値 ${benchPct(summary.excess5Median)}。+5日の終値がある${summary.ret5Count}件、うちSOXX ${summary.soxx5Count}件・SPY ${summary.spy5Count}件・対SOXX超過 ${summary.excess5Count}件。${medianBasis}）。`;
  const tail = summary.decided === 0 ? `定義: ${HIT_DEFINITION}` : "";
  return `${head}${decision}${pending}${medianText}${tail}`;
}
