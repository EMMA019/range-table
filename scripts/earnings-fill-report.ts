/**
 * Count watchlist earnings coverage (watchlist / enrich). Network optional for enrich pass.
 *   npx tsx scripts/earnings-fill-report.ts
 */
import { loadWatchlist } from "../src/lib/watchlist";
import { isIgnoredTicker } from "../src/lib/holdings";
import { cachedEarningsEnrich, enrichEarningsDate, resolveEarningsInput, earningsDateUnknown } from "../src/lib/earnings-enrich";
import { cachedEpsSnapshots } from "../src/lib/market";
import type { EarningsStatus } from "../src/lib/types";

function tickers(list = loadWatchlist()): string[] {
  const out: string[] = [];
  for (const group of list.groups) {
    for (const row of group.tickers) {
      if (isIgnoredTicker(row.ticker)) continue;
      out.push(row.ticker);
    }
  }
  return out.sort();
}

type Bucket = "confirmed" | "estimated" | "unknown";

function bucket(watchDate: string | null, status: EarningsStatus | null): Bucket {
  if (!watchDate || !status) return "unknown";
  return status === "confirmed" ? "confirmed" : "estimated";
}

async function main() {
  const list = loadWatchlist();
  const symbols = tickers(list);
  const eps = cachedEpsSnapshots();
  const byTicker = new Map<string, { earnings: { date: string; status: EarningsStatus } | null }>();
  for (const group of list.groups) {
    for (const row of group.tickers) {
      if (isIgnoredTicker(row.ticker)) continue;
      byTicker.set(row.ticker, { earnings: row.earnings });
    }
  }

  const before = { confirmed: 0, estimated: 0, unknown: 0 };
  for (const symbol of symbols) {
    const watch = byTicker.get(symbol)?.earnings ?? null;
    const resolved = resolveEarningsInput(watch, eps[symbol] ?? null, null);
    const b = bucket(resolved?.date ?? null, resolved?.status ?? null);
    before[b] += 1;
  }

  for (const symbol of symbols) {
    const watch = byTicker.get(symbol)?.earnings ?? null;
    if (watch?.date) continue;
    const cached = cachedEarningsEnrich(symbol);
    if (cached?.date) continue;
    await enrichEarningsDate(symbol, watch, eps[symbol] ?? null);
  }

  const after = { confirmed: 0, estimated: 0, unknown: 0 };
  const stillUnknown: string[] = [];
  const spot: Record<string, string | null> = {};
  for (const symbol of symbols) {
    const watch = byTicker.get(symbol)?.earnings ?? null;
    const enrich = cachedEarningsEnrich(symbol);
    const resolved = resolveEarningsInput(watch, eps[symbol] ?? null, enrich);
    const b = bucket(resolved?.date ?? null, resolved?.status ?? null);
    after[b] += 1;
    if (earningsDateUnknown(watch, eps[symbol] ?? null, enrich)) stillUnknown.push(symbol);
    if (["ORCL", "NKE", "AKAM"].includes(symbol)) {
      spot[symbol] = resolved ? `${resolved.date} (${resolved.status}, ${enrich?.source ?? "watch/yahoo"})` : null;
    }
  }

  const report = {
    total: symbols.length,
    before,
    after,
    stillUnknown,
    spotCheck: spot,
  };
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
