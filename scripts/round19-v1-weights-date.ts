/**
 * Dump plain_15__mcap targetWeights after semi cap for one rebalance date.
 *   npx tsx scripts/round19-v1-weights-date.ts 2026-10-01
 */
import fs from "node:fs";
import path from "node:path";
import { buildPitCikMapForTickers } from "../src/lib/pit-cik";
import { loadPitBars, loadPitCikOverrides, PIT_CACHE } from "../src/lib/pit-dataset";
import { buildPitFactsIndex, loadMergedPitFacts } from "../src/lib/pit-facts-index";
import { pitMarketCapForTicker } from "../src/lib/pit-mcap";
import { mcapCloseOnOrBefore } from "../src/lib/pit-mcap-price";
import {
  SAKA_CONFIGS,
  SAKA_SEMI_CAP,
  filterEligibleCandidates,
  isSemiSubIndustry,
  pickHoldings,
  profitabilityStatus,
  targetWeights,
  tradingDaysFromBars,
} from "../src/lib/round19-saka";
import { loadSp500PitFiles, membersOnDate } from "../src/lib/sp500-pit";
import type { Bar } from "../src/lib/types";

const date = process.argv[2] ?? "2026-10-01";
const CONFIG = SAKA_CONFIGS.find((c) => c.id === "plain_15__mcap");
if (!CONFIG) throw new Error("plain_15__mcap missing");

async function main() {
  const { intervals, gics } = await loadSp500PitFiles(PIT_CACHE);
  const overrides = loadPitCikOverrides().cik;
  const members = membersOnDate(intervals, date);
  const cikMap = await buildPitCikMapForTickers(PIT_CACHE, gics, members, overrides);
  const factsIndex = buildPitFactsIndex(PIT_CACHE);
  const factFor = (t: string) => loadMergedPitFacts(t, cikMap.get(t)?.cik ?? null, factsIndex, PIT_CACHE);
  const barsBy = new Map<string, Bar[]>();
  for (const t of members) {
    const bars = loadPitBars(t, PIT_CACHE);
    if (bars.length) barsBy.set(t, bars);
  }
  const calendar = tradingDaysFromBars(loadPitBars("SPY", PIT_CACHE));
  const ctx = {
    calendar,
    closeHistory: new Map(),
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
  const semiOf = (t: string) => ctx.gicsOf(t)?.semiBucket ?? false;
  const eligible = filterEligibleCandidates(members, date, ctx);
  const holdings = pickHoldings(CONFIG, eligible, date, ctx);
  const weights = targetWeights(CONFIG, holdings, date, ctx, semiOf);
  const semiSum = Object.entries(weights)
    .filter(([t]) => semiOf(t))
    .reduce((a, [, w]) => a + w, 0);
  const rows = Object.entries(weights)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([t, w]) => ({ t, pct: w * 100, mcap: ctx.mcap(t, date) }));
  const outPath = path.join(process.cwd(), "docs", `ROUND19_V1_WEIGHTS_${date}.md`);
  const lines = [
    `# plain_15__mcap weights (${date})`,
    "",
    `Semi sub-industry sum **${(semiSum * 100).toFixed(2)}%** (30% cap ${semiSum >= SAKA_SEMI_CAP - 1e-6 ? "binds" : "does not bind"}).`,
    "",
    "| Ticker | Weight % | PIT mcap |",
    "|---|---:|---|",
    ...rows.map((r) => `| ${r.t} | ${r.pct.toFixed(2)} | $${(r.mcap / 1e12).toFixed(3)}T |`),
    "",
    `Display sum (2 dp): **${rows.reduce((s, r) => s + Math.round(r.pct * 100) / 100, 0).toFixed(2)}%**.`,
    "",
  ];
  fs.writeFileSync(outPath, lines.join("\n"));
  console.log(`wrote ${outPath}`);
  for (const r of rows) console.log(`${r.t}\t${r.pct.toFixed(2)}%`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
