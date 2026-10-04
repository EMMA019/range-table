/**
 * Refetch companyfacts for one PIT ticker (uses CIK overrides).
 *   SEC_USER_AGENT='…' npx tsx scripts/fetch-pit-ticker-facts.ts XOM
 */
import fs from "node:fs";
import path from "node:path";
import { edgarJson } from "../src/lib/edgar-client";
import { buildPitCikMapForTickers } from "../src/lib/pit-cik";
import { PIT_CACHE, loadPitCikOverrides, pitPaths } from "../src/lib/pit-dataset";
import { loadSp500PitFiles } from "../src/lib/sp500-pit";

function companyFactsUrl(cik: number): string {
  return `https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10, "0")}.json`;
}

async function main() {
  const ticker = (process.argv[2] ?? "").trim().toUpperCase();
  if (!ticker) {
    console.error("usage: fetch-pit-ticker-facts.ts TICKER");
    process.exit(1);
  }
  const { gics } = await loadSp500PitFiles(PIT_CACHE);
  const overrides = loadPitCikOverrides().cik;
  const map = await buildPitCikMapForTickers(PIT_CACHE, gics, [ticker], overrides);
  const res = map.get(ticker);
  if (!res) {
    console.error(`no CIK for ${ticker}`);
    process.exit(1);
  }
  const paths = pitPaths(PIT_CACHE);
  fs.mkdirSync(paths.facts, { recursive: true });
  const dest = path.join(paths.facts, `${ticker}.json`);
  const json = await edgarJson(companyFactsUrl(res.cik));
  fs.writeFileSync(dest, JSON.stringify(json));
  console.log(JSON.stringify({ ticker, cik: res.cik, dest, entityName: (json as { entityName?: string }).entityName }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
