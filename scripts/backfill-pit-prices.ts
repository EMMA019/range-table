/**
 * Backfill missing PIT price files (Yahoo on price alias + legacy caches).
 */
import fs from "node:fs";
import path from "node:path";
import { fetchDailyBars } from "../src/lib/yahoo";
import { fetchStooqDailyBars, mergePriceBars } from "../src/lib/pit-prices";
import { pitPaths, pitPriceTicker, PIT_CACHE } from "../src/lib/pit-dataset";
import { loadSp500PitFiles, uniqueTickersInRange } from "../src/lib/sp500-pit";
import { SAKA_END, SAKA_START } from "../src/lib/round19-saka";
import type { Bar } from "../src/lib/types";

const LEGACY = [
  path.join(process.cwd(), "data", ".cache", "round19v2"),
  path.join(process.cwd(), "data", ".cache", "round19"),
];

function loadLegacy(sym: string): Bar[] {
  for (const dir of LEGACY) {
    const f = path.join(dir, `${sym}.json`);
    if (!fs.existsSync(f)) continue;
    const bars = JSON.parse(fs.readFileSync(f, "utf8")) as Bar[];
    if (bars.length > 50) return bars;
  }
  return [];
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const paths = pitPaths(PIT_CACHE);
  const { intervals } = await loadSp500PitFiles(PIT_CACHE);
  const pit = uniqueTickersInRange(intervals, SAKA_START, SAKA_END);
  const missing = pit.filter((t) => !fs.existsSync(path.join(paths.prices, `${t.replace(/\./g, "-")}.json`)));
  console.error(`[backfill] missing ${missing.length}`);

  const meta: Record<string, { symbol: string; sources: string[] }> = fs.existsSync(paths.priceMeta)
    ? (JSON.parse(fs.readFileSync(paths.priceMeta, "utf8")) as Record<string, { symbol: string; sources: string[] }>)
    : {};

  let saved = 0;
  for (const t of missing) {
    const ySym = pitPriceTicker(t).replace(/\./g, "-");
    const sources: string[] = [];
    let bars = loadLegacy(t.replace(/\./g, "-"));
    if (!bars.length) bars = loadLegacy(ySym);
    if (bars.length) sources.push("legacy");

    if (bars.length < 100) {
      try {
        const { bars: y } = await fetchDailyBars(ySym, { range: "20y", keep: 3200, totalReturn: true });
        if (y.length) {
          bars = mergePriceBars(y, bars);
          sources.push(`yahoo:${ySym}`);
        }
      } catch {
        /* skip */
      }
    }
    if (bars.length < 100) {
      try {
        const { bars: y } = await fetchDailyBars(t.replace(/\./g, "-"), { range: "20y", keep: 3200, totalReturn: true });
        if (y.length) {
          bars = mergePriceBars(y, bars);
          sources.push(`yahoo:${t}`);
        }
      } catch {
        /* skip */
      }
    }
    const st1 = await fetchStooqDailyBars(ySym);
    const st2 = await fetchStooqDailyBars(t);
    const st = mergePriceBars(st1, st2);
    if (st.length) {
      bars = mergePriceBars(bars, st);
      sources.push("stooq");
    }

    if (bars.length > 50) {
      fs.writeFileSync(path.join(paths.prices, `${t.replace(/\./g, "-")}.json`), JSON.stringify(bars));
      meta[t] = { symbol: ySym, sources };
      saved += 1;
      console.error(`[backfill] ${t} ${bars.length} (${sources.join("+")})`);
    } else {
      console.error(`[backfill] SKIP ${t}`);
    }
    await sleep(120);
  }

  fs.writeFileSync(paths.priceMeta, JSON.stringify(meta, null, 2));
  console.log(JSON.stringify({ saved, remaining: missing.length - saved }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
