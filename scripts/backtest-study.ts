import fs from "fs";
import path from "path";
import { buildFeatures, buildStudy, type NameSeries } from "../src/lib/backtest-study";
import { renderStudyMarkdown } from "../src/lib/backtest-study-report";
import { isIgnoredTicker } from "../src/lib/holdings";
import { loadWatchlist } from "../src/lib/watchlist";
import type { Bar } from "../src/lib/types";
import { fetchDailyBars } from "../src/lib/yahoo";

/**
 * Offline. Writes data/backtest/study.json and docs/BACKTEST_STUDY.md.
 * Bars and the earnings-calendar cache stay in gitignored data/.cache/.
 *
 *   npm run backtest:study
 *   npm run backtest:study -- --fresh
 */
const CACHE = path.join(process.cwd(), "data", ".cache", "bt5");
const EARN = path.join(process.cwd(), "data", ".cache", "earn");
const OUT = path.join(process.cwd(), "data", "backtest", "study.json");
const DOC = path.join(process.cwd(), "docs", "BACKTEST_STUDY.md");
const FROM = "2024-10-03";
const TO = "2026-10-02";

const UA = "Mozilla/5.0 (compatible; range-table-study/1.0)";

function yahooSymbol(ticker: string): string {
  return ticker.replace(/\./g, "-");
}

async function pool<T>(items: T[], width: number, fn: (item: T, index: number) => Promise<void>): Promise<void> {
  let cursor = 0;
  async function worker() {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: width }, () => worker()));
}

async function loadBars(ticker: string, fresh: boolean): Promise<Bar[]> {
  const file = path.join(CACHE, `${yahooSymbol(ticker)}.json`);
  if (!fresh && fs.existsSync(file)) {
    const cached = JSON.parse(fs.readFileSync(file, "utf8")) as Bar[];
    if (cached.length >= 30 && cached[cached.length - 1].date >= "2026-09-01") return cached;
  }
  let last: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const { bars } = await fetchDailyBars(yahooSymbol(ticker), { range: "5y", keep: 1600 });
      fs.writeFileSync(file, JSON.stringify(bars));
      return bars;
    } catch (error) {
      last = error instanceof Error ? error : new Error(String(error));
      await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
    }
  }
  throw last ?? new Error(`${ticker} の日足が取れなかった`);
}

type Listed = { ticker: string; sector: string; sub: string; name: string };

async function sp500(): Promise<Listed[]> {
  const text = await (await fetch("https://raw.githubusercontent.com/datasets/s-and-p-500-companies/master/data/constituents.csv", { headers: { "User-Agent": UA } })).text();
  return text
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((line) => {
      const [ticker, name, sector, sub] = splitCsv(line);
      return { ticker, name, sector, sub };
    })
    .filter((row) => /^[A-Z][A-Z0-9.]{0,9}$/.test(row.ticker));
}

async function nasdaq100(): Promise<Array<{ ticker: string; name: string }>> {
  const json = (await (
    await fetch("https://api.nasdaq.com/api/quote/list-type/nasdaq100", {
      headers: { "User-Agent": UA, Accept: "application/json" },
    })
  ).json()) as { data?: { data?: { rows?: Array<{ symbol?: string; companyName?: string }> } } };
  const rows = json.data?.data?.rows ?? [];
  return rows
    .map((row) => ({ ticker: row.symbol ?? "", name: row.companyName ?? "" }))
    .filter((row) => /^[A-Z][A-Z0-9.]{0,9}$/.test(row.ticker));
}

function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === "," && !quoted) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

async function earningsFor(date: string): Promise<string[] | null> {
  const file = path.join(EARN, `${date}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8")) as string[];
  try {
    const response = await fetch(`https://api.nasdaq.com/api/calendar/earnings?date=${date}`, {
      headers: { "User-Agent": UA, Accept: "application/json" },
    });
    if (!response.ok) return null;
    const json = (await response.json()) as { data?: { rows?: Array<{ symbol?: string }> } | null };
    const symbols = (json.data?.rows ?? []).map((row) => row.symbol ?? "").filter(Boolean);
    fs.writeFileSync(file, JSON.stringify(symbols));
    return symbols;
  } catch {
    return null;
  }
}

