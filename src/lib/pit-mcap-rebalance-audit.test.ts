import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { buildPitCikMapForTickers } from "./pit-cik";
import { loadPitBars, loadPitCikOverrides, PIT_CACHE } from "./pit-dataset";
import { buildPitFactsIndex, loadMergedPitFacts } from "./pit-facts-index";
import { detectMcapJump, pitMarketCapForTicker } from "./pit-mcap";
import { loadPitSplits } from "./pit-splits";
import { mcapCloseOnOrBefore } from "./pit-mcap-price";
import {
  filterEligibleCandidates,
  isFinancialSector,
  isSemiSubIndustry,
  pickHoldings,
  profitabilityStatus,
  rebalanceDates,
  SAKA_CONFIGS,
  SAKA_END,
  SAKA_START,
  tradingDaysFromBars,
  type SakaConfig,
} from "./round19-saka";
import { dedupeShareClassesByCik } from "./pit-share-class";
import { loadSp500PitFiles, membersOnDate } from "./sp500-pit";
import type { Bar } from "./types";

const ADOPTED: SakaConfig = SAKA_CONFIGS.find((c) => c.id === "plain_15__mcap")!;

function mcapFloorUsd(date: string): number {
  const y = Number(date.slice(0, 4));
  return y >= 2021 ? 80e9 : 40e9;
}

describe("pit mcap rebalance audit (2016–2026)", { skip: !fs.existsSync(PIT_CACHE) }, () => {
  it("holdings pass floor vs S&P #40 at every rebalance", async () => {
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
        cikOf,
      };
      const nonFin = members
        .filter((t) => {
          const g = gics.get(t);
          return !g || !isFinancialSector(g.sector);
        })
        .map((t) => ({ t, m: ctx.mcap(t, date) }))
        .filter((r) => r.m > 0)
        .sort((a, b) => b.m - a.m);
      const top40 = dedupeShareClassesByCik(
        nonFin.slice(0, 55).map((r) => r.t),
        cikOf,
        (t) => ctx.mcap(t, date),
      )
        .map((t) => ({ t, m: ctx.mcap(t, date) }))
        .sort((a, b) => b.m - a.m)
        .slice(0, 40);
      const rank40 = top40[39]?.m ?? 0;
      const floor = Math.max(mcapFloorUsd(date), rank40 * 0.4);
      const eligible = filterEligibleCandidates(members, date, ctx);
      const holdings = pickHoldings(ADOPTED, eligible, date, ctx);
      for (const t of holdings) {
        const m = ctx.mcap(t, date);
        if (m < floor) failures.push(`${date} ${t} mcap=${(m / 1e9).toFixed(1)}B floor=${(floor / 1e9).toFixed(1)}B`);
      }
    }
    if (failures.length) console.error(failures.join("\n"));
    assert.equal(failures.length, 0, failures.slice(0, 8).join("; "));
  });

  it("no >40% mcap jumps in window around each rebalance for held tickers", async () => {
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
    for (const t of allTickers) barsBy.set(t, loadPitBars(t, PIT_CACHE));
    const factFor = (t: string) => loadMergedPitFacts(t, cikMap.get(t)?.cik ?? null, factsIndex, PIT_CACHE);

    const ctxMcap = (t: string, d: string) =>
      pitMarketCapForTicker(t, barsBy.get(t) ?? [], factFor(t), d, PIT_CACHE);

    const closeHistory = new Map<string, Map<string, number>>();
    for (const [t, bars] of barsBy) {
      const m = new Map<string, number>();
      for (const b of bars) m.set(b.date, b.c);
      closeHistory.set(t, m);
    }
    const ctx = {
      calendar,
      closeHistory,
      gicsOf: (t: string) => {
        const g = gics.get(t);
        if (!g) return null;
        return { sector: g.sector, subIndustry: g.subIndustry, semiBucket: isSemiSubIndustry(g.subIndustry) };
      },
      mcap: ctxMcap,
      sharesLookup: () => ({ shares: 0, stale: true }),
      profitable: (t: string, d: string) => profitabilityStatus(factFor(t), d) === "profitable",
      hasPrice: (t: string, d: string) => mcapCloseOnOrBefore(barsBy.get(t) ?? [], d) != null,
      cikOf: (t: string) => cikMap.get(t)?.cik ?? null,
    };

    const flagged: string[] = [];
    for (const date of rebals) {
      const members = membersOnDate(intervals, date);
      const holdings = pickHoldings(ADOPTED, filterEligibleCandidates(members, date, ctx), date, ctx);
      for (const t of holdings) {
        const bars = barsBy.get(t) ?? [];
        const splits = loadPitSplits(t, PIT_CACHE);
        const jumps = detectMcapJump(bars, factFor(t), splits, 0.4).filter(
          (j) => j.from >= date.slice(0, 8) + "-01" && j.to <= date,
        );
        if (jumps.length) flagged.push(`${date} ${t}: ${jumps.map((j) => `${j.from}->${j.to} x${j.ratio.toFixed(2)}`).join(", ")}`);
      }
    }
    if (flagged.length) console.error(flagged.join("\n"));
    assert.equal(flagged.length, 0, flagged.slice(0, 6).join("; "));
  });
});
