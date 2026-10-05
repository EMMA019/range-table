/**
 * Fetch EDGAR companyfacts for all PIT tickers (2016–2026). Cache: data/.cache/round19v2/facts/
 *   SEC_USER_AGENT='range-table you@example.com' npx tsx scripts/round19-fetch-pit-facts.ts
 */
import fs from "node:fs";
import path from "node:path";
import { edgarJson, EdgarDisabledError } from "../src/lib/edgar-client";
import { SAKA_END, SAKA_START } from "../src/lib/round19-saka";
import { buildFullTickerCikMap, loadSecTickerCikMap, resolveCik } from "../src/lib/sec-ticker-cik";
import { loadSp500PitFiles, uniqueTickersInRange } from "../src/lib/sp500-pit";

const CACHE = path.join(process.cwd(), "data", ".cache", "round19v2");
const CACHE_V1 = path.join(process.cwd(), "data", ".cache", "round19");

function companyFactsUrl(cik: number): string {
  return `https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10, "0")}.json`;
}

async function main() {
  if (!process.env.SEC_USER_AGENT?.trim()) {
    console.error("SEC_USER_AGENT required");
    process.exit(1);
  }
  const { intervals, gics } = await loadSp500PitFiles(CACHE);
  const secMap = await loadSecTickerCikMap(CACHE);
  const cikMap = buildFullTickerCikMap(gics, secMap);
  const tickers = uniqueTickersInRange(intervals, SAKA_START, SAKA_END);
  const factsDir = path.join(CACHE, "facts");
  fs.mkdirSync(factsDir, { recursive: true });

  let fetched = 0;
  let skipped = 0;
  let noCik = 0;
  let failed = 0;

  for (const t of tickers) {
    const out = path.join(factsDir, `${t}.json`);
    if (fs.existsSync(out)) {
      skipped += 1;
      continue;
    }
    const v1 = path.join(CACHE_V1, "facts", `${t}.json`);
    if (fs.existsSync(v1)) {
      fs.copyFileSync(v1, out);
      skipped += 1;
      continue;
    }
    const cik = resolveCik(t, gics.get(t)?.cik, cikMap);
    if (!cik) {
      noCik += 1;
      continue;
    }
    try {
      const json = await edgarJson(companyFactsUrl(cik));
      fs.writeFileSync(out, JSON.stringify(json));
      fetched += 1;
      if (fetched % 25 === 0) console.error(`[facts] fetched ${fetched} (skip ${skipped})`);
    } catch (e) {
      if (e instanceof EdgarDisabledError) break;
      failed += 1;
    }
  }

  const have = fs.readdirSync(factsDir).filter((f) => f.endsWith(".json")).length;
  console.log(JSON.stringify({ tickers: tickers.length, have, fetched, skipped, noCik, failed }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
