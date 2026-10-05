import fs from "node:fs";
import { buildPitCikMapForTickers } from "../src/lib/pit-cik";
import { loadPitCikOverrides, loadPitBars, PIT_CACHE } from "../src/lib/pit-dataset";
import { buildPitFactsIndex, pitFactsPathForTicker } from "../src/lib/pit-facts-index";
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

const DATE = "2016-01-04";

function closeOnOrBefore(bars: Bar[], date: string): number | null {
  let lo = 0;
  let hi = bars.length - 1;
  let best: number | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].date <= date) {
      best = bars[mid].c;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return best;
}

async function main() {
  const { intervals, gics } = await loadSp500PitFiles(PIT_CACHE);
  const overrides = loadPitCikOverrides().cik;
  const members = membersOnDate(intervals, DATE);
  const cikMap = await buildPitCikMapForTickers(PIT_CACHE, gics, members, overrides);
  const factsIndex = buildPitFactsIndex(PIT_CACHE);
  const spy = loadPitBars("SPY", PIT_CACHE);
  const calendar = tradingDaysFromBars(spy);
  const barsBy = new Map<string, Bar[]>();
  const closeHistory = new Map<string, Map<string, number>>();
  for (const t of members) {
    const bars = loadPitBars(t, PIT_CACHE);
    if (bars.length) barsBy.set(t, bars);
    const m = new Map<string, number>();
    for (const b of bars) m.set(b.date, b.c);
    closeHistory.set(t, m);
  }
  const lastSh = new Map<string, number>();
  const factFor = (t: string) => {
    const p = pitFactsPathForTicker(t, cikMap.get(t)?.cik, factsIndex, PIT_CACHE);
    if (!p) return undefined;
    return JSON.parse(fs.readFileSync(p, "utf8"));
  };
  const ctx = {
    calendar,
    closeHistory,
    gicsOf: (t: string) => {
      const g = gics.get(t);
      if (!g) return null;
      return { sector: g.sector, subIndustry: g.subIndustry, semiBucket: isSemiSubIndustry(g.subIndustry) };
    },
    mcap: (t: string, d: string) => {
      const p = mcapCloseOnOrBefore(barsBy.get(t) ?? [], d);
      const f = factFor(t);
      let sh = f ? sharesOutstandingAsOf(f, d) : null;
      if (sh != null && sh > 0) lastSh.set(t, sh);
      else sh = lastSh.get(t) ?? null;
      if (p == null || !sh || sh <= 0) return 0;
      return p * sh;
    },
    sharesLookup: () => ({ shares: 0, stale: true }),
    profitable: (t: string, d: string) => profitabilityStatus(factFor(t), d) === "profitable",
    hasPrice: (t: string, d: string) => closeOnOrBefore(barsBy.get(t) ?? [], d) != null,
    cikOf: (t: string) => cikMap.get(t)?.cik ?? null,
  };
  const el = filterEligibleCandidates(members, DATE, ctx)
    .map((t) => ({ t, m: ctx.mcap(t, DATE) }))
    .filter((r) => r.m > 0)
    .sort((a, b) => b.m - a.m);
  console.log("TOP 20 eligible", DATE);
  for (const r of el.slice(0, 20)) {
    const f = factFor(r.t);
    const fileCik = f && typeof f === "object" && "cik" in f ? (f as { cik: number }).cik : null;
    console.log(r.t, (r.m / 1e9).toFixed(1), "B", "map", cikMap.get(r.t)?.cik, "file", fileCik);
  }
  for (const t of ["MSFT", "GOOGL", "AMZN", "FB", "META", "NVDA"]) {
    const st = profitabilityStatus(factFor(t === "FB" ? "FB" : t), DATE);
    console.log("check", t, "profit", st, "mcap", ctx.mcap(t, DATE) / 1e9, "eligible", el.some((x) => x.t === t));
  }
}

main();
