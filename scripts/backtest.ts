import fs from "fs";
import path from "path";
import { summarize, type TickerBars } from "../src/lib/backtest";
import { isIgnoredTicker } from "../src/lib/holdings";
import { loadWatchlist } from "../src/lib/watchlist";
import { fetchDailyBars } from "../src/lib/yahoo";
import type { Bar } from "../src/lib/types";

/**
 * Offline. Fetches about two years of daily bars for the watchlist, runs the pattern test, and
 * writes data/backtest/summary.json (market data only, safe to commit). Bars are cached in the
 * gitignored data/.cache/bt/ for a day so a rerun does not hit Yahoo again.
 *
 *   npm run backtest            # uses the cache when it is fresh
 *   npm run backtest -- --fresh # refetch everything
 */
const CACHE_DIR = path.join(process.cwd(), "data", ".cache", "bt");
const OUT = path.join(process.cwd(), "data", "backtest", "summary.json");
const CACHE_MS = 24 * 60 * 60 * 1000;
const GAP_MS = 500;

async function barsFor(ticker: string, fresh: boolean): Promise<Bar[]> {
  const file = path.join(CACHE_DIR, `${ticker}.json`);
  if (!fresh && fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs < CACHE_MS) {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Bar[];
  }
  await new Promise((resolve) => setTimeout(resolve, GAP_MS));
  const { bars } = await fetchDailyBars(ticker, { range: "2y", keep: 600 });
  fs.writeFileSync(file, JSON.stringify(bars));
  return bars;
}

async function main() {
  const fresh = process.argv.includes("--fresh");
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const tickers = loadWatchlist()
    .groups.flatMap((group) => group.tickers.map((ticker) => ticker.ticker))
    .filter((ticker) => !isIgnoredTicker(ticker));

  const series: TickerBars[] = [];
  const missing: string[] = [];
  for (const [index, ticker] of tickers.entries()) {
    try {
      series.push({ ticker, bars: await barsFor(ticker, fresh) });
    } catch (error) {
      missing.push(ticker);
      console.error(`${ticker}: ${error instanceof Error ? error.message : error}`);
    }
    if ((index + 1) % 25 === 0) console.log(`${index + 1}/${tickers.length}`);
  }

  const summary = summarize(series, missing);
  fs.writeFileSync(OUT, `${JSON.stringify(summary, null, 1)}\n`);
  const kb = Math.round(fs.statSync(OUT).size / 1024);
  console.log(`${series.length} tickers, ${summary.period.from}..${summary.period.to}, ${kb}KB → ${path.relative(process.cwd(), OUT)}`);
  for (const row of summary.byAtrThreshold) {
    const s = row.rebound15;
    console.log(
      `ATR≥${row.minAtrPct ?? 0}%: n=${s.n} win=${s.winRate} exp=$${s.expectancyUsd} (${s.expectancyAtr} ATR) PF=${s.profitFactor} | in_ok n=${row.in_ok.n} win=${row.in_ok.winRate} exp=$${row.in_ok.expectancyUsd}`,
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
