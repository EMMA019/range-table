import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { buildPitCikMapForTickers } from "./pit-cik";
import { loadPitBars, loadPitCikOverrides, PIT_CACHE } from "./pit-dataset";
import { buildPitFactsIndex, loadMergedPitFacts } from "./pit-facts-index";
import { mcapCloseOnOrBefore } from "./pit-mcap-price";
import { sharesOutstandingAsOf } from "./pit-shares";
import {
  filterEligibleCandidates,
  isSemiSubIndustry,
  pickHoldings,
  profitabilityStatus,
  rebalanceDates,
  SAKA_CONFIGS,
  SAKA_END,
  SAKA_START,
  tradingDaysFromBars,
  type SakaCandidateContext,
} from "./round19-saka";
import { loadSp500PitFiles, membersOnDate } from "./sp500-pit";
import type { Bar } from "./types";

function mcapFloorUsd(date: string): number {
  const y = Number(date.slice(0, 4));
  return y >= 2021 ? 100e9 : 50e9;
}

function buildMcapCtx(
  members: string[],
  date: string,
  calendar: string[],
  barsBy: Map<string, Bar[]>,
  closeHistory: Map<string, Map<string, number>>,
  factFor: (t: string) => unknown | undefined,
  cikOf: (t: string) => number | null,
  gics: Map<string, { sector: string; subIndustry: string }>,
): SakaCandidateContext {
  const lastSh = new Map<string, number>();
  return {
    calendar,
    closeHistory,
    gicsOf: (t) => {
      const g = gics.get(t);
      if (!g) return null;
      return { sector: g.sector, subIndustry: g.subIndustry, semiBucket: isSemiSubIndustry(g.subIndustry) };
    },
    mcap: (t, d) => {
      const px = mcapCloseOnOrBefore(barsBy.get(t) ?? [], d);
      const f = factFor(t);
      let sh = f ? sharesOutstandingAsOf(f, d) : null;
      if (sh != null && sh > 0) lastSh.set(t, sh);
      else sh = lastSh.get(t) ?? null;
      if (!px || !sh) return 0;
      return px * sh;
    },
    sharesLookup: () => ({ shares: 0, stale: true }),
    profitable: (t, d) => profitabilityStatus(factFor(t), d) === "profitable",
    hasPrice: (t, d) => mcapCloseOnOrBefore(barsBy.get(t) ?? [], d) != null,
    cikOf,
  };
}

describe("pit holdings mcap sanity", { skip: !fs.existsSync(PIT_CACHE) }, () => {
  it("every plain_20 holding at each rebalance passes floor vs S&P #40 mcap", async () => {
    const config = SAKA_CONFIGS.find((c) => c.id === "plain_20__mcap_cap10") ?? SAKA_CONFIGS[0];
    const { intervals, gics } = await loadSp500PitFiles(PIT_CACHE);
    const overrides = loadPitCikOverrides().cik;
    const factsIndex = buildPitFactsIndex(PIT_CACHE);
    const spy = loadPitBars("SPY", PIT_CACHE);
    const calendar = tradingDaysFromBars(spy);
    const rebals = rebalanceDates(calendar, SAKA_START, SAKA_END);
    const allTickers = new Set<string>();
    for (const d of rebals) for (const t of membersOnDate(intervals, d)) allTickers.add(t);
    const cikMap = await buildPitCikMapForTickers(PIT_CACHE, gics, [...allTickers], overrides);
    const barsBy = new Map<string, Bar[]>();
    const closeHistory = new Map<string, Map<string, number>>();
    for (const t of allTickers) {
      const bars = loadPitBars(t, PIT_CACHE);
      barsBy.set(t, bars);
      const m = new Map<string, number>();
      for (const b of bars) m.set(b.date, b.c);
      closeHistory.set(t, m);
    }
    const factFor = (t: string) => loadMergedPitFacts(t, cikMap.get(t)?.cik ?? null, factsIndex, PIT_CACHE);
    const cikOf = (t: string) => cikMap.get(t)?.cik ?? null;

    const failures: string[] = [];
    for (const date of rebals) {
      const members = membersOnDate(intervals, date);
      const ctx = buildMcapCtx(members, date, calendar, barsBy, closeHistory, factFor, cikOf, gics);
      const memberMcaps = members
        .map((t) => ({ t, m: ctx.mcap(t, date) }))
        .filter((r) => r.m > 0)
        .sort((a, b) => b.m - a.m);
      const rank40 = memberMcaps[39]?.m ?? 0;
      const floor = Math.max(mcapFloorUsd(date), rank40 * 0.45);
      const eligible = filterEligibleCandidates(members, date, ctx);
      const holdings = pickHoldings(config, eligible, date, ctx);
      for (const t of holdings) {
        const m = ctx.mcap(t, date);
        if (m < floor) {
          failures.push(`${date} ${t} mcap=${(m / 1e9).toFixed(1)}B floor=${(floor / 1e9).toFixed(1)}B (#40≈${(rank40 / 1e9).toFixed(1)}B)`);
        }
      }
    }
    if (failures.length) console.error(failures.join("\n"));
    assert.equal(failures.length, 0, failures.slice(0, 6).join("; "));
  });
});
