/**
 * Cache Yahoo split events for PIT mcap (one JSON per ticker).
 *   npx tsx scripts/backfill-pit-splits.ts
 *   npx tsx scripts/backfill-pit-splits.ts NVDA SMCI
 */
import fs from "node:fs";
import https from "node:https";
import { pitPaths, pitPriceTicker } from "../src/lib/pit-dataset";
import { normalizeYahooSplits, savePitSplits } from "../src/lib/pit-splits";
import type { YahooSplit } from "../src/lib/yahoo";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function fetchSplits(ySym: string): Promise<YahooSplit[]> {
  const path = `/v8/finance/chart/${encodeURIComponent(ySym)}?interval=1d&range=20y&events=split&includePrePost=false`;
  return new Promise((resolve, reject) => {
    https
      .get(
        { hostname: "query1.finance.yahoo.com", path, headers: { "User-Agent": UA } },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            try {
              const json = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
                chart?: { result?: Array<{ events?: { splits?: Record<string, YahooSplit> } }> };
              };
              resolve(Object.values(json.chart?.result?.[0]?.events?.splits ?? {}));
            } catch (e) {
              reject(e);
            }
          });
        },
      )
      .on("error", reject);
  });
}

async function main() {
  const dir = pitPaths().prices;
  const only = process.argv.slice(2).map((t) => t.trim().toUpperCase()).filter(Boolean);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  let n = 0;
  for (const f of files) {
    const ticker = f.replace(/\.json$/i, "").replace(/-/g, ".");
    if (only.length && !only.includes(ticker) && !only.includes(f.replace(".json", ""))) continue;
    const ySym = pitPriceTicker(ticker).replace(/\./g, "-");
    try {
      const raw = await fetchSplits(ySym);
      const splits = normalizeYahooSplits(raw);
      savePitSplits(ticker, splits);
      n += 1;
      if (n % 25 === 0) console.error(`[splits] ${n} ${ticker} (${splits.length})`);
      await sleep(80);
    } catch (e) {
      console.error(`[splits] skip ${ticker}`, e);
    }
  }
  console.log(JSON.stringify({ tickers: n }, null, 2));
}

main();
