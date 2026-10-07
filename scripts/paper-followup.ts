/**
 * Score data/paper/signals.json from Yahoo daily closes.
 * Missing +5/+10 bars stay null. A close under low20 inside 10 sessions is a miss.
 *
 *   npm run paper:followup
 */
import fs from "fs";
import path from "path";
import { FETCH_CONCURRENCY } from "../src/lib/constants";
import { formatJst } from "../src/lib/format";
import { isIgnoredTicker } from "../src/lib/holdings";
import {
  measureFollowup,
  YAHOO_DAILY_SOURCE,
  HIT_DEFINITION,
  type FollowupFile,
  type FollowupRecord,
} from "../src/lib/paper-followup";
import { parseSignals } from "../src/lib/paper-signals";
import type { Bar } from "../src/lib/types";
import { fetchDailyBars } from "../src/lib/yahoo";
import { yahooSymbolCandidates } from "../src/lib/yahoo-symbol";

const SIGNALS = path.join(process.cwd(), "data", "paper", "signals.json");
const OUT = path.join(process.cwd(), "data", "paper", "followup.json");
const NOT_FOUND_RE = /HTTP 404|not found|No data/i;

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index] as T);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

async function fetchBars(symbol: string): Promise<Bar[]> {
  let last = "日足を取得できなかった";
  const candidates = yahooSymbolCandidates(symbol);
  for (let i = 0; i < candidates.length; i += 1) {
    const yahoo = candidates[i];
    if (!yahoo) break;
    try {
      const parsed = await fetchDailyBars(yahoo, { range: "5y", keep: 1500 });
      return parsed.bars;
    } catch (error) {
      last = error instanceof Error ? error.message : "取得失敗";
      if (!(i < candidates.length - 1 && NOT_FOUND_RE.test(last))) break;
    }
  }
  throw new Error(`${symbol} ${last}`);
}

async function main() {
  if (!fs.existsSync(SIGNALS)) {
    console.error(`${SIGNALS} が無い`);
    process.exit(1);
  }
  const signals = parseSignals(JSON.parse(fs.readFileSync(SIGNALS, "utf8"))).filter((signal) => !isIgnoredTicker(signal.symbol));
  const symbols = [...new Set(signals.map((signal) => signal.symbol))];
  const bars = new Map<string, Bar[]>();
  await mapPool(symbols, FETCH_CONCURRENCY, async (symbol) => {
    bars.set(symbol, await fetchBars(symbol));
  });

  let barsThrough: string | null = null;
  for (const series of bars.values()) {
    const last = series.at(-1)?.date ?? null;
    if (last && (barsThrough == null || last > barsThrough)) barsThrough = last;
  }

  const records: FollowupRecord[] = signals.map((signal) => measureFollowup(signal, bars.get(signal.symbol) ?? null));
  const file: FollowupFile = {
    source: YAHOO_DAILY_SOURCE,
    fetchedAtJst: formatJst(new Date()),
    barsThrough,
    hitDefinition: HIT_DEFINITION,
    records,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify(file, null, 2)}\n`);
  const decided = records.filter((row) => row.status !== "pending").length;
  console.log(`followup ${records.length} decided ${decided} pending ${records.length - decided} through ${barsThrough ?? "none"}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
