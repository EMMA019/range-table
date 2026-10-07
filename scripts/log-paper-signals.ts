/**
 * Append today's entry notifications to data/paper/signals.json.
 *
 * Same rules as the site: entry_in_ok from entryAlerts, and the morning page's
 * default rows (line reached, financials off, other exclusions hidden).
 * ONDS and themeOf names (solar, crypto, nuclear, quantum, space) are never written.
 * A later run does not replace an existing ref close.
 *
 *   npm run paper:signals
 */
import fs from "fs";
import path from "path";
import { entryAlerts, finalBars, type EntryCandidate } from "../src/lib/alerts-entry";
import { todayEt } from "../src/lib/calendar";
import { passesDefaultBuyScreenForRow } from "../src/lib/candidate-screen";
import { computeQuote } from "../src/lib/compute";
import { FETCH_CONCURRENCY } from "../src/lib/constants";
import { fetchEpsBatch } from "../src/lib/eps";
import { isIgnoredTicker } from "../src/lib/holdings";
import { indexMonitorTickers } from "../src/lib/monitor-universe";
import { morningBuyLines, type MorningQuote } from "../src/lib/morning";
import { collectEntrySignals, mergeSignals, parseSignals, SOURCE_ALERT, SOURCE_MORNING, type MorningEntryInput, type PaperSignal } from "../src/lib/paper-signals";
import { profitabilityFromCache } from "../src/lib/profit-cache";
import { isSemiGroup } from "../src/lib/semis";
import type { Bar, EarningsInput, EpsSnapshot, Quote } from "../src/lib/types";
import { loadWatchlist } from "../src/lib/watchlist";
import { fetchDailyBars } from "../src/lib/yahoo";
import { yahooSymbolCandidates } from "../src/lib/yahoo-symbol";

const OUT = path.join(process.cwd(), "data", "paper", "signals.json");
const NOT_FOUND_RE = /HTTP 404|not found|No data/i;

type Listed = {
  ticker: string;
  watchOnly: boolean;
  onMorningList: boolean;
  sectorId: string;
  semi: boolean;
  earnings: EarningsInput | null;
};

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

async function fetchBars(symbol: string): Promise<Bar[] | null> {
  let last = "日足を取得できなかった";
  const candidates = yahooSymbolCandidates(symbol);
  for (let i = 0; i < candidates.length; i += 1) {
    const yahoo = candidates[i];
    if (!yahoo) break;
    try {
      const parsed = await fetchDailyBars(yahoo, { range: "6mo", keep: 80 });
      return parsed.bars;
    } catch (error) {
      last = error instanceof Error ? error.message : "取得失敗";
      if (!(i < candidates.length - 1 && NOT_FOUND_RE.test(last))) break;
    }
  }
  console.error(`[paper-signals] ${symbol} ${last}`);
  return null;
}

function morningQuoteOf(quote: {
  close: number;
  low20: number;
  high20: number;
  line25: number;
  line35: number;
  boxPct: number;
  brokeHigh: boolean;
  ma20: number;
  reboundDays: number | null;
}): MorningQuote {
  return {
    close: quote.close,
    low20: quote.low20,
    high20: quote.high20,
    line25: quote.line25,
    line35: quote.line35,
    boxPct: quote.boxPct,
    brokeHigh: quote.brokeHigh,
    ma20: quote.ma20,
    reboundDays: quote.reboundDays,
  };
}

function writeSignals(signals: PaperSignal[]) {
  const next = `${JSON.stringify({ signals }, null, 2)}\n`;
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const prev = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
  if (prev === next) {
    console.log(`signals unchanged (${signals.length})`);
    return;
  }
  fs.writeFileSync(OUT, next);
  console.log(`wrote ${OUT} (${signals.length})`);
}