async function main() {
  const fresh = process.argv.includes("--fresh");
  fs.mkdirSync(CACHE, { recursive: true });
  fs.mkdirSync(EARN, { recursive: true });
  fs.mkdirSync(path.dirname(OUT), { recursive: true });

  const watch = loadWatchlist();
  const coreMeta = new Map<string, { sector: string; semi: boolean; earnings: string | null }>();
  for (const group of watch.groups) {
    const semi = group.id === "semi" || group.id === "equipment";
    for (const ticker of group.tickers) {
      if (isIgnoredTicker(ticker.ticker)) continue;
      coreMeta.set(ticker.ticker, { sector: group.name, semi, earnings: ticker.earnings?.date ?? null });
    }
  }

  console.log("lists");
  const [sp, ndx] = await Promise.all([sp500(), nasdaq100()]);
  const broad = new Map<string, { sector: string; semi: boolean }>();
  for (const row of sp) {
    if (isIgnoredTicker(row.ticker)) continue;
    broad.set(row.ticker, { sector: row.sector, semi: /semiconductor/i.test(row.sub) });
  }
  for (const row of ndx) {
    if (isIgnoredTicker(row.ticker) || broad.has(row.ticker)) {
      if (broad.has(row.ticker) && /semiconductor/i.test(row.name)) {
        const prev = broad.get(row.ticker);
        if (prev) prev.semi = true;
      }
      continue;
    }
    broad.set(row.ticker, { sector: "Nasdaq-100", semi: /semiconductor/i.test(row.name) });
  }
  for (const [ticker, meta] of coreMeta) {
    if (!meta.semi) continue;
    const row = broad.get(ticker);
    if (row) row.semi = true;
  }

  const tickers = [...new Set([...coreMeta.keys(), ...broad.keys(), "SPY", "QQQ", "SOXX"])];
  console.log(`fetch ${tickers.length} symbols (SP ${sp.length}, NDX ${ndx.length}, core ${coreMeta.size})`);
  const bars = new Map<string, Bar[]>();
  const missingCore: string[] = [];
  const spyBars = await loadBars("SPY", fresh);
  bars.set("SPY", spyBars);
  const sessions = spyBars.map((bar) => bar.date).filter((date) => date >= "2024-09-15" && date <= TO);
  const earnDays = sessions.filter((date) => date >= FROM && date <= TO);
  console.log(`earnings calendar ${earnDays.length} days, alongside ${tickers.length - 1} other symbols`);
  const earnByAlias = new Map<string, Set<string>>();
  let earningsGaps = 0;
  const others = tickers.filter((ticker) => ticker !== "SPY");
  await Promise.all([
    pool(others, 3, async (ticker, index) => {
      try {
        bars.set(ticker, await loadBars(ticker, fresh));
      } catch (error) {
        if (coreMeta.has(ticker)) missingCore.push(ticker);
        console.error(`${ticker}: ${error instanceof Error ? error.message : error}`);
      }
      if ((index + 1) % 25 === 0) console.log(`bars ${index + 1}/${others.length}`);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }),
    pool(earnDays, 4, async (date, index) => {
      const symbols = await earningsFor(date);
      if (!symbols) {
        earningsGaps += 1;
        return;
      }
      for (const symbol of symbols) {
        const set = earnByAlias.get(symbol) ?? new Set<string>();
        set.add(date);
        earnByAlias.set(symbol, set);
      }
      if ((index + 1) % 50 === 0) console.log(`earn ${index + 1}/${earnDays.length} gaps ${earningsGaps}`);
    }),
  ]);

  const datesFor = (ticker: string) => {
    const out = new Set<string>();
    for (const alias of [ticker, yahooSymbol(ticker), ticker.replace(/-/g, ".")]) {
      for (const date of earnByAlias.get(alias) ?? []) out.add(date);
    }
    return [...out].sort();
  };

  const names: NameSeries[] = [];
  for (const ticker of tickers) {
    if (ticker === "SPY" || ticker === "QQQ" || ticker === "SOXX") continue;
    const series = bars.get(ticker);
    if (!series || !series.some((bar) => bar.date >= FROM && bar.date <= TO)) continue;
    const core = coreMeta.get(ticker);
    const wide = broad.get(ticker);
    const earnings = datesFor(ticker);
    if (core?.earnings) earnings.push(core.earnings);
    names.push({
      ticker,
      sector: core?.sector ?? wide?.sector ?? "その他",
      semi: Boolean(core?.semi || wide?.semi),
      core: Boolean(core),
      broad: Boolean(wide),
      feats: buildFeatures(series),
      earnings: [...new Set(earnings)].sort(),
    });
  }

  console.log(`compute ${names.length} names`);
  const report = buildStudy({
    names,
    spy: buildFeatures(spyBars),
    qqq: buildFeatures(bars.get("QQQ") ?? []),
    soxx: buildFeatures(bars.get("SOXX") ?? []),
    earningsGaps,
    earningsDays: earnDays.length,
    generatedAt: new Date().toISOString(),
    broadListed: broad.size,
    missingCore: missingCore.sort(),
  });
  fs.writeFileSync(OUT, `${JSON.stringify(report, null, 1)}\n`);
  fs.writeFileSync(DOC, renderStudyMarkdown(report));
  const kb = Math.round(fs.statSync(OUT).size / 1024);
  const base = report.base.stats;
  console.log(`${kb}KB → ${path.relative(process.cwd(), OUT)}`);
  console.log(`base n=${base.n} win=${base.winRate} avg=${base.avgUsd} pf=${base.profitFactor} dd=${base.maxDrawdownUsd}`);
  console.log(report.headline.chase, report.headline.adopted.join(" | ") || "(no single-factor adopt)");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
