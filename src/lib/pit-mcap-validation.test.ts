import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { buildPitCikMapForTickers } from "./pit-cik";
import { loadPitBars, loadPitCikOverrides, PIT_CACHE } from "./pit-dataset";
import { buildPitFactsIndex, loadMergedPitFacts } from "./pit-facts-index";
import { pitMarketCapForTicker } from "./pit-mcap";
import { mcapCloseOnOrBefore } from "./pit-mcap-price";
import { filterEligibleCandidates, isSemiSubIndustry, profitabilityStatus, tradingDaysFromBars } from "./round19-saka";
import { loadSp500PitFiles, membersOnDate } from "./sp500-pit";

const CHECK_DATES = ["2016-01-04", "2019-01-02", "2022-01-03", "2026-10-01"];
const MEGA = ["AAPL", "MSFT", "GOOGL", "AMZN"] as const;

/** Rough Yahoo marketCap sanity (billions USD); wide bands for test stability. */
const REF_B = {
  "2016-01-04": { AAPL: [400, 700], MSFT: [350, 550], GOOGL: [450, 650], AMZN: [250, 400] },
  "2019-01-02": { AAPL: [600, 1100], MSFT: [600, 950], GOOGL: [600, 900], AMZN: [600, 1000] },
  "2022-01-03": { AAPL: [2200, 3200], MSFT: [2200, 3200], GOOGL: [1600, 2400], AMZN: [1400, 2200] },
  "2026-10-01": { AAPL: [3400, 4600], MSFT: [3400, 4600], GOOGL: [2800, 4000], AMZN: [2200, 3200] },
} as const;


describe("pit mcap validation", { skip: !fs.existsSync(PIT_CACHE) }, () => {
  it("mega-caps rank in eligible top 10 and within reference bands", async () => {
    const { intervals, gics } = await loadSp500PitFiles(PIT_CACHE);
    const overrides = loadPitCikOverrides().cik;
    const factsIndex = buildPitFactsIndex(PIT_CACHE);
    const spy = loadPitBars("SPY", PIT_CACHE);
    const calendar = tradingDaysFromBars(spy);
    const mismatches: string[] = [];

    for (const date of CHECK_DATES) {
      const members = membersOnDate(intervals, date);
      const cikMap = await buildPitCikMapForTickers(PIT_CACHE, gics, members, overrides);
      const factCache = new Map<string, unknown>();
      const factFor = (t: string) => {
        if (factCache.has(t)) return factCache.get(t);
        const j = loadMergedPitFacts(t, cikMap.get(t)?.cik ?? null, factsIndex, PIT_CACHE);
        factCache.set(t, j);
        return j;
      };
      const barsBy = new Map<string, ReturnType<typeof loadPitBars>>();
      const closeHistory = new Map<string, Map<string, number>>();
      for (const t of members) {
        const bars = loadPitBars(t, PIT_CACHE);
        barsBy.set(t, bars);
        const m = new Map<string, number>();
        for (const b of bars) m.set(b.date, b.c);
        closeHistory.set(t, m);
      }
      const lastSh = new Map<string, number>();
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
      const top10 = new Set(ranked.slice(0, 10).map((r) => r.t));
      for (const t of MEGA) {
        const profit = profitabilityStatus(factFor(t), date);
        const mcapB = ctx.mcap(t, date) / 1e9;
        const band = REF_B[date as keyof typeof REF_B][t];
        if (profit === "profitable" && !top10.has(t)) {
          mismatches.push(`${date} ${t} profitable but eligible rank >10 (mcap ${mcapB.toFixed(0)}B)`);
        }
        if (mcapB > 0 && (mcapB < band[0] * 0.7 || mcapB > band[1] * 1.3)) {
          mismatches.push(`${date} ${t} mcap ${mcapB.toFixed(0)}B outside ~${band[0]}-${band[1]}B ref`);
        }
      }
    }
    if (mismatches.length) {
      console.error(mismatches.join("\n"));
    }
    assert.equal(mismatches.length, 0, mismatches.slice(0, 8).join("; "));
  });
});
