/**
 * Mismatch table for PIT mcap vs reference bands (see pit-mcap-validation.test.ts).
 *   npx tsx scripts/pit-mcap-validation-report.ts
 */
import fs from "node:fs";
import { buildPitCikMapForTickers } from "../src/lib/pit-cik";
import { loadPitBars, loadPitCikOverrides, PIT_CACHE } from "../src/lib/pit-dataset";
import { buildPitFactsIndex, loadMergedPitFacts } from "../src/lib/pit-facts-index";
import { mcapCloseOnOrBefore } from "../src/lib/pit-mcap-price";
import { sharesOutstandingAsOf } from "../src/lib/pit-shares";
import {
  filterEligibleCandidates,
  isSemiSubIndustry,
  profitabilityStatus,
  tradingDaysFromBars,
} from "../src/lib/round19-saka";
import { loadSp500PitFiles, membersOnDate } from "../src/lib/sp500-pit";
import type { Bar } from "../src/lib/types";

const CHECK_DATES = ["2016-01-04", "2019-01-02", "2022-01-03", "2026-10-01"];
const MEGA = ["AAPL", "MSFT", "GOOGL", "AMZN"] as const;
const REF_B = {
  "2016-01-04": { AAPL: [400, 700], MSFT: [350, 550], GOOGL: [450, 650], AMZN: [250, 400] },
  "2019-01-02": { AAPL: [600, 1100], MSFT: [600, 950], GOOGL: [600, 900], AMZN: [600, 1000] },
  "2022-01-03": { AAPL: [2200, 3200], MSFT: [2200, 3200], GOOGL: [1600, 2400], AMZN: [1400, 2200] },
  "2026-10-01": { AAPL: [3400, 4600], MSFT: [3400, 4600], GOOGL: [2800, 4000], AMZN: [2200, 3200] },
} as const;

async function main() {
  const { intervals, gics } = await loadSp500PitFiles(PIT_CACHE);
  const overrides = loadPitCikOverrides().cik;
  const factsIndex = buildPitFactsIndex(PIT_CACHE);
  const spy = loadPitBars("SPY", PIT_CACHE);
  const calendar = tradingDaysFromBars(spy);
  const rows: string[] = [];

  for (const date of CHECK_DATES) {
    const members = membersOnDate(intervals, date);
    const cikMap = await buildPitCikMapForTickers(PIT_CACHE, gics, members, overrides);
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
      mcap: (t: string, d: string) => {
        const px = mcapCloseOnOrBefore(barsBy.get(t) ?? [], d);
        const f = factFor(t);
        let sh = f ? sharesOutstandingAsOf(f, d) : null;
        if (sh != null && sh > 0) lastSh.set(t, sh);
        else sh = lastSh.get(t) ?? null;
        if (!px || !sh) return 0;
        return px * sh;
      },
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
      const refMid = (band[0] + band[1]) / 2;
      const errPct = refMid > 0 ? ((mcapB - refMid) / refMid) * 100 : 0;
      const rank = ranked.findIndex((r) => r.t === t) + 1;
      const flags: string[] = [];
      if (profit === "profitable" && !top10.has(t)) flags.push("rank>10");
      if (mcapB > 0 && (mcapB < band[0] * 0.7 || mcapB > band[1] * 1.3)) flags.push("ref band");
      rows.push(
        `| ${date} | ${t} | ${mcapB.toFixed(0)} | ${band[0]}–${band[1]} | ${errPct >= 0 ? "+" : ""}${errPct.toFixed(0)}% | ${rank || "—"} | ${profit} | ${flags.length ? flags.join(", ") : "ok"} |`,
      );
    }
  }
  console.log(`| date | ticker | mcap B | ref B | vs ref mid | eligible rank | profit | status |
|---|---|---:|---|---:|---:|---|---|
${rows.join("\n")}`);
}

main();
