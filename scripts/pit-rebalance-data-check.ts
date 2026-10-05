/**
 * PIT data sanity: mcap=0 members, CIK/entity mismatches, basket diff (META/XOM fixes).
 */
import fs from "node:fs";
import path from "node:path";
import { buildPitCikMapForTickers } from "../src/lib/pit-cik";
import { checkCikSanity, loadSecTickerTitleMap } from "../src/lib/pit-cik-sanity";
import { loadSecTickerCikMap } from "../src/lib/sec-ticker-cik";
import { buildPitFactsIndex, pitFactsPathForTicker } from "../src/lib/pit-facts-index";
import { loadPitCikOverrides, PIT_CACHE } from "../src/lib/pit-dataset";
import { sharesOutstandingAsOf, sharesOutstandingAsOfStrict } from "../src/lib/pit-shares";
import {
  filterEligibleCandidates,
  isSemiSubIndustry,
  pickHoldings,
  profitabilityStatus,
  rebalanceDates,
  tradingDaysFromBars,
  SAKA_END,
  SAKA_START,
  type SakaCandidateContext,
} from "../src/lib/round19-saka";
import { loadSp500PitFiles, membersOnDate } from "../src/lib/sp500-pit";
import type { Bar } from "../src/lib/types";

const CONFIG_ID = "plain_15__mcap_cap5";
const CHECK_DATES = ["2026-07-01", "2026-10-01"];

