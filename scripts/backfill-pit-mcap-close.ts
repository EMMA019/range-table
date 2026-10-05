/**
 * Add `mcapC` (nominal Yahoo close, no backward split adjust) to PIT price files.
 *   npx tsx scripts/backfill-pit-mcap-close.ts
 *   npx tsx scripts/backfill-pit-mcap-close.ts AAPL MSFT
 */
import fs from "node:fs";
import path from "node:path";
import { fetchDailyBars } from "../src/lib/yahoo";
import { PIT_CACHE, pitPaths } from "../src/lib/pit-dataset";
import { pitPriceTicker } from "../src/lib/pit-dataset";
import type { Bar } from "../src/lib/types";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const dir = pitPaths(PIT_CACHE).prices;
  const only = process.argv.slice(2).map((t) => t.trim().toUpperCase()).filter(Boolean);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  let n = 0;
  for (const f of files) {
    let ticker = f.replace(/\.json$/i, "").replace(/-/g, ".");
    if (ticker === "JPY.X") ticker = "JPY=X";
    if (only.length && !only.includes(ticker) && !only.includes(f.replace(".json", ""))) continue;
    const full = path.join(dir, f);
    let bars = JSON.parse(fs.readFileSync(full, "utf8")) as Bar[];
    if (!bars.length && ticker === "FB") {
      const metaPath = path.join(dir, "META.json");
      if (fs.existsSync(metaPath)) bars = JSON.parse(fs.readFileSync(metaPath, "utf8")) as Bar[];
    }
    if (!bars.length) continue;
    const haveMcap = bars.filter((b) => b.mcapC != null && b.mcapC > 0).length;
    if (only.length === 0 && haveMcap / bars.length >= 0.98) continue;
    const ySym = (ticker === "JPY=X" ? "JPY=X" : pitPriceTicker(ticker)).replace(/\./g, "-");
    const outFile = ticker === "JPY=X" ? path.join(dir, "JPY-X.json") : full;
    try {
      const { bars: fresh } = await fetchDailyBars(ySym, {
        range: "20y",
        keep: 3200,
        totalReturn: false,
        applySplitAdjustment: true,
      });
      const byDate = new Map(fresh.map((b) => [b.date, b.mcapC ?? b.c]));
      let merged = 0;
      for (const b of bars) {
        const m = byDate.get(b.date);
        if (m != null && m > 0) {
          b.mcapC = m;
          merged += 1;
        }
      }
      fs.writeFileSync(outFile, JSON.stringify(ticker === "JPY=X" ? fresh : bars));
      n += 1;
      if (n % 25 === 0) console.error(`[mcapC] ${n} ${ticker} merged ${merged}/${bars.length}`);
      await sleep(90);
    } catch (e) {
      console.error(`[mcapC] skip ${ticker}`, e);
    }
  }
  console.log(JSON.stringify({ updated: n }, null, 2));
}

main();
