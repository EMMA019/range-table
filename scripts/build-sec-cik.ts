import fs from "fs";
import path from "path";
import { edgarJson, secUserAgent, SEC_USER_AGENT_ENV } from "../src/lib/edgar-client";
import { SEC_CIK_PATH } from "../src/lib/edgar-filings";
import { isIgnoredTicker } from "../src/lib/holdings";
import { loadWatchlist } from "../src/lib/watchlist";

/**
 * Rebuilds data/sec_cik.json from SEC's public ticker map for the watchlist names only.
 * Run after editing watchlist.yaml:  SEC_USER_AGENT="range-table you@example.com" npx tsx scripts/build-sec-cik.ts
 */
type TickerRow = { cik_str: number; ticker: string; title: string };

async function main() {
  if (!secUserAgent()) throw new Error(`${SEC_USER_AGENT_ENV} に連絡先メール入りのUser-Agentを入れて実行する`);
  const rows = Object.values(await edgarJson<Record<string, TickerRow>>("https://www.sec.gov/files/company_tickers.json"));
  const bySymbol = new Map(rows.map((row) => [row.ticker.toUpperCase(), row]));
  const ciks: Record<string, number> = {};
  const missing: string[] = [];
  for (const group of loadWatchlist().groups) {
    for (const { ticker } of group.tickers) {
      if (isIgnoredTicker(ticker)) continue;
      const row = bySymbol.get(ticker.replace(/\./g, "-"));
      if (row) ciks[ticker] = row.cik_str;
      else missing.push(ticker);
    }
  }
  const body = {
    note: "SEC の company_tickers.json から watchlist の銘柄だけ抜いた CIK。scripts/build-sec-cik.ts で再生成する",
    source: "https://www.sec.gov/files/company_tickers.json",
    ciks,
  };
  fs.writeFileSync(path.resolve(SEC_CIK_PATH), `${JSON.stringify(body, null, 2)}\n`);
  console.log(`${Object.keys(ciks).length} tickers written${missing.length ? `, missing: ${missing.join(" ")}` : ""}`);
  if (missing.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
