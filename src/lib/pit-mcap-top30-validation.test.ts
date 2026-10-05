import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { buildPitCikMapForTickers } from "./pit-cik";
import { loadPitBars, loadPitCikOverrides, PIT_CACHE } from "./pit-dataset";
import { buildPitFactsIndex, loadMergedPitFacts } from "./pit-facts-index";
import { pitMarketCapForTicker } from "./pit-mcap";
import {
  filterEligibleCandidates,
  isFinancialSector,
  isSemiSubIndustry,
  profitabilityStatus,
  rebalanceDates,
  SAKA_END,
  SAKA_START,
  tradingDaysFromBars,
} from "./round19-saka";
import { dedupeShareClassesByCik } from "./pit-share-class";
import { loadSp500PitFiles, membersOnDate } from "./sp500-pit";
import { mcapCloseOnOrBefore } from "./pit-mcap-price";

const MEGA_TOP10_DATES: Record<string, readonly string[]> = {
  "2025-01-02": ["NVDA", "AVGO", "META"],
  "2026-10-01": ["NVDA", "AVGO", "META"],
};

describe("pit mcap top-30 coverage", { skip: !fs.existsSync(PIT_CACHE) }, () => {
  it("S&P top-30 by mcap appear in eligible top-30; mega names in top 10", async () => {
    const { intervals, gics } = await loadSp500PitFiles(PIT_CACHE);
    const overrides = loadPitCikOverrides().cik;
    const factsIndex = buildPitFactsIndex(PIT_CACHE);
    const spy = loadPitBars("SPY", PIT_CACHE);
    const calendar = tradingDaysFromBars(spy);
    const rebals = rebalanceDates(calendar, "2024-01-01", SAKA_END);
    const checkDates = [...new Set([...rebals.slice(-8), ...Object.keys(MEGA_TOP10_DATES)])];
    const mismatches: string[] = [];

    for (const date of checkDates) {
      const members = membersOnDate(intervals, date);
      const cikMap = await buildPitCikMapForTickers(PIT_CACHE, gics, members, overrides);
      const barsBy = new Map(members.map((t) => [t, loadPitBars(t, PIT_CACHE)]));
      const closeHistory = new Map<string, Map<string, number>>();
      for (const [t, bars] of barsBy) {
        const m = new Map<string, number>();
        for (const b of bars) m.set(b.date, b.c);
        closeHistory.set(t, m);
      }
      const factFor = (t: string) => loadMergedPitFacts(t, cikMap.get(t)?.cik ?? null, factsIndex, PIT_CACHE);
      const ctx = {
        calendar,
        closeHistory,
        gicsOf: (t: string) => {
          const g = gics.get(t);
          if (!g) return null;
          return { sector: g.sector, subIndustry: g.subIndustry, semiBucket: isSemiSubIndustry(g.subIndustry) };
        },
        mcap: (t: string, d: string) => pitMarketCapForTicker(t, barsBy.get(t) ?? [], factFor(t), d, PIT_CACHE),
        sharesLookup: () => ({ shares: 0, stale: true }),
        profitable: (t: string, d: string) => profitabilityStatus(factFor(t), d) === "profitable",
        hasPrice: (t: string, d: string) => mcapCloseOnOrBefore(barsBy.get(t) ?? [], d) != null,
        cikOf: (t: string) => cikMap.get(t)?.cik ?? null,
      };
      const spRanked = members
        .map((t) => ({ t, m: ctx.mcap(t, date) }))
        .filter((r) => r.m > 0)
        .sort((a, b) => b.m - a.m);
      const nonFinRanked = spRanked.filter((r) => {
        const g = gics.get(r.t);
        return !g || !isFinancialSector(g.sector);
      });
      const top30SpTickers = dedupeShareClassesByCik(
        nonFinRanked.slice(0, 45).map((r) => r.t),
        (t) => cikMap.get(t)?.cik ?? null,
        (t) => ctx.mcap(t, date),
      )
        .map((t) => ({ t, m: ctx.mcap(t, date) }))
        .filter((r) => r.m > 0)
        .sort((a, b) => b.m - a.m || a.t.localeCompare(b.t))
        .slice(0, 30)
        .map((r) => r.t);
      const top30Sp = new Set(top30SpTickers);
      const eligible = filterEligibleCandidates(members, date, ctx)
        .map((t) => ({ t, m: ctx.mcap(t, date) }))
        .filter((r) => r.m > 0)
        .sort((a, b) => b.m - a.m);
      const top30El = new Set(eligible.slice(0, 30).map((r) => r.t));
      for (const t of top30Sp) {
        if (!top30El.has(t) && profitabilityStatus(factFor(t), date) === "profitable") {
          const rank = nonFinRanked.findIndex((r) => r.t === t) + 1;
          mismatches.push(`${date} ${t} non-fin S&P#${rank} missing from eligible top-30`);
        }
      }
      const mega = MEGA_TOP10_DATES[date];
      if (mega) {
        const top10 = new Set(eligible.slice(0, 10).map((r) => r.t));
        for (const t of mega) {
          if (profitabilityStatus(factFor(t), date) === "profitable" && !top10.has(t)) {
            mismatches.push(`${date} ${t} not eligible top-10 (mcap ${(ctx.mcap(t, date) / 1e9).toFixed(0)}B)`);
          }
        }
      }
    }
    if (mismatches.length) console.error(mismatches.join("\n"));
    assert.equal(mismatches.length, 0, mismatches.slice(0, 10).join("; "));
  });
});