async function main() {
  const now = new Date();
  const today = todayEt(now);
  const list = loadWatchlist();
  const listed: Listed[] = [];
  for (const group of list.groups) {
    for (const ticker of group.tickers) {
      if (isIgnoredTicker(ticker.ticker)) continue;
      listed.push({
        ticker: ticker.ticker,
        watchOnly: ticker.watchOnly,
        onMorningList: true,
        sectorId: group.id,
        semi: isSemiGroup(group.id),
        earnings: ticker.earnings,
      });
    }
  }
  for (const ticker of indexMonitorTickers(list)) {
    if (isIgnoredTicker(ticker)) continue;
    listed.push({
      ticker,
      watchOnly: true,
      onMorningList: false,
      sectorId: "index",
      semi: false,
      earnings: null,
    });
  }

  const symbols = [...new Set(["SPY", ...listed.map((row) => row.ticker)])];
  console.log(`[paper-signals] fetching ${symbols.length} symbols`);
  const bars = new Map<string, Bar[]>();
  let done = 0;
  await mapPool(symbols, FETCH_CONCURRENCY, async (symbol) => {
    const series = await fetchBars(symbol);
    done += 1;
    if (series) bars.set(symbol, series);
    if (done % 50 === 0 || done === symbols.length) console.log(`[paper-signals] ${done}/${symbols.length}`);
  });

  const spy = bars.get("SPY");
  const spyFinal = spy ? finalBars(spy, now) : [];
  const session = spyFinal.at(-1)?.date ?? null;
  if (!session) {
    console.error("[paper-signals] SPYの確定足が無い。ログは変えない。");
    process.exit(1);
  }

  const ready: Array<Listed & { bars: Bar[]; quote: Quote }> = [];
  for (const row of listed) {
    const series = bars.get(row.ticker);
    if (!series) continue;
    const final = finalBars(series, now);
    const computed = computeQuote(final);
    if (!computed.ok) continue;
    if (computed.quote.closeDate !== session) continue;
    ready.push({ ...row, bars: final, quote: computed.quote });
  }

  const inBand = ready.filter((row) => morningBuyLines(morningQuoteOf(row.quote)).length > 0);
  let eps: Record<string, EpsSnapshot> = {};
  try {
    eps = await fetchEpsBatch(inBand.map((row) => row.ticker));
  } catch (error) {
    console.error(`[paper-signals] EPSを取れなかった。赤字判定は不明のまま続ける。 ${error instanceof Error ? error.message : ""}`);
  }

  const candidates: EntryCandidate[] = ready.map((row) => ({
    ticker: row.ticker,
    watchOnly: row.watchOnly,
    earnings: row.earnings,
    earningsUnknown: row.earnings == null,
    bars: row.bars,
    stale: false,
    semi: row.semi,
    sectorId: row.sectorId,
    profitability: profitabilityFromCache(row.ticker, eps[row.ticker] ?? null),
  }));
  const alerts = entryAlerts(candidates, today, now, { spyBars: spyFinal, semiFull: false }).filter(
    (item) => item.facts.barDate === session,
  );
  const morning: MorningEntryInput[] = candidates.map((candidate) => {
    const row = ready.find((item) => item.ticker === candidate.ticker);
    const quote = row ? morningQuoteOf(row.quote) : null;
    return {
      ticker: candidate.ticker,
      onMorningList: row?.onMorningList ?? false,
      screenPass: quote
        ? passesDefaultBuyScreenForRow({
            ticker: candidate.ticker,
            sectorId: candidate.sectorId,
            profitability: candidate.profitability,
            brokeHigh: quote.brokeHigh,
            atr14: row?.quote.atr14 ?? null,
            close: quote.close,
          })
        : false,
      closeDate: row?.quote.closeDate ?? "",
      quote,
    };
  });

  const incoming = collectEntrySignals(alerts, morning).filter((signal) => signal.signal_date === session);
  const existing = parseSignals(fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : { signals: [] });
  const merged = mergeSignals(existing, incoming);
  const added = merged.length - existing.length;
  const alertNames = incoming.filter((signal) => signal.source === SOURCE_ALERT).length;
  const morningNames = incoming.filter((signal) => signal.source === SOURCE_MORNING).length;
  console.log(`[paper-signals] session ${session} alerts ${alertNames} morning ${morningNames} added ${added}`);
  for (const signal of incoming) {
    if (!existing.some((row) => row.signal_date === signal.signal_date && row.symbol === signal.symbol)) {
      console.log(`[paper-signals] append ${signal.signal_date} ${signal.symbol} ${signal.source}`);
    }
  }
  writeSignals(merged);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
