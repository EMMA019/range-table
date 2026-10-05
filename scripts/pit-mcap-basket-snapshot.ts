/**
 * Eligible top-15 by PIT mcap at a date (for STOP-SHIP before/after).
 *   npx tsx scripts/pit-mcap-basket-snapshot.ts 2016-01-04 2026-10-01
 */
import fs from "node:fs";
import { buildPitCikMapForTickers } from "../src/lib/pit-cik";
import { loadPitBars, loadPitCikOverrides, PIT_CACHE } from "../src/lib/pit-dataset";
import { buildPitFactsIndex, loadMergedPitFacts } from "../src/lib/pit-facts-index";
import { pitMarketCapForTicker } from "../src/lib/pit-mcap";
import { mcapCloseOnOrBefore } from "../src/lib/pit-mcap-price";
import {
  filterEligibleCandidates,
  isSemiSubIndustry,
  profitabilityStatus,
  tradingDaysFromBars,
} from "../src/lib/round19-saka";
import { loadSp500PitFiles, membersOnDate } from "../src/lib/sp500-pit";
import type { Bar } from "../src/lib/types";

const dates = process.argv.slice(2).filter(Boolean);
if (!dates.length) dates.push("2016-01-04", "2026-10-01");

async function snapshot(date: string) {
  const { intervals, gics } = await loadSp500PitFiles(PIT_CACHE);
  const overrides = loadPitCikOverrides().cik;
  const members = membersOnDate(intervals, date);
  const cikMap = await buildPitCikMapForTickers(PIT_CACHE, gics, members, overrides);
  const factsIndex = buildPitFactsIndex(PIT_CACHE);
  const spy = loadPitBars("SPY", PIT_CACHE);
  const calendar = tradingDaysFromBars(spy);
  const barsBy = new Map<string, Bar[]>();
  const closeHistory = new Map<string, Map<string, number>>();
  for (const t of members) {
    const bars = loadPitBars(t, PIT_CACHE);
    barsBy.set(t, bars);
    const m = new Map<string, number>();
    for (const b of bars) m.set(b.date, b.c);
    closeHistory.set(t, m);
  }
  const lastSh = new Map<string, number>();
  const factFor = (t: string) => loadMergedPitFacts(t, cikMap.get(t)?.cik ?? null, factsIndex, PIT_CACHE);
  const ctx = {
    calendar,
    closeHistory,
    gicsOf: (t: string) => {
      const g = gics.get(t);
      if (!g) return null;
      return { sector: g.sector, subIndustry: g.subIndustry, semiBucket: isSemiSubIndustry(g.subIndustry) };
    },
    mcap: (t: string, d: string) =>
      pitMarketCapForTicker(t, barsBy.get(t) ?? [], factFor(t), d, PIT_CACHE),
    sharesLookup: () => ({ shares: 0, stale: true }),
    profitable: (t: string, d: string) => profitabilityStatus(factFor(t), d) === "profitable",
    hasPrice: (t: string, d: string) => mcapCloseOnOrBefore(barsBy.get(t) ?? [], d) != null,
    cikOf: (t: string) => cikMap.get(t)?.cik ?? null,
  };
  const ranked = filterEligibleCandidates(members, date, ctx)
    .map((t) => ({ t, m: ctx.mcap(t, date) }))
    .filter((r) => r.m > 0)
    .sort((a, b) => b.m - a.m);
  console.log(`\n=== ${date} eligible top 15 ===`);
  ranked.slice(0, 15).forEach((r, i) => console.log(`${i + 1}. ${r.t} ${(r.m / 1e9).toFixed(1)}B`));
}

async function main() {
  for (const d of dates) await snapshot(d);
}

main();
