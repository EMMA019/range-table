import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { buildPitCikMapForTickers } from "./pit-cik";
import { loadPitBars, loadPitCikOverrides, PIT_CACHE } from "./pit-dataset";
import { buildPitFactsIndex, loadMergedPitFacts } from "./pit-facts-index";
import { pitMarketCapForTicker } from "./pit-mcap";
import {
  isExcepted,
  loadMcapRefExceptions,
  mcapRefWithinBand,
  referenceMcapFromYahoo,
} from "./pit-mcap-yahoo-ref";
import { mcapCloseOnOrBefore } from "./pit-mcap-price";
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
} from "./round19-saka";
import { loadSp500PitFiles, membersOnDate } from "./sp500-pit";

const ADOPTED = SAKA_CONFIGS.find((c) => c.id === "plain_15__mcap")!;
const EXCEPTIONS = path.join(process.cwd(), "data", "pit_mcap_ref_exceptions.json");
const RUN = process.env.PIT_YAHOO_REF_TEST === "1";

describe(
  "pit mcap yahoo reference cross-check",
  { skip: !fs.existsSync(PIT_CACHE) || !RUN },
  () => {
    it("held names at each rebalance match Yahoo ref within log band", async () => {
      const exceptions = loadMcapRefExceptions(EXCEPTIONS);
      const { intervals, gics } = await loadSp500PitFiles(PIT_CACHE);
      const overrides = loadPitCikOverrides().cik;
      const factsIndex = buildPitFactsIndex(PIT_CACHE);
      const spy = loadPitBars("SPY", PIT_CACHE);
      const calendar = tradingDaysFromBars(spy);
      const rebals = rebalanceDates(calendar, SAKA_START, SAKA_END);
      const allTickers = new Set<string>();
      for (const d of rebals) for (const t of membersOnDate(intervals, d)) allTickers.add(t);
      const cikMap = await buildPitCikMapForTickers(PIT_CACHE, gics, [...allTickers], overrides);
      const barsBy = new Map([...allTickers].map((t) => [t, loadPitBars(t, PIT_CACHE)]));
      const factFor = (t: string) => loadMergedPitFacts(t, cikMap.get(t)?.cik ?? null, factsIndex, PIT_CACHE);
      const refCache = new Map<string, number | null>();

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

      const failures: string[] = [];
      for (const date of rebals) {
        const members = membersOnDate(intervals, date);
        const holdings = pickHoldings(ADOPTED, filterEligibleCandidates(members, date, ctx), date, ctx);
        for (const t of holdings) {
          if (isExcepted(t, date, exceptions)) continue;
          const pit = ctx.mcap(t, date);
          if (!(pit > 0)) continue;
          const key = `${t}|${date}`;
          let ref = refCache.get(key);
          if (ref === undefined) {
            try {
              ref = await referenceMcapFromYahoo(t, date, PIT_CACHE);
            } catch {
              ref = null;
            }
            refCache.set(key, ref);
          }
          if (ref == null || !(ref > 0)) continue;
          if (!mcapRefWithinBand(pit, ref, 0.28)) {
            const lr = Math.log(pit / ref);
            failures.push(
              `${date} ${t} pit=${(pit / 1e9).toFixed(1)}B ref=${(ref / 1e9).toFixed(1)}B log=${lr.toFixed(3)}`,
            );
          }
        }
      }
      if (failures.length) console.error(failures.join("\n"));
      assert.equal(failures.length, 0, failures.slice(0, 8).join("; "));
    });
  },
);