function loadBars(ticker: string): Bar[] {
  const sym = ticker.replace(/\./g, "-");
  for (const dir of [path.join(PIT_CACHE, "prices"), path.join(process.cwd(), "data", ".cache", "round19")]) {
    const f = path.join(dir, `${sym}.json`);
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, "utf8")) as Bar[];
  }
  return [];
}

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
  const cikMap = await buildPitCikMapForTickers(PIT_CACHE, gics, [...new Set(intervals.map((i) => i.ticker))], overrides);
  const factsIndex = buildPitFactsIndex(PIT_CACHE);
  const secByCik = await loadSecTickerTitleMap(PIT_CACHE);
  const secTickerToCik = await loadSecTickerCikMap(PIT_CACHE);

  const factFor = (t: string) => {
    const p = pitFactsPathForTicker(t, cikMap.get(t)?.cik, factsIndex, PIT_CACHE);
    if (!p) return undefined;
    return JSON.parse(fs.readFileSync(p, "utf8"));
  };

  const barsBy = new Map<string, Bar[]>();
  const barsFor = (t: string) => {
    let b = barsBy.get(t);
    if (!b) {
      b = loadBars(t);
      barsBy.set(t, b);
    }
    return b;
  };
  const calendar = tradingDaysFromBars(barsFor("SPY"));
  const price = (t: string, d: string) => closeOnOrBefore(barsFor(t), d);

  const makeCtx = (useLegacyShares: boolean): SakaCandidateContext => {
    const lastSh = new Map<string, number>();
    return {
      calendar,
      closeHistory: new Map(),
      gicsOf: (t) => {
        const g = gics.get(t);
        if (!g) return null;
        return { sector: g.sector, subIndustry: g.subIndustry, semiBucket: isSemiSubIndustry(g.subIndustry) };
      },
      mcap: (t, d) => {
        const p = price(t, d);
        const f = factFor(t);
        const shFn = useLegacyShares ? sharesOutstandingAsOfStrict : sharesOutstandingAsOf;
        let sh = f ? shFn(f, d) : null;
        if (sh != null && sh > 0) lastSh.set(t, sh);
        else sh = lastSh.get(t) ?? null;
        if (p == null || !sh || sh <= 0) return 0;
        return p * sh;
      },
      sharesLookup: () => ({ shares: 0, stale: true }),
      profitable: (t, d) => profitabilityStatus(factFor(t), d) === "profitable",
      hasPrice: (t, d) => price(t, d) != null,
      cikOf: (t) => cikMap.get(t)?.cik ?? null,
    };
  };

  const config = { id: CONFIG_ID, pick: "plain" as const, n: 15 as const, weight: "mcap_cap5" as const };
  const rebals = rebalanceDates(calendar, SAKA_START, SAKA_END);

  const zeroMcap: Array<{ date: string; tickers: string[] }> = [];
  const zeroScanDates = process.env.PIT_FULL_ZERO_MCAP === "1" ? rebals : [...new Set([...CHECK_DATES, ...rebals.slice(-4)])];
  for (const d of zeroScanDates) {
    const members = membersOnDate(intervals, d);
    const ctx = makeCtx(false);
    const bad = members.filter((t) => {
      if (!ctx.hasPrice(t, d)) return false;
      return ctx.mcap(t, d) <= 0;
    });
    if (bad.length) zeroMcap.push({ date: d, tickers: bad.sort() });
  }

  const cikMismatch: ReturnType<typeof checkCikSanity>[] = [];
  for (const [ticker, res] of cikMap) {
    const f = factFor(ticker);
    const entity = f && typeof f === "object" && "entityName" in f ? String((f as { entityName?: string }).entityName) : null;
    const rawCik = f && typeof f === "object" && "cik" in f ? (f as { cik?: number | string }).cik : null;
    const factsCik =
      typeof rawCik === "number" ? rawCik : rawCik != null ? Number(String(rawCik).replace(/\D/g, "")) : null;
    const row = checkCikSanity(ticker, res.cik, entity, secByCik, factsCik, secTickerToCik);
    if (!row.ok) cikMismatch.push(row);
  }
  const spMembersCheck = membersOnDate(intervals, "2026-10-01");
  const cikMismatchSpMembers = cikMismatch.filter((r) => spMembersCheck.includes(r.ticker));
  const gicsCsvWrong: Array<{ ticker: string; gicsCik: number; canonicalCik: number }> = [];
  for (const t of spMembersCheck) {
    const gicsCik = gics.get(t)?.cik;
    const canonical = cikMap.get(t)?.cik;
    if (gicsCik && canonical && gicsCik !== canonical) {
      gicsCsvWrong.push({ ticker: t, gicsCik, canonicalCik: canonical });
    }
  }

  const baskets: Record<string, { before: string[]; after: string[] }> = {};
  for (const d of CHECK_DATES) {
    const ctxAfter = makeCtx(false);
    const ctxBefore = makeCtx(true);
    const elA = filterEligibleCandidates(membersOnDate(intervals, d), d, ctxAfter);
    const elB = filterEligibleCandidates(membersOnDate(intervals, d), d, ctxBefore);
    baskets[d] = {
      before: pickHoldings(config, elB, d, ctxBefore),
      after: pickHoldings(config, elA, d, ctxAfter),
    };
  }

  const wrongXomFacts = path.join(PIT_CACHE, "facts", "XOM.wrong.json");
  if (!fs.existsSync(wrongXomFacts) && fs.existsSync(path.join(PIT_CACHE, "facts", "XOM.json"))) {
    const cur = JSON.parse(fs.readFileSync(path.join(PIT_CACHE, "facts", "XOM.json"), "utf8")) as { cik?: number };
    if (cur.cik === 2115436) fs.copyFileSync(path.join(PIT_CACHE, "facts", "XOM.json"), wrongXomFacts);
  }

  const payload = {
        zeroMcapRebalances: zeroMcap.length,
        zeroMcapSample: zeroMcap.filter((z) => CHECK_DATES.includes(z.date)),
        cikMismatchCountAllPitTickers: cikMismatch.length,
        cikMismatchSpMembers2026_10_01: cikMismatchSpMembers.length,
        cikMismatchSpSample: cikMismatchSpMembers.slice(0, 20),
        gicsCsvCikOverrides2026_10_01: gicsCsvWrong,
        baskets,
        meta: {
          shares2026_10_01: sharesOutstandingAsOf(factFor("META"), "2026-10-01"),
          xomProfit2026_10_01: profitabilityStatus(factFor("XOM"), "2026-10-01"),
        },
  };
  const outFile = process.argv.includes("--write-cache")
    ? path.join(PIT_CACHE, "rebalance-data-check.json")
    : null;
  if (outFile) fs.writeFileSync(outFile, JSON.stringify(payload, null, 2));
  if (!process.argv.includes("--quiet")) console.log(JSON.stringify(payload));
}

main();
