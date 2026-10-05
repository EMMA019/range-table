/**
 * Download supplemental companyfacts (pre-reorg CIKs) for merge into PIT facts.
 *   SEC_USER_AGENT='…' npx tsx scripts/fetch-pit-facts-supplement.ts
 */
import fs from "node:fs";
import path from "node:path";
import { edgarJson } from "../src/lib/edgar-client";
import { PIT_CACHE, pitPaths } from "../src/lib/pit-dataset";

const SUPPLEMENT = path.join(process.cwd(), "data", "pit_facts_supplement_cik.json");

function companyFactsUrl(cik: number): string {
  return `https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10, "0")}.json`;
}

async function main() {
  const raw = JSON.parse(fs.readFileSync(SUPPLEMENT, "utf8")) as { cik: Record<string, number> };
  const uniq = [...new Set(Object.values(raw.cik))];
  fs.mkdirSync(pitPaths(PIT_CACHE).facts, { recursive: true });
  for (const cik of uniq) {
    const dest = path.join(pitPaths(PIT_CACHE).facts, `_supplement_cik_${cik}.json`);
    const json = await edgarJson(companyFactsUrl(cik));
    fs.writeFileSync(dest, JSON.stringify(json));
    console.log(JSON.stringify({ cik, dest, entityName: (json as { entityName?: string }).entityName }));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
