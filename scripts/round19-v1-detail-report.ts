/**
 * Corrected v1 adopted-config detail report → docs/ROUND19_V1_DETAIL_ja.md
 *   npx tsx scripts/round19-v1-detail-report.ts
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  SAKA_CAL_YEARS,
  SAKA_CONFIGS,
  SAKA_END,
  SAKA_INITIAL_CASH,
  SAKA_IS_END,
  SAKA_REBAL_MIN_TRADE_USD,
  SAKA_REBAL_REL_DRIFT,
  SAKA_START,
  calendarYearReturn,
  filterEligibleCandidates,
  isExcludedTheme,
  isFinancialSector,
  isSemiSubIndustry,
  pickHoldings,
  profitabilityStatus,
  rebalanceDates,
  sharesOutstandingAsOf,
  simulateSaka,
  targetWeights,
  tradingDaysFromBars,
  ttmNetIncomePitAudit,
  type ProfitabilityStatus,
  type SakaCandidateContext,
  type SakaConfig,
  type SakaEquityPoint,
  metricsFromCurve,
} from "../src/lib/round19-saka";
import { buildPitCikMapForTickers } from "../src/lib/pit-cik";
import { buildPitFactsIndex, pitFactsPathForTicker } from "../src/lib/pit-facts-index";
import { loadPitBars, loadPitCikMap, loadPitCikOverrides, PIT_CACHE } from "../src/lib/pit-dataset";
import { dedupeShareClassesByCik } from "../src/lib/pit-share-class";
import {
  isSp500MemberOnDate,
  loadSp500PitFiles,
  membersOnDate,
  uniqueTickersInRange,
  type Sp500Interval,
} from "../src/lib/sp500-pit";
import type { Bar } from "../src/lib/types";

const CACHE_V1 = path.join(process.cwd(), "data", ".cache", "round19");
const CACHE = path.join(process.cwd(), "data", ".cache", "round19v2");
const OUT_MD = path.join(process.cwd(), "docs", "ROUND19_V1_DETAIL_ja.md");
const OUT_PNG = path.join(process.cwd(), "docs", "round19_v1_contribution.png");
const ATTR_FROM = "2025-07-01";
const ATTR_TO = SAKA_END;
const COMMISSION = 0.35;

function loadBars(ticker: string): Bar[] {
  const pit = loadPitBars(ticker, PIT_CACHE);
  if (pit.length) return pit;
  const sym = ticker.replace(/\./g, "-");
  for (const dir of [CACHE, CACHE_V1]) {
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

function quarterKey(date: string): string {
  const [y, m] = date.split("-").map(Number);
  return `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
}

type ExclCategory =
  | "金融セクター除外"
  | "テーマ除外"
  | "S&P構成外"
  | "株価データなし"
  | "赤字（TTM・filed PIT）"
  | "黒字不明（facts欠損等）"
  | "時価総額算出不可"
  | "株クラス重複で除外"
  | "eligibleだが上位15外";

function buildCtx() {
  return (async () => {
    const { intervals, gics } = await loadSp500PitFiles(PIT_CACHE);
    const tickers = uniqueTickersInRange(intervals, SAKA_START, SAKA_END);
    const pitCik = loadPitCikMap(PIT_CACHE);
    const cikMapBuilt =
      pitCik.size > 0
        ? pitCik
        : new Map(
            [...(await buildPitCikMapForTickers(PIT_CACHE, gics, tickers, loadPitCikOverrides().cik)).entries()].map(
              ([t, r]) => [t, r.cik],
            ),
          );
    const factsIndex = buildPitFactsIndex(PIT_CACHE);
    const hasFactsFile = (t: string) =>
      pitFactsPathForTicker(t, cikMapBuilt.get(t), factsIndex, PIT_CACHE) != null ||
      fs.existsSync(path.join(CACHE, "facts", `${t}.json`)) ||
      fs.existsSync(path.join(CACHE_V1, "facts", `${t}.json`));
    const factByTicker = new Map<string, unknown | undefined>();
    const factForTicker = (t: string): unknown | undefined => {
      if (factByTicker.has(t)) return factByTicker.get(t);
      let json: unknown | undefined;
      const pitPath = pitFactsPathForTicker(t, cikMapBuilt.get(t), factsIndex, PIT_CACHE);
      if (pitPath) json = JSON.parse(fs.readFileSync(pitPath, "utf8"));
      else {
        for (const dir of [path.join(CACHE, "facts"), path.join(CACHE_V1, "facts")]) {
          const f = path.join(dir, `${t}.json`);
          if (!fs.existsSync(f)) continue;
          json = JSON.parse(fs.readFileSync(f, "utf8"));
          break;
        }
      }
      factByTicker.set(t, json);
      return json;
    };
    const profitCache = new Map<string, ProfitabilityStatus>();
    const profitOf = (t: string, date: string): ProfitabilityStatus => {
      const k = `${t}|${date}`;
      const hit = profitCache.get(k);
      if (hit) return hit;
      const st = profitabilityStatus(factForTicker(t), date);
      profitCache.set(k, st);
      return st;
    };
    const barsBy = new Map<string, Bar[]>();
    for (const t of tickers) {
      const bars = loadBars(t);
      if (bars.length) barsBy.set(t, bars);
    }
    const spyBars = loadBars("SPY");
    const calendar = tradingDaysFromBars(spyBars);
    const closeHistory = new Map<string, Map<string, number>>();
    for (const [t, bars] of barsBy) {
      const m = new Map<string, number>();
      for (const b of bars) m.set(b.date, b.c);
      closeHistory.set(t, m);
    }
    const price = (ticker: string, date: string) => closeOnOrBefore(barsBy.get(ticker) ?? [], date);
    const membersOn = (date: string) => membersOnDate(intervals, date);
    const lastKnownShares = new Map<string, number>();
    const ctx: SakaCandidateContext = {
      calendar,
      closeHistory,
      gicsOf: (t) => {
        const g = gics.get(t);
        if (!g) return null;
        return { sector: g.sector, subIndustry: g.subIndustry, semiBucket: isSemiSubIndustry(g.subIndustry) };
      },
      mcap: (t, date) => {
        const p = price(t, date);
        const f = factForTicker(t);
        let sh: number | null = f ? sharesOutstandingAsOf(f, date) : null;
        if (sh != null && sh > 0) lastKnownShares.set(t, sh);
        else sh = lastKnownShares.get(t) ?? null;
        if (p == null || !sh || sh <= 0) return 0;
        return p * sh;
      },
      sharesLookup: (t, date) => {
        const f = factForTicker(t);
        let sh: number | null = f ? sharesOutstandingAsOf(f, date) : null;
        if (sh != null && sh > 0) return { shares: sh, stale: false };
        const prev = lastKnownShares.get(t);
        if (prev != null) return { shares: prev, stale: true };
        return { shares: 0, stale: true };
      },
      profitable: (t, date) => profitOf(t, date) === "profitable",
      hasPrice: (t, date) => price(t, date) != null,
      cikOf: (t) => cikMapBuilt.get(t) ?? null,
    };
    const semiOf = (t: string) => ctx.gicsOf(t)?.semiBucket ?? false;
    const membershipIndex = new Map<string, Sp500Interval[]>();
    for (const row of intervals) {
      const list = membershipIndex.get(row.ticker) ?? [];
      list.push(row);
      membershipIndex.set(row.ticker, list);
    };
    const inSp500 = (t: string, date: string) => isSp500MemberOnDate(membershipIndex.get(t) ?? [], date);

    const eligibleRanked = (date: string) =>
      filterEligibleCandidates(membersOn(date), date, ctx)
        .map((t) => ({ t, m: ctx.mcap(t, date) }))
        .filter((r) => r.m > 0)
        .sort((a, b) => b.m - a.m || a.t.localeCompare(b.t));

    const mcapRankEligible = (t: string, date: string): number | null => {
      const list = eligibleRanked(date);
      const i = list.findIndex((r) => r.t === t);
      return i >= 0 ? i + 1 : null;
    };

    const exclusionCategory = (t: string, date: string): ExclCategory => {
      if (!inSp500(t, date)) return "S&P構成外";
      if (isExcludedTheme(t)) return "テーマ除外";
      const g = ctx.gicsOf(t);
      if (g && isFinancialSector(g.sector)) return "金融セクター除外";
      if (!ctx.hasPrice(t, date)) return "株価データなし";
      const st = profitOf(t, date);
      if (st === "loss") return "赤字（TTM・filed PIT）";
      if (st === "unknown") return "黒字不明（facts欠損等）";
      if (ctx.mcap(t, date) <= 0) return "時価総額算出不可";
      const profitableList = membersOn(date).filter((x) => {
        if (isExcludedTheme(x)) return false;
        const gx = ctx.gicsOf(x);
        if (gx && isFinancialSector(gx.sector)) return false;
        if (!ctx.hasPrice(x, date)) return false;
        return profitOf(x, date) === "profitable";
      });
      if (ctx.cikOf) {
        const deduped = dedupeShareClassesByCik(profitableList, ctx.cikOf, (x) => ctx.mcap(x, date));
        if (!deduped.includes(t) && profitableList.includes(t)) return "株クラス重複で除外";
      }
      return "eligibleだが上位15外";
    };

    return {
      intervals,
      gics,
      tickers,
      calendar,
      ctx,
      semiOf,
      price,
      membersOn,
      profitOf,
      inSp500,
      eligibleRanked,
      mcapRankEligible,
      exclusionCategory,
      spyBars,
      factForTicker,
    };
  })();
}

type RebalRow = {
  date: string;
  holdings: string[];
  added: string[];
  removed: string[];
  swaps: number;
  addReasons: Array<{ t: string; reason: string }>;
  removeReasons: Array<{ t: string; reason: string }>;
  swapOrders: number;
  reweightOrders: number;
  fee035: number;
  fee100: number;
};

function simulateInstrumented(config: SakaConfig, env: Awaited<ReturnType<typeof buildCtx>>) {
  const { calendar, ctx, semiOf, price, membersOn, mcapRankEligible, exclusionCategory, inSp500, profitOf } = env;
  const minTradeUsd = SAKA_REBAL_MIN_TRADE_USD;
  const relDrift = SAKA_REBAL_REL_DRIFT;
  const rebalSet = new Set(rebalanceDates(calendar, SAKA_START, SAKA_END));
  let cash = SAKA_INITIAL_CASH;
  const shares: Record<string, number> = {};
  const lastPrice: Record<string, number> = {};
  const curve: SakaEquityPoint[] = [];
  let prevHoldings: string[] = [];
  let prevWeights: Record<string, number> = {};
  const rebalRows: RebalRow[] = [];
  const feeByQuarter: Record<string, { swap: number; reweight: number; total: number }> = {};
  const dailySnaps: Array<{ date: string; shares: Record<string, number>; cash: number }> = [];

  const equityOn = (date: string) => {
    let eq = cash;
    for (const [t, sh] of Object.entries(shares)) {
      const p = price(t, date) ?? lastPrice[t] ?? 0;
      eq += sh * p;
    }
    return eq;
  };

  for (const date of calendar) {
    if (date < SAKA_START) continue;
    if (date > SAKA_END) break;
    for (const t of Object.keys(shares)) {
      const p = price(t, date);
      if (p != null) lastPrice[t] = p;
    }

    if (rebalSet.has(date)) {
      const eligible = filterEligibleCandidates(membersOn(date), date, ctx);
      const holdings = pickHoldings(config, eligible, date, ctx);
      const weights = targetWeights(config, holdings, date, ctx, semiOf);
      const added = holdings.filter((t) => !prevHoldings.includes(t));
      const removed = prevHoldings.filter((t) => !holdings.includes(t));
      const swaps = added.length;

      const addReasons = added.map((t) => {
        const rNow = mcapRankEligible(t, date);
        const rPrev = mcapRankEligible(t, getPrevRebalDate(rebalRows));
        const rankTxt =
          rPrev != null && rNow != null ? `eligible順位 ${rPrev}位→${rNow}位` : rNow != null ? `eligible順位 ${rNow}位` : "eligible順位 —";
        if (!inSp500(t, date)) return { t, reason: "S&P新規加入（稀）" };
        if (rPrev == null && profitOf(t, date) === "profitable") {
          return { t, reason: `新規eligible化＋${rankTxt}（上位${config.n}入り）` };
        }
        return { t, reason: `${rankTxt}（時価総額上位${config.n}入り）` };
      });

      const removeReasons = removed.map((t) => {
        if (!inSp500(t, date)) return { t, reason: "S&P 500構成から除外" };
        const cat = exclusionCategory(t, date);
        if (cat !== "eligibleだが上位15外") return { t, reason: cat };
        const rNow = mcapRankEligible(t, date);
        const rPrev = mcapRankEligible(t, getPrevRebalDate(rebalRows));
        const rankTxt =
          rPrev != null && rNow != null ? `eligible順位 ${rPrev}位→${rNow ?? "—"}位` : rNow != null ? `eligible順位 ${rNow}位` : "eligible順位 —";
        return { t, reason: `${rankTxt}（上位${config.n}から落ち）` };
      });

      let swapOrders = 0;
      let reweightOrders = 0;
      const holdingSet = new Set(holdings);
      const prevSet = new Set(prevHoldings);

      const targetSet = new Set(Object.keys(weights));
      for (const t of Object.keys(shares)) {
        if (targetSet.has(t)) continue;
        const p = price(t, date) ?? lastPrice[t];
        if (p && shares[t] > 0) {
          cash += shares[t] * p - COMMISSION;
          swapOrders += 1;
        }
        delete shares[t];
      }
      const eq = equityOn(date);
      for (const t of Object.keys(weights)) {
        const p = price(t, date);
        if (!p || p <= 0) continue;
        const targetUsd = eq * weights[t];
        const curUsd = (shares[t] ?? 0) * p;
        const delta = targetUsd - curUsd;
        const had = (shares[t] ?? 0) > 0;
        const isSwapLeg = !prevSet.has(t) || !holdingSet.has(t);
        if (had) {
          const rel = curUsd > 0 ? Math.abs(delta) / curUsd : 1;
          if (Math.abs(delta) < minTradeUsd && rel < relDrift) continue;
        }
        const swapName = !prevSet.has(t) || removed.includes(t) || added.includes(t);
        if (delta < -minTradeUsd / 2) {
          const sellUsd = Math.min(-delta, curUsd);
          const sellSh = sellUsd / p;
          if (sellSh > 0 && sellSh <= shares[t]) {
            shares[t] -= sellSh;
            cash += sellUsd - COMMISSION;
            if (swapName) swapOrders += 1;
            else reweightOrders += 1;
            if (shares[t] <= 1e-9) delete shares[t];
          }
        } else if (delta > minTradeUsd / 2) {
          const buyUsd = delta;
          const cost = buyUsd + COMMISSION;
          if (cost <= cash) {
            cash -= cost;
            shares[t] = (shares[t] ?? 0) + buyUsd / p;
            if (!prevSet.has(t)) swapOrders += 1;
            else reweightOrders += 1;
            lastPrice[t] = p;
          }
        } else if (!had && targetUsd >= minTradeUsd / 2) {
          const cost = targetUsd + COMMISSION;
          if (cost <= cash) {
            cash -= cost;
            shares[t] = targetUsd / p;
            swapOrders += 1;
            lastPrice[t] = p;
          }
        }
      }

      const q = quarterKey(date);
      feeByQuarter[q] = feeByQuarter[q] ?? { swap: 0, reweight: 0, total: 0 };
      feeByQuarter[q].swap += swapOrders;
      feeByQuarter[q].reweight += reweightOrders;
      feeByQuarter[q].total += swapOrders + reweightOrders;

      rebalRows.push({
        date,
        holdings: [...holdings],
        added,
        removed,
        swaps,
        addReasons,
        removeReasons,
        swapOrders,
        reweightOrders,
        fee035: (swapOrders + reweightOrders) * COMMISSION,
        fee100: (swapOrders + reweightOrders) * 1,
      });

      prevHoldings = holdings;
      prevWeights = { ...weights };
    }
    if (date >= ATTR_FROM && date <= SAKA_END) {
      dailySnaps.push({
        date,
        shares: { ...shares },
        cash,
      });
    }
    curve.push({ date, equity: equityOn(date) });
  }

  return { curve, rebalRows, feeByQuarter, finalShares: shares, dailySnaps };
}

function getPrevRebalDate(rows: RebalRow[]): string {
  return rows.length ? rows[rows.length - 1].date : SAKA_START;
}

function drawdownDetail(curve: SakaEquityPoint[], from: string, to: string) {
  const slice = curve.filter((p) => p.date >= from && p.date <= to);
  let peak = slice[0]?.equity ?? 0;
  let peakDate = slice[0]?.date ?? from;
  let maxDd = 0;
  let troughDate = peakDate;
  let peakAtTrough = peak;
  for (const p of slice) {
    if (p.equity > peak) {
      peak = p.equity;
      peakDate = p.date;
    }
    const dd = peak > 0 ? (p.equity - peak) / peak : 0;
    if (dd < maxDd) {
      maxDd = dd;
      troughDate = p.date;
      peakAtTrough = peak;
    }
  }
  let recoveryDate: string | null = null;
  const ti = slice.findIndex((p) => p.date === troughDate);
  if (ti >= 0) {
    for (let i = ti + 1; i < slice.length; i += 1) {
      if (slice[i].equity >= peakAtTrough) {
        recoveryDate = slice[i].date;
        break;
      }
    }
  }
  const recoveryDays =
    recoveryDate != null && ti >= 0 ? slice.findIndex((p) => p.date === recoveryDate) - ti : null;
  return { peakDate, troughDate, maxDd, recoveryDate, recoveryDays, peakAtTrough };
}

function attributionFromSnapshots(
  env: Awaited<ReturnType<typeof buildCtx>>,
  dailySnaps: Array<{ date: string; shares: Record<string, number>; cash: number }>,
) {
  const { price, semiOf } = env;
  const days = dailySnaps.map((s) => s.date);
  if (days.length < 2) return null;
  const contrib: Record<string, number> = {};
  const portStart = equityFromShares(dailySnaps[0].shares, dailySnaps[0].cash, price, days[0]);
  const portEnd = equityFromShares(
    dailySnaps[dailySnaps.length - 1].shares,
    dailySnaps[dailySnaps.length - 1].cash,
    price,
    days[days.length - 1],
  );

  for (let i = 1; i < days.length; i += 1) {
    const prev = days[i - 1];
    const date = days[i];
    const snap = dailySnaps[i - 1];
    const eq0 = equityFromShares(snap.shares, snap.cash, price, prev);
    if (eq0 <= 0) continue;
    for (const t of Object.keys(snap.shares)) {
      const p0 = price(t, prev);
      const p1 = price(t, date);
      if (p0 == null || p1 == null || p0 <= 0) continue;
      const w = (snap.shares[t] * p0) / eq0;
      contrib[t] = (contrib[t] ?? 0) + w * (p1 / p0 - 1);
    }
  }

  const portRet = portStart > 0 ? portEnd / portStart - 1 : 0;
  const spy = env.spyBars;
  const s0 = closeOnOrBefore(spy, ATTR_FROM);
  const s1 = closeOnOrBefore(spy, ATTR_TO);
  const spyRet = s0 && s1 && s0 > 0 ? s1 / s0 - 1 : 0;

  const entries = Object.entries(contrib).sort((a, b) => b[1] - a[1]);
  const totalContrib = entries.reduce((s, [, v]) => s + v, 0);
  let semiC = 0;
  for (const [t, v] of entries) if (semiOf(t)) semiC += v;

  const top1 = entries.slice(0, 1).reduce((s, [, v]) => s + v, 0);
  const top3 = entries.slice(0, 3).reduce((s, [, v]) => s + v, 0);
  const top5 = entries.slice(0, 5).reduce((s, [, v]) => s + v, 0);

  return {
    portRet,
    spyRet,
    gap: portRet - spyRet,
    entries,
    totalContrib,
    semiC,
    semiShare: totalContrib !== 0 ? semiC / totalContrib : 0,
    top1Share: totalContrib !== 0 ? top1 / totalContrib : 0,
    top3Share: totalContrib !== 0 ? top3 / totalContrib : 0,
    top5Share: totalContrib !== 0 ? top5 / totalContrib : 0,
    portRetExTop1: portRet - top1,
    portRetExTop3: portRet - top3,
  };
}

function equityFromShares(
  shares: Record<string, number>,
  cash: number,
  price: (t: string, d: string) => number | null,
  date: string,
) {
  let eq = cash;
  for (const [t, sh] of Object.entries(shares)) {
    const p = price(t, date);
    if (p != null) eq += sh * p;
  }
  return eq;
}

async function main() {
  const env = await buildCtx();
  const { calendar, ctx, semiOf, price, membersOn, eligibleRanked, exclusionCategory, mcapRankEligible } = env;

  const spyBench = (() => {
    const anchor = env.spyBars.findIndex((b) => b.date >= SAKA_START);
    const p0 = env.spyBars[anchor].c;
    return env.spyBars
      .filter((b) => b.date >= SAKA_START && b.date <= SAKA_END)
      .map((b) => ({ date: b.date, equity: SAKA_INITIAL_CASH * (b.c / p0) }));
  })();
  const spyIs = metricsFromCurve(spyBench, calendar, SAKA_START, SAKA_IS_END);

  /** Corrected v1 rerun adoption (see ROUND19_AUDIT_ja.md / round19-corrected-v1-study.ts). */
  const adopted = SAKA_CONFIGS.find((c) => c.id === "plain_15__mcap_cap5") ?? SAKA_CONFIGS[0];
  const adoptedIs = simulateSaka(adopted, calendar, membersOn, ctx, semiOf, price, COMMISSION, SAKA_START, SAKA_END, {
    rebalance: "delta",
    minTradeUsd: SAKA_REBAL_MIN_TRADE_USD,
    relDrift: SAKA_REBAL_REL_DRIFT,
  });
  const adoptedIsMetrics = metricsFromCurve(adoptedIs.curve, calendar, SAKA_START, SAKA_IS_END);
  const adoptedPassesIs = adoptedIsMetrics.maxDrawdown > spyIs.maxDrawdown;
  console.error(`[v1-detail] adopted ${adopted.id} (IS DD rule: ${adoptedPassesIs ? "pass" : "check"})`);

  const sim = simulateInstrumented(adopted, env);
  const attrSnaps = sim.dailySnaps.filter((s) => s.date >= ATTR_FROM && s.date <= ATTR_TO);
  const attr = attributionFromSnapshots(env, attrSnaps);
  const ddPort = drawdownDetail(sim.curve, SAKA_START, SAKA_END);
  const ddSpy = drawdownDetail(spyBench, SAKA_START, SAKA_END);

  const lastRebal = sim.rebalRows[sim.rebalRows.length - 1]!;
  const held = new Set(lastRebal.holdings);
  const members = env.membersOn(lastRebal.date);
  const rankedMembers = members
    .map((t) => ({ t, m: ctx.mcap(t, lastRebal.date) }))
    .filter((r) => r.m > 0)
    .sort((a, b) => b.m - a.m);
  const top40 = rankedMembers.slice(0, 40);
  const excludedTop40 = top40.filter((r) => !held.has(r.t));

  const byReason = new Map<string, Array<{ t: string; rank: number; mcapB: number }>>();
  for (const r of excludedTop40) {
    const cat = exclusionCategory(r.t, lastRebal.date);
    const list = byReason.get(cat) ?? [];
    const globalRank = rankedMembers.findIndex((x) => x.t === r.t) + 1;
    list.push({ t: r.t, rank: globalRank, mcapB: r.m / 1e9 });
    byReason.set(cat, list);
  }

  const eligible = eligibleRanked(lastRebal.date);
  const nearMiss = eligible.slice(15, 25);

  let cumFee035 = 0;
  let cumFee100 = 0;
  const feeRows: string[] = [];
  const quarters = Object.keys(sim.feeByQuarter).sort();
  for (const q of quarters) {
    const f = sim.feeByQuarter[q];
    cumFee035 += f.total * COMMISSION;
    cumFee100 += f.total * 1;
    feeRows.push(
      `| ${q} | ${f.swap + f.reweight} | ${f.swap} | ${f.reweight} | $${(f.total * COMMISSION).toFixed(2)} | $${cumFee035.toFixed(2)} | $${(f.total * 1).toFixed(2)} | $${cumFee100.toFixed(2)} |`,
    );
  }

  const rebalSummary = sim.rebalRows.map((r) => {
    const addTxt = r.added.length ? r.added.join(", ") : "—";
    const remTxt = r.removed.length ? r.removed.join(", ") : "—";
    return `| ${r.date} | ${r.holdings.length} | ${addTxt} | ${remTxt} | ${r.swaps} | ${r.swapOrders} | ${r.reweightOrders} | $${r.fee035.toFixed(2)} |`;
  });

  const rebalDetail = sim.rebalRows
    .map((r) => {
      const addLines = r.addReasons.map((x) => `- **+${x.t}**: ${x.reason}`).join("\n");
      const remLines = r.removeReasons.map((x) => `- **−${x.t}**: ${x.reason}`).join("\n");
      return `#### ${r.date}（入替 ${r.swaps} 銘柄）

**追加:** ${r.added.length ? "" : "なし"}
${addLines || ""}

**除外:** ${r.removed.length ? "" : "なし"}
${remLines || ""}
`;
    })
    .join("\n");

  const holdingsAppendix = sim.rebalRows
    .map((r) => `| ${r.date} | ${r.holdings.join(", ")} |`)
    .join("\n");

  const yearRows: string[] = [];
  for (const y of SAKA_CAL_YEARS) {
    const pr = calendarYearReturn(sim.curve, calendar, y, SAKA_END);
    const sr = calendarYearReturn(spyBench, calendar, y, SAKA_END);
    if (pr == null || sr == null) continue;
    yearRows.push(`| ${y} | ${(pr * 100).toFixed(1)}% | ${(sr * 100).toFixed(1)}% | ${((pr - sr) * 100).toFixed(1)}pt |`);
  }

  const exclMd = [...byReason.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([cat, list]) => {
      const lines = list.sort((a, b) => a.rank - b.rank).map((x) => `  - ${x.t}（S&P時価総額順 ${x.rank}位・約${x.mcapB.toFixed(0)}B USD）`);
      return `**${cat}**\n${lines.join("\n")}`;
    })
    .join("\n\n");

  const nearMd = nearMiss
    .map((r, i) => {
      const rank = 16 + i;
      return `| ${rank} | ${r.t} | ${(r.m / 1e9).toFixed(0)} |`;
    })
    .join("\n");

  let attrMd = "（計算不可）";
  if (attr) {
    const semiOf = env.semiOf;
    const lines = attr.entries.slice(0, 20).map(([t, c]) => {
      const ppt = c * 100;
      const usd = c * SAKA_INITIAL_CASH;
      return `| ${t} | ${ppt >= 0 ? "+" : ""}${ppt.toFixed(2)}pt | ${usd >= 0 ? "+" : ""}$${usd.toFixed(0)} | ${semiOf(t) ? "半導体" : "—"} |`;
    });
    attrMd = `
| 銘柄 | 寄与（%ポイント） | 寄与（$・$3,200ベース） | 半導体 |
|---|---:|---:|---|
${lines.join("\n")}

- 期間ポートリターン: **${(attr.portRet * 100).toFixed(2)}%**（単純リプレイ・差分リバランス近似）
- 同期間 SPY: **${(attr.spyRet * 100).toFixed(2)}%** → ギャップ **${(attr.gap * 100).toFixed(2)}pt**
- 半導体サブ業種の寄与合計: **${(attr.semiC * 100).toFixed(2)}pt**（全寄与の **${(attr.semiShare * 100).toFixed(0)}%**）
- 上位1/3/5銘柄の寄与シェア: **${(attr.top1Share * 100).toFixed(0)}% / ${(attr.top3Share * 100).toFixed(0)}% / ${(attr.top5Share * 100).toFixed(0)}%**
- 上位1銘柄を除いた場合の期間リターン（寄与差し引き）: **${(attr.portRetExTop1 * 100).toFixed(2)}%**
- 上位3銘柄を除いた場合: **${(attr.portRetExTop3 * 100).toFixed(2)}%**

**解釈（ギャップの単純分解）:** 本構成は金融セクターとテーマ株を持たないため SPY より大型金融・一部超大型のウェイトが薄い。期間中は半導体・大型テックの寄与がポート側のドライバーとなり、除外セクターが SPY にあって本ポートに無い分がギャップの主因となり得る（厳密な要因分析ではない）。
`;
    const chartJson = {
      title: `${adopted.id}: 寄与 ${ATTR_FROM}–${ATTR_TO}`,
      labels: attr.entries.slice(0, 12).map(([t]) => t),
      values: attr.entries.slice(0, 12).map(([, v]) => +(v * 100).toFixed(2)),
    };
    fs.writeFileSync(path.join(PIT_CACHE, "v1-contrib-chart.json"), JSON.stringify(chartJson));
    spawnSync("python3", ["scripts/round19-v1-contrib-chart.py", path.join(PIT_CACHE, "v1-contrib-chart.json"), OUT_PNG], {
      stdio: "inherit",
    });
  }

  const md = `# Round 19 Corrected v1 — 採用構成の詳細レポート

**対象:** Corrected v1 再実行（事前登録 \`6e3ad93\`・差分リバランス・PIT データ）  
**採用構成 ID:** \`${adopted.id}\`（IS 期間の採用規則 \`selectSakaConfig\` により選定。事前想定の \`plain_15__equal\` ではなく、**時価総額ウェイト＋単銘柄5%キャップ**の \`${adopted.id}\` が選ばれた。）  
**初期資金:** $${SAKA_INITIAL_CASH}　**手数料（主計算）:** $${COMMISSION}/注文  
**データ:** \`data/.cache/pit/\`（\`docs/DATA_PIT_ja.md\`）

---

## 事実と解釈の区別

- **事実:** シミュレーション・EDGAR・価格キャッシュから機械的に数えた値。
- **解釈:** 因果や「なぜそうなったか」の平易な説明（検証可能な単純分解を含む）。

---

## (1) 四半期ごとの保有履歴（2016–2026）

各リバランス日: 保有銘柄数、追加・除外ティッカー、**入替銘柄数**（追加数＝除外数）、注文内訳は (3) と一致。

| リバランス日 | 保有数 | 追加 | 除外 | 入替数 | スワップ注文 | リウェイト注文 | 手数料$0.35 |
|---|---:|---|---|---:|---:|---:|---:|
${rebalSummary.join("\n")}

### 入替理由（四半期ごと）

${rebalDetail}

<details>
<summary>全リバランス日の保有15（クリックで展開）</summary>

| 日付 | 保有ティッカー |
|---|---|
${holdingsAppendix}

</details>

---

## (2) 追加・除外の理由（要約）

- **入り:** 原則として「その日の eligible プール（黒字・価格あり・金融/テーマ除外・株クラス1本）」の**時価総額順位が上位15入り**。
- **外れ:** (a) S&P 500から外れた (b) 赤字化（TTM net income・filed日 PIT）(c) 株価/facts 欠損 (d) 順位が15位以下に低下、など。四半期別の文言は上表。

---

## (3) 四半期ごとの手数料

| 四半期 | 注文合計 | うちスワップ系 | うちリウェイト系 | 当四半期$0.35 | 累計$0.35 | 当四半期$1 | 累計$1 |
|---|---:|---:|---:|---:|---:|---:|---:|
${feeRows.join("\n")}

**定義:** **スワップ系**＝そのリバランスで「前回は保有15に無かった銘柄」への新規買い、または「今回の15から外れた銘柄」の売却に伴う注文。**リウェイト系**＝継続保有銘柄のウェイト調整注文。

---

## (4) 寄与分析（${ATTR_FROM} ～ ${ATTR_TO}）

**方法:** 各営業日、前日終値ベースのポートフォリオウェイト × 銘柄日次リターンを積み上げ（リバランス日は目標ウェイトにリセット・手数料は本節では控除しない簡易版）。

${attrMd}

![寄与（上位銘柄）](round19_v1_contribution.png)

---

## (5) 最終リバランス（${lastRebal.date}）で持っていない銘柄

### S&P 構成員の時価総額上位40のうち、保有15外

${exclMd}

### eligible プールの16～25位（惜しくも15入りしなかった銘柄）

| eligible順位 | ティッカー | 時価総額（約・B USD） |
|---:|---|---:|
${nearMd}

---

## (6) 暦年リターン vs SPY・最大ドローダウン

**暦年:** 前年最終営業日終値ベース（\`calendarYearReturn\`）。

| 年 | ${adopted.id} | SPY | 差 |
|---|---:|---:|---:|
${yearRows.join("\n")}

### 最大ドローダウン（${SAKA_START}–${SAKA_END}）

| | 採用構成 | SPY |
|---|---|---|
| ピーク日 | ${ddPort.peakDate} | ${ddSpy.peakDate} |
| ボトム日 | ${ddPort.troughDate} | ${ddSpy.troughDate} |
| 深さ | ${(ddPort.maxDd * 100).toFixed(1)}% | ${(ddSpy.maxDd * 100).toFixed(1)}% |
| 回復 | ${ddPort.recoveryDate ?? "未回復"} | ${ddSpy.recoveryDate ?? "未回復"} |
| 回復営業日数 | ${ddPort.recoveryDays ?? "—"} | ${ddSpy.recoveryDays ?? "—"} |

---

## 解釈（全体）

- **${adopted.id}** は mega-cap 寄りだが **5%キャップ** により単一超大株依存を抑える設計。
- Corrected v1 のデータ拡充で eligible が増え、四半期漏斗の「価格なし」は後年ほぼ解消（詳細は \`ROUND19_AUDIT_ja.md\`）。
- v2（ウォークフォワード主評価）は **DRAFT のみ**・本レポートの対象外。

*生成: \`npx tsx scripts/round19-v1-detail-report.ts\`*
`;

  fs.writeFileSync(OUT_MD, md);
  console.log(JSON.stringify({ adopted: adopted.id, md: OUT_MD, png: OUT_PNG }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
