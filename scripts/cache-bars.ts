import fs from "fs";
import path from "path";
import { buildFeatures, type Feat, type NameSeries } from "../src/lib/backtest-study";
import { isIgnoredTicker } from "../src/lib/holdings";
import type { Bar } from "../src/lib/types";
import { loadWatchlist } from "../src/lib/watchlist";
import { fetchDailyBars } from "../src/lib/yahoo";

export const BAR_CACHE = path.join(process.cwd(), "data", ".cache", "bt5");

export function yahooSymbol(ticker: string): string {
  return ticker.replace(/\./g, "-");
}

export function readCachedBars(ticker: string): Bar[] | null {
  const file = path.join(BAR_CACHE, `${yahooSymbol(ticker)}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")) as Bar[];
}

async function fetchBars(ticker: string): Promise<Bar[]> {
  const cached = readCachedBars(ticker);
  if (cached && cached.length >= 30) return cached;
  const { bars } = await fetchDailyBars(yahooSymbol(ticker), { range: "5y", keep: 1600 });
  fs.mkdirSync(BAR_CACHE, { recursive: true });
  fs.writeFileSync(path.join(BAR_CACHE, `${yahooSymbol(ticker)}.json`), JSON.stringify(bars));
  return bars;
}

export type CoreBundle = {
  names: NameSeries[];
  spy: Feat[];
  qqq: Feat[];
};

/** Core watchlist plus SPY and QQQ. Uses the study cache, and fetches a symbol only when the cache is missing. */
export async function loadCore(fetchMissing: boolean): Promise<CoreBundle> {
  const watch = loadWatchlist();
  const wanted: Array<{ ticker: string; sector: string; semi: boolean }> = [];
  for (const group of watch.groups) {
    const semi = group.id === "semi" || group.id === "equipment";
    for (const ticker of group.tickers) {
      if (isIgnoredTicker(ticker.ticker)) continue;
      wanted.push({ ticker: ticker.ticker, sector: group.name, semi });
    }
  }
  const load = async (ticker: string) => {
    const cached = readCachedBars(ticker);
    if (cached) return cached;
    if (!fetchMissing) throw new Error(`${ticker} の日足キャッシュがない。先に npm run backtest:study を実行する。`);
    return fetchBars(ticker);
  };
  const spy = buildFeatures(await load("SPY"));
  const qqq = buildFeatures(await load("QQQ"));
  const names: NameSeries[] = [];
  for (const row of wanted) {
    const bars = await load(row.ticker);
    names.push({
      ticker: row.ticker,
      sector: row.sector,
      semi: row.semi,
      core: true,
      broad: false,
      feats: buildFeatures(bars),
      earnings: [],
    });
  }
  return { names, spy, qqq };
}
