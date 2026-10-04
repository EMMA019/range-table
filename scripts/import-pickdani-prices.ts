/**
 * Import missing PIT prices from pickdani/sp500-historical (GitHub CSV).
 */
import fs from "node:fs";
import path from "node:path";
import { loadPitBars, pitPaths, PIT_CACHE } from "../src/lib/pit-dataset";
import { loadSp500PitFiles, uniqueTickersInRange } from "../src/lib/sp500-pit";
import { SAKA_END, SAKA_START } from "../src/lib/round19-saka";
import type { Bar } from "../src/lib/types";

const BASE = "https://raw.githubusercontent.com/pickdani/sp500-historical/main/prices/csv";

function parsePickdaniCsv(text: string): Bar[] {
  const lines = text.trim().split(/\r?\n/);
  const out: Bar[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const parts = lines[i].split(",");
    if (parts.length < 5) continue;
    const date = parts[0].trim();
    const close = Number(parts[4]);
    if (!date || !Number.isFinite(close) || close <= 0) continue;
    out.push({ date, o: close, h: close, l: close, c: close, v: 0 });
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

async function fetchCsv(ticker: string): Promise<Bar[]> {
  const url = `${BASE}/${encodeURIComponent(ticker)}.csv`;
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) return [];
  return parsePickdaniCsv(await res.text());
}

async function main() {
  const paths = pitPaths(PIT_CACHE);
  const { intervals } = await loadSp500PitFiles(PIT_CACHE);
  const pit = uniqueTickersInRange(intervals, SAKA_START, SAKA_END);
  const missing = pit.filter((t) => !loadPitBars(t, PIT_CACHE).length);
  console.error(`[pickdani] try ${missing.length} tickers`);

  const meta: Record<string, { symbol: string; sources: string[] }> = fs.existsSync(paths.priceMeta)
    ? (JSON.parse(fs.readFileSync(paths.priceMeta, "utf8")) as Record<string, { symbol: string; sources: string[] }>)
    : {};

  let saved = 0;
  for (const t of missing) {
    const bars = await fetchCsv(t);
    if (bars.length < 50) continue;
    fs.writeFileSync(path.join(paths.prices, `${t.replace(/\./g, "-")}.json`), JSON.stringify(bars));
    meta[t] = { symbol: t, sources: ["pickdani:github"] };
    saved += 1;
    console.error(`[pickdani] ${t} ${bars.length}`);
  }
  fs.writeFileSync(paths.priceMeta, JSON.stringify(meta, null, 2));
  console.log(JSON.stringify({ saved, tried: missing.length }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
