/**
 * Refresh S&P 500 + Nasdaq-100 monitor union (data/monitor_index.json).
 *   npx tsx scripts/refresh-monitor-index.ts [YYYY-MM-DD]
 *
 * SP500: fja05680/sp500 membership on as-of date.
 * NDX100: Nasdaq public quote API (list-type/nasdaq100).
 */
import fs from "fs";
import path from "path";
import { membersOnDate, parseTickerStartEndCsv } from "../src/lib/sp500-pit";

const OUT = path.join(process.cwd(), "data", "monitor_index.json");
const SP500_URL =
  "https://raw.githubusercontent.com/fja05680/sp500/master/sp500_ticker_start_end.csv";
const NDX100_URL = "https://api.nasdaq.com/api/quote/list-type/nasdaq100";

function normTicker(t: string): string {
  return t.trim().toUpperCase().replace(/\./g, "-");
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": "range-table-monitor/1.0 (refresh script)" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

async function fetchNasdaq100(): Promise<string[]> {
  const res = await fetch(NDX100_URL, { headers: { "User-Agent": "Mozilla/5.0 (range-table refresh)" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${NDX100_URL}`);
  const json = (await res.json()) as {
    data?: { data?: { rows?: Array<{ symbol?: string }> } };
  };
  const rows = json.data?.data?.rows ?? [];
  const tickers = rows.map((r) => (r.symbol ? normTicker(r.symbol) : "")).filter(Boolean);
  if (tickers.length < 90) throw new Error(`Nasdaq-100 API returned ${tickers.length} tickers`);
  return [...new Set(tickers)].sort((a, b) => a.localeCompare(b));
}

/** Parse tickers from Wikipedia Nasdaq-100 component tables (fallback / tests). */
export function parseNasdaq100FromWiki(html: string): string[] {
  const tickers = new Set<string>();
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let row: RegExpExecArray | null;
  while ((row = rowRe.exec(html)) !== null) {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) =>
      m[1].replace(/<[^>]+>/g, "").trim(),
    );
    if (cells.length < 2) continue;
    const candidate = normTicker(cells[0]);
    if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(candidate)) continue;
    if (candidate === "TICKER" || candidate === "SYMBOL") continue;
    tickers.add(candidate);
  }
  const list = [...tickers].sort((a, b) => a.localeCompare(b));
  if (list.length < 90 || list.length > 110) {
    throw new Error(`Nasdaq-100 parse got ${list.length} tickers (expected ~100)`);
  }
  return list;
}

async function main() {
  const asOfDate = process.argv[2] ?? new Date().toISOString().slice(0, 10);
  const spCsv = await fetchText(SP500_URL);
  const intervals = parseTickerStartEndCsv(spCsv);
  const sp500 = membersOnDate(intervals, asOfDate);

  const ndx100 = await fetchNasdaq100();

  const unionSet = new Set<string>([...sp500, ...ndx100]);
  const union = [...unionSet].sort((a, b) => a.localeCompare(b));

  const doc = {
    generatedAt: new Date().toISOString(),
    asOfDate,
    sources: {
      sp500: SP500_URL,
      ndx100: NDX100_URL,
    },
    sp500,
    ndx100,
    union,
  };
  fs.writeFileSync(OUT, `${JSON.stringify(doc, null, 2)}\n`);
  console.log(
    `Wrote ${OUT}: SP500=${sp500.length} NDX100=${ndx100.length} union=${union.length} (as-of ${asOfDate})`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
