/**
 * Corrected v1 adopted-config detail report → docs/ROUND19_V1_DETAIL_ja.md
 *   npx tsx scripts/round19-v1-detail-report.ts
 */
import fs from "node:fs";
import path from "node:path";
import { execSync, spawnSync } from "node:child_process";
import { pearson } from "../src/lib/corr";
import {
  SAKA_CAL_YEARS,
  SAKA_CONFIGS,
  SAKA_CORR_LOOKBACK,
  SAKA_CORR_MIN_OBS,
  SAKA_END,
  SAKA_INITIAL_CASH,
  SAKA_IS_END,
  SAKA_REBAL_MIN_TRADE_USD,
  SAKA_REBAL_REL_DRIFT,
  SAKA_START,
  buildCorrInputs,
  calendarYearReturn,
  correlationMatrix,
  filterEligibleCandidates,
  isExcludedTheme,
  isFinancialSector,
  isSemiSubIndustry,
  medianPairwiseCorr,
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
import { fetchDailyBars } from "../src/lib/yahoo";
import type { Bar } from "../src/lib/types";

const CACHE_V1 = path.join(process.cwd(), "data", ".cache", "round19");
const CACHE = path.join(process.cwd(), "data", ".cache", "round19v2");
const OUT_MD = path.join(process.cwd(), "docs", "ROUND19_V1_DETAIL_ja.md");
const OUT_PNG = path.join(process.cwd(), "docs", "round19_v1_contribution.png");
const ATTR_FROM = "2025-07-01";
const ATTR_TO = SAKA_END;
const COMMISSION = 0.35;
const LIVE_ENTRY = "2026-07-30";
const LIVE_END = "2026-10-02";
const LIVE_BOOT_REBAL = "2026-07-01";
const LIVE_JPY_START = 463_000;

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
      closeHistory,
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

async function loadUsdjpyBars(): Promise<Bar[]> {
  const cache = path.join(PIT_CACHE, "prices", "JPY-X.json");
  if (fs.existsSync(cache)) return JSON.parse(fs.readFileSync(cache, "utf8")) as Bar[];
  try {
    const { bars } = await fetchDailyBars("JPY=X", { range: "2y", keep: 600, totalReturn: false });
    if (bars.length) {
      fs.mkdirSync(path.dirname(cache), { recursive: true });
      fs.writeFileSync(cache, JSON.stringify(bars));
    }
    return bars;
  } catch {
    return [];
  }
}

function jpyCurve(usdCurve: SakaEquityPoint[], fxBars: Bar[]): SakaEquityPoint[] {
  return usdCurve.map((p) => {
    const fx = closeOnOrBefore(fxBars, p.date);
    return { date: p.date, equity: fx != null ? p.equity * fx : p.equity };
  });
}

function periodReturn(curve: SakaEquityPoint[], from: string, to: string): number | null {
  const slice = curve.filter((p) => p.date >= from && p.date <= to);
  if (slice.length < 2) return null;
  const a = slice[0].equity;
  const b = slice[slice.length - 1].equity;
  if (a <= 0) return null;
  return b / a - 1;
}

function tradingDayIndex(calendar: string[], date: string): number {
  let lo = 0;
  let hi = calendar.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (calendar[mid] <= date) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

function pearsonBeta(port: number[], spy: number[]): { r: number; beta: number } | null {
  if (port.length < SAKA_CORR_MIN_OBS || port.length !== spy.length) return null;
  const r = pearson(port, spy);
  if (r == null) return null;
  const n = port.length;
  const meanP = port.reduce((a, b) => a + b, 0) / n;
  const meanS = spy.reduce((a, b) => a + b, 0) / n;
  let cov = 0;
  let varS = 0;
  for (let i = 0; i < n; i += 1) {
    cov += (port[i] - meanP) * (spy[i] - meanS);
    varS += (spy[i] - meanS) ** 2;
  }
  cov /= n - 1;
  varS /= n - 1;
  if (varS <= 0) return null;
  return { r, beta: cov / varS };
}

function dailyPortSpyLogReturns(
  holdings: string[],
  weights: Record<string, number>,
  calendar: string[],
  closeHistory: Map<string, Map<string, number>>,
  spyCloses: Map<string, number>,
  endDate: string,
  startDate: string,
): { port: number[]; spy: number[] } | null {
  const endIdx = tradingDayIndex(calendar, endDate);
  const startIdx = Math.max(1, tradingDayIndex(calendar, startDate));
  if (endIdx < startIdx) return null;
  let wSum = 0;
  for (const t of holdings) wSum += weights[t] ?? 0;
  if (wSum <= 0) return null;
  const port: number[] = [];
  const spy: number[] = [];
  for (let i = startIdx; i <= endIdx; i += 1) {
    const d = calendar[i];
    const d0 = calendar[i - 1];
    const rs = spyCloses.get(d);
    const rs0 = spyCloses.get(d0);
    if (rs == null || rs0 == null || rs0 <= 0) return null;
    spy.push(Math.log(rs / rs0));
    let pr = 0;
    for (const t of holdings) {
      const w = (weights[t] ?? 0) / wSum;
      const c1 = closeHistory.get(t)?.get(d);
      const c0 = closeHistory.get(t)?.get(d0);
      if (c1 == null || c0 == null || c0 <= 0) return null;
      pr += w * Math.log(c1 / c0);
    }
    port.push(pr);
  }
  return port.length >= SAKA_CORR_MIN_OBS ? { port, spy } : null;
}

type CorrRow = {
  date: string;
  medPair: number | null;
  corr1y: number | null;
  beta1y: number | null;
  corrFull: number | null;
  betaFull: number | null;
};

function correlationAtRebalance(
  date: string,
  holdings: string[],
  weights: Record<string, number>,
  env: Awaited<ReturnType<typeof buildCtx>>,
): CorrRow {
  const { calendar, ctx, spyBars } = env;
  const closeHistory = env.closeHistory ?? ctx.closeHistory;
  const spyCloses = new Map(spyBars.map((b) => [b.date, b.c]));
  if (!closeHistory) {
    return { date, medPair: null, corr1y: null, beta1y: null, corrFull: null, betaFull: null };
  }
  const inputs = holdings.length >= 2 ? buildCorrInputs(holdings, calendar, closeHistory, date) : null;
  const medPair = inputs ? medianPairwiseCorr(holdings, correlationMatrix(inputs)) : null;
  const endIdx = tradingDayIndex(calendar, date);
  const start1y = calendar[Math.max(1, endIdx - SAKA_CORR_LOOKBACK + 1)];
  const startFull = calendar[Math.max(1, tradingDayIndex(calendar, SAKA_START))];
  const s1 = dailyPortSpyLogReturns(holdings, weights, calendar, closeHistory, spyCloses, date, start1y);
  const sFull = dailyPortSpyLogReturns(holdings, weights, calendar, closeHistory, spyCloses, date, startFull);
  const b1 = s1 ? pearsonBeta(s1.port, s1.spy) : null;
  const bF = sFull ? pearsonBeta(sFull.port, sFull.spy) : null;
  return {
    date,
    medPair,
    corr1y: b1?.r ?? null,
    beta1y: b1?.beta ?? null,
    corrFull: bF?.r ?? null,
    betaFull: bF?.beta ?? null,
  };
}

function avgCorrRows(rows: CorrRow[]): CorrRow {
  const mean = (key: keyof CorrRow) => {
    const vals = rows.map((r) => r[key]).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  return {
    date: "（全リバランス平均）",
    medPair: mean("medPair"),
    corr1y: mean("corr1y"),
    beta1y: mean("beta1y"),
    corrFull: mean("corrFull"),
    betaFull: mean("betaFull"),
  };
}

function fmtR(v: number | null, digits = 3): string {
  return v == null || !Number.isFinite(v) ? "—" : v.toFixed(digits);
}

function buildSectionACriteria(adoptedId: string): string {
  return `
本レポートの採用構成は **\`${adoptedId}\`**（選定=\`plain\`・N=15・ウェイト=\`mcap_cap5\`）。以下は **時価総額順位以外**の全フィルタ／変換をコード行番号付きで列挙する（\`src/lib/round19-saka.ts\` ほか）。

### 1. ユニバース（S&P 500・PIT 構成）

| 規則 | 実装 |
|---|---|
| リバランス日 \`d\` に **S&P 500 構成銘柄**のみ | \`membersOnDate\`（\`src/lib/sp500-pit.ts:93-100\`）— \`sp500_ticker_start_end.csv\` の \`startDate\`/\`endDate\` で PIT 判定（\`isSp500MemberOnDate\` \`sp500-pit.ts:84-90\`） |
| ウォッチリスト（\`data/watchlist.yaml\`）は **不使用** | 事前登録 \`docs/ROUND19_PREREG_ja.md\`・スタディは PIT S&P のみ |

### 2. テーマ／銘柄除外（eligible 前）

| 規則 | 実装 |
|---|---|
| **ONDS** は常に除外 | \`isExcludedTheme\` \`round19-saka.ts:73-77\` |
| **solar / crypto / nuclear / quantum / space** テーマ銘柄を除外 | 同上 + \`themeOf\`（\`src/lib/themes.ts:60-66\`） |
| テーマ定義リスト | SOLAR/CRYPTO/NUCLEAR/QUANTUM/SPACE 定数（\`themes.ts:8-46\`）。**SPCX** は \`THEME_KEEP\` でテーマ扱いしない（\`themes.ts:48,62\`）— space テーマだが **S&P 用バックテストでは space 除外リストに SPCX は含めない**（\`themeOf\` が null） |
| **Financials** セクター除外 | \`isFinancialSector\` \`round19-saka.ts:79-81\`（GICS sector === \`"Financials"\`） |

### 3. 黒字（profitability）— TTM・filed PIT

| 規則 | 実装 |
|---|---|
| 状態 | \`profitabilityStatus\` \`round19-saka.ts:24-29\` → \`profitable\` / \`loss\` / \`unknown\` |
| **eligible には \`profitable\` のみ**（\`unknown\`・\`loss\` は除外） | \`filterEligibleCandidates\` \`round19-saka.ts:531-539\`（\`ctx.profitable\`） |
| TTM net income | 直近 **4 四半期**（10-K/20-F/40-F 除く）の \`NetIncomeLoss\` 等を合算（\`ttmNetIncomePitAudit\` \`round19-saka.ts:908-937\`） |
| PIT | 各四半期ファクトは **\`filed\` 日 ≤ リバランス日\`** のみ（\`factFiledOnOrBefore\` \`round19-saka.ts:887-891\`） |
| facts 欠損 | \`unknown\` → **採用プール外**（赤字扱いにしない） |

### 4. 価格・時価総額・データ

| 規則 | 実装 |
|---|---|
| **当日以前の終値が無い銘柄は除外** | \`hasPrice\` / \`filterEligibleCandidates\` \`round19-saka.ts:537\` |
| **別途出来高・流動性フィルタは無し** | 価格存在のみ |
| 時価総額 \`mcap = 終値 × 株数\`（PIT） | 株数 \`pit-shares.ts\` / \`sharesOutstandingAsOf\`；詳細レポートの \`buildCtx\` で stale 株数繰越 |
| \`mcap ≤ 0\` は **plain 選定で上位15に入らない** | \`pickHoldings\` \`round19-saka.ts:555-559\`（\`.filter((r) => r.m > 0)\`） |

### 5. 株クラス重複（同一 CIK）

| 規則 | 実装 |
|---|---|
| eligible 整列後 **CIK ごとに1ティッカー** | \`dedupeShareClassesByCik\` \`pit-share-class.ts:18-37\`（\`filterEligibleCandidates\` \`round19-saka.ts:542-543\`） |
| 優先ティッカー表 | \`PREFERRED_OVER\`（例 GOOG→GOOGL）\`pit-share-class.ts:2-8\`；同 CIK は **mcap 高い方**を残す |

### 6. 採用構成の「選定」(\`plain\`) — 時価総額順

| 規則 | 実装 |
|---|---|
| eligible の **mcap 降順**で先頭 **15** | \`pickHoldings\` \`plain\` 分岐 \`round19-saka.ts:555-559\` |
| ※ \`corrdiverse\` / \`volprune\` は **本採用では未使用**（252日相関 greedy・ρ>0.7 等は \`round19-saka.ts:546-554, 291-374\`） |

### 7. ウェイト（\`mcap_cap5\`）と半導体 30% キャップ

| 規則 | 実装 |
|---|---|
| まず **mcap 比例** | \`targetWeights\` \`round19-saka.ts:585-593\` |
| **単一銘柄 5% 上限**（超過は他銘柄へ再分配） | \`applySingleNameCap(..., 0.05)\` \`round19-saka.ts:596-597\`・アルゴ \`407-428\` |
| **半導体サブ業種**（GICS Sub-Industry に \`"semiconductor"\` を含む）のウェイト合計 **≤ 30%** | \`isSemiSubIndustry\` \`round19-saka.ts:68-71\`；\`applySemiCap\` \`round19-saka.ts:431-448\`（\`SAKA_SEMI_CAP = 0.3\` \`16\`）— 超過分は半導体をスケールダウンし、**非半導体に按分**（\`442-447\`） |

### 8. リバランス・手数料（シミュレーション）

| 規則 | 実装 |
|---|---|
| 四半期初の **最初の営業日** | \`rebalanceDates\` \`round19-saka.ts:601-613\` |
| **差分リバランス**（継続保有の微小調整はスキップ） | \`simulateSaka\` \`rebalance: "delta"\`；\`|Δ$| < $25\` **かつ** 相対ドリフト < **20%** ならスキップ（\`round19-saka.ts:17-19, 749-750, 839-868\`） |
| 手数料 | **$0.35/注文**（本レポート） |
| 初期資金 | \`SAKA_INITIAL_CASH = 3200\` \`round19-saka.ts:11\` |

### 9. In-sample 採用（30構成グリッド・本レポート外の選定手順）

| 規則 | 実装 |
|---|---|
| IS 2016-01-01～2020-12-31（\`SAKA_IS_END\` \`9\`） | |
| IS **MaxDD が SPY より浅い**構成のみ | \`selectSakaConfig\` \`round19-saka.ts:706-716\` |
| 残りから **IS CAGR 最大**、同点は **ターンオーバー低** | 同上 \`712-715\` |
`;
}

function buildSectionCPrereg(): string {
  const commits = [
    "ad777dc",
    "6e3ad93",
    "487152e",
    "05e2d3e",
    "e2380b8",
    "09acebc",
    "e2a2aec",
  ];
  const lines: string[] = [];
  for (const h of commits) {
    try {
      const row = execSync(`git log -1 --format='%H|%cI|%s' ${h}`, { encoding: "utf8" }).trim();
      const [hash, iso, ...msgParts] = row.split("|");
      const msg = msgParts.join("|");
      const jst = new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", hour12: false });
      lines.push(`| \`${hash.slice(0, 7)}\` | ${jst} JST | ${msg.replace(/\|/g, " ")} |`);
    } catch {
      lines.push(`| \`${h}\` | — | （取得失敗） |`);
    }
  }
  return `
### コミット年表（抜粋・JST）

| hash | 日時 (JST) | メッセージ |
|---|---|---|
${lines.join("\n")}

### 事前登録と OOS 結果の時間順

- **\`ad777dc\` / \`6e3ad93\`**（2026-10-04 夜 JST）: \`docs/ROUND19_PREREG_ja.md\` の初版と追補（30構成・IS 採用規則・半導体30%・PIT mcap 等）。**いずれも \`487152e\`（初回スタディ結果）より前**。
- **\`487152e\`**: 初回 \`round19-saka-study\` 実行・\`docs/ROUND19_ja.md\` 等の **結果コミット**（同一日・登録の約45分後 UTC）。

### 正直な限界（過大評価しない）

1. **IS 採用規則そのもの**（IS DD < SPY → IS CAGR 最大）は事前登録どおりだが、**OOS 表は初回スタディ（\`487152e\`）以降、リポジトリ内で繰り返し参照・再掲されている**。完全な「OOS を一度も見ずに固定」は、**結果コミット後の読者視点では成立しない**。
2. **Corrected v1 データ修正**（\`05e2d3e\` filed PIT 黒字、\`e2380b8\` PIT データセット、\`09acebc\` CIK/価格拡充、\`e2a2aec\` META/XOM）は **2021+ のバックテスト数字を見た後**に入った。これは **ルール変更ではなくデータ修正**が主だが、**IS を再計算すると採用 ID が変わる**（例: \`plain_15__equal\` → \`plain_15__mcap_cap5\`、\`ROUND19_AUDIT_ja.md\` / 本レポート）。
3. **差分リバランス**（$25 / 20%）は \`05e2d3e\` 以降の corrected v1 シミュレーションで使う。事前登録本文は主にフル清算想定；**実装・Corrected v1 は delta**（\`round19-corrected-v1-study.ts\` の \`simOpts\`）。
4. **半導体 30% キャップ**は追補 \`6e3ad93\` で **結果コミット前**に文書化（\`applySemiCap\` は \`487152e\` からコードに存在）。
5. **テーマリスト**（quantum 等）は \`themes.ts\` の watchlist 系コミットと同日の研究フロー。**Saka バックテスト専用の独立 prereg ではない**（ただし \`isExcludedTheme\` が参照するリストはコードで固定）。
6. **本レポートの採用構成**はデータ修正後の **再選定結果**を記載。OOS 順位・CAGR は **データ版に依存**する。

**結論:** 「2016–2020 のみでルールを決め、2021+ は一度だけ評価」は **手順として事前登録されている**が、**データ修正と再実行により採用 \`plain_15__mcap_cap5\` は初回結果（\`plain_15__equal\`）と異なる**。OOS を **設計に使った**というより、**公開後にデータを直し IS をやり直した**のが正確。
`;
}

function benchCurve(bars: Bar[], from: string, to: string, initialUsd: number): SakaEquityPoint[] {
  const slice = bars.filter((b) => b.date >= from && b.date <= to);
  if (slice.length < 2) return [];
  const p0 = slice[0].c;
  return slice.map((b) => ({ date: b.date, equity: initialUsd * (b.c / p0) }));
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

  const fxBars = await loadUsdjpyBars();
  const entryFx = closeOnOrBefore(fxBars, LIVE_ENTRY);
  const endFx = closeOnOrBefore(fxBars, LIVE_END);
  const initialUsdLive = entryFx != null && entryFx > 0 ? LIVE_JPY_START / entryFx : null;
  let liveSection = "（USD/JPY または価格データ不足のため未計算）";
  if (initialUsdLive != null) {
    const liveSim = simulateSaka(adopted, calendar, membersOn, ctx, semiOf, price, COMMISSION, LIVE_ENTRY, LIVE_END, {
      rebalance: "delta",
      minTradeUsd: SAKA_REBAL_MIN_TRADE_USD,
      relDrift: SAKA_REBAL_REL_DRIFT,
      initialCash: initialUsdLive,
      bootstrapHoldingsDate: LIVE_BOOT_REBAL,
    });
    const liveJpy = jpyCurve(liveSim.curve, fxBars);
    const retUsd = periodReturn(liveSim.curve, LIVE_ENTRY, LIVE_END);
    const retJpy = periodReturn(liveJpy, LIVE_ENTRY, LIVE_END);
    const ddUsd = drawdownDetail(liveSim.curve, LIVE_ENTRY, LIVE_END);
    const ddJpy = drawdownDetail(liveJpy, LIVE_ENTRY, LIVE_END);
    const benchTickers = ["SPY", "QQQ", "SOXX"] as const;
    const benchRows: string[] = [];
    for (const sym of benchTickers) {
      const bars = loadBars(sym);
      const c = benchCurve(bars, LIVE_ENTRY, LIVE_END, initialUsdLive);
      const rUsd = periodReturn(c, LIVE_ENTRY, LIVE_END);
      const cJpy = jpyCurve(c, fxBars);
      const rJpy = periodReturn(cJpy, LIVE_ENTRY, LIVE_END);
      benchRows.push(
        `| ${sym} | ${rUsd != null ? `${(rUsd * 100).toFixed(2)}%` : "—"} | ${rJpy != null ? `${(rJpy * 100).toFixed(2)}%` : "—"} |`,
      );
    }
    liveSection = `
**窓:** ${LIVE_ENTRY} 終値時点で **¥${LIVE_JPY_START.toLocaleString("ja-JP")}** を USD へ換算し投資（USD/JPY **${entryFx!.toFixed(2)}** → ${LIVE_END} 時点 **${endFx?.toFixed(2) ?? "—"}**）。  
**保有の起点:** ${LIVE_BOOT_REBAL} リバランスの採用15（${adopted.id}）。**${LIVE_END}** までに **2026-10-01** リバランスを適用。手数料 **$${COMMISSION}/注文**（差分リバランス）。

| | USD建て | 円建て（日次 USD/JPY で換算） |
|---|---:|---:|
| 期間リターン | ${retUsd != null ? `${(retUsd * 100).toFixed(2)}%` : "—"} | ${retJpy != null ? `${(retJpy * 100).toFixed(2)}%` : "—"} |
| 最大DD | ${(ddUsd.maxDd * 100).toFixed(2)}%（ピーク ${ddUsd.peakDate} → ボトム ${ddUsd.troughDate}） | ${(ddJpy.maxDd * 100).toFixed(2)}%（ピーク ${ddJpy.peakDate} → ボトム ${ddJpy.troughDate}） |

**ベンチマーク（同じ USD 初期額）**

| 指数 | USD | 円建て |
|---|---:|---:|
${benchRows.join("\n")}

**Emma 実績（参考・計算基準未確認）:** 約 **+10.9%**、最大 DD 約 **-6%**。

**修正前データでの暫定値（独立チェック時点・参考）:** Saka **+6.32%** USD / **+2.82%** 円、DD **-2.80%** USD / **-5.88%** 円；SPY +4.01/+0.59；QQQ +9.76/+6.15；SOXX +16.78/+12.94（USD/JPY 163.30→157.93）。
`;
  }

  const dataCheckPath = path.join(PIT_CACHE, "rebalance-data-check.json");
  spawnSync("npx", ["tsx", "scripts/pit-rebalance-data-check.ts", "--write-cache", "--quiet"], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
  let dataFixSection = "（`pit-rebalance-data-check.ts` 未実行）";
  try {
    const parsed = JSON.parse(fs.readFileSync(dataCheckPath, "utf8")) as {
      zeroMcapSample: Array<{ date: string; tickers: string[] }>;
      cikMismatchCountAllPitTickers: number;
      cikMismatchSpMembers2026_10_01: number;
      cikMismatchSpSample: Array<{ ticker: string; reason: string }>;
      gicsCsvCikOverrides2026_10_01: Array<{ ticker: string; gicsCik: number; canonicalCik: number }>;
      baskets: Record<string, { before: string[]; after: string[] }>;
      meta: { shares2026_10_01: number | null; xomProfit2026_10_01: string };
    };
    const basketLines = Object.entries(parsed.baskets).map(([d, b]) => {
      const before = new Set(b.before);
      const after = new Set(b.after);
      const added = b.after.filter((t) => !before.has(t));
      const removed = b.before.filter((t) => !after.has(t));
      const changed = added.length || removed.length ? `入替: +${added.join(",") || "—"} / -${removed.join(",") || "—"}` : "変更なし";
      return `- **${d}:** ${changed}`;
    });
    dataFixSection = `
**(a) META 株数:** \`dei:EntityCommonStockSharesOutstanding\` 欠損時は \`us-gaap\` の加重平均株数へフォールバック（\`pit-shares.ts\`）。2026-10-01 時点株数: **${parsed.meta.shares2026_10_01?.toLocaleString() ?? "null"}**。

**(b) XOM CIK:** \`data/pit_cik_overrides.json\` で **34088**（Exxon Mobil）。黒字判定 2026-10-01: **${parsed.meta.xomProfit2026_10_01}**。

| チェック | 結果 |
|---|---|
| CIK↔SEC 不一致（全 PIT 履歴銘柄） | **${parsed.cikMismatchCountAllPitTickers}** |
| GICS CSV CIK≠解決後 CIK（2026-10-01 構成員） | **${parsed.gicsCsvCikOverrides2026_10_01.length}**（${parsed.gicsCsvCikOverrides2026_10_01.map((r) => `${r.ticker}:${r.gicsCik}→${r.canonicalCik}`).join(", ") || "—"}） |
| リバランス日・mcap=0（価格あり） | 直近サンプル: ${JSON.stringify(parsed.zeroMcapSample)} |

**2026-07-01 / 2026-10-01 バスケット（株数フォールバック＋XOM 修正前後）**

${basketLines.join("\n")}
`;
  } catch {
    dataFixSection = "（データチェック JSON の読込に失敗）";
  }

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

  const corrByRebal: CorrRow[] = sim.rebalRows.map((r) => {
    const w = targetWeights(adopted, r.holdings, r.date, ctx, semiOf);
    return correlationAtRebalance(r.date, r.holdings, w, env);
  });
  const corrAvg = avgCorrRows(corrByRebal);
  const corrLatest4 = corrByRebal.slice(-4);
  const corrTable = (rows: CorrRow[]) =>
    rows
      .map(
        (row) =>
          `| ${row.date} | ${fmtR(row.medPair)} | ${fmtR(row.corr1y)} | ${fmtR(row.beta1y)} | ${fmtR(row.corrFull)} | ${fmtR(row.betaFull)} |`,
      )
      .join("\n");
  const sectionA = buildSectionACriteria(adopted.id);
  const sectionB = `
**対象:** 採用 \`${adopted.id}\` の各リバランス日時点の **保有15**（ウェイトは \`targetWeights\` 適用後）。

**保有間相関（中央値）:** 各銘柄の **252 営業日**対数リターン（\`SAKA_CORR_LOOKBACK\` \`round19-saka.ts:12\`）を **日付揃え**（\`pearsonOnAlignedSeries\` \`147-159\`）し、15銘柄の **上三角ペア相関の中央値**（\`medianPairwiseCorr\` \`249-261\`）。最低 **126** 観測（\`SAKA_CORR_MIN_OBS\` \`13\`）。

**ポートフォリオ vs SPY:** リバランス日の **固定ウェイト**で日次ポート対数リターン（\`Σ w_i r_i\`）を構成し、同日 SPY 対数リターンと **Pearson 相関・β（OLS）**。
- **1年:** 直近 **252 営業日**（リバランス日を含む終端ウィンドウ）
- **全期間:** \`${SAKA_START}\` 以降の最初の営業日～リバランス日（同じウェイト仮定・バックテスト平均行は各四半期スナップショットの算術平均）

### 直近4リバランス

| リバランス日 | 保有間ρ 中央値 | ρ(ポート,SPY) 1y | β vs SPY 1y | ρ(ポート,SPY) 全期間 | β vs SPY 全期間 |
|---|---:|---:|---:|---:|---:|
${corrTable(corrLatest4)}

### 全リバランス平均（${corrByRebal.length} 四半期）

| | 保有間ρ 中央値 | ρ(ポート,SPY) 1y | β vs SPY 1y | ρ(ポート,SPY) 全期間 | β vs SPY 全期間 |
|---|---:|---:|---:|---:|---:|
| 平均 | ${fmtR(corrAvg.medPair)} | ${fmtR(corrAvg.corr1y)} | ${fmtR(corrAvg.beta1y)} | ${fmtR(corrAvg.corrFull)} | ${fmtR(corrAvg.betaFull)} |
`;
  const sectionC = buildSectionCPrereg();

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
      title: `${adopted.id} contribution ${ATTR_FROM} to ${ATTR_TO} (pp)`,
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

## データ修正（META 株数・XOM CIK）

${dataFixSection}

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

## (7) ライブ窓シミュレーション（${LIVE_ENTRY} ～ ${LIVE_END}）

${liveSection}

---

## (A) 選定・フィルタ規則一覧（コード根拠）

${sectionA}

---

## (B) 保有相関・SPY 相関／β

${sectionB}

---

## (C) 事前登録と 2021+ データの関係（証跡）

${sectionC}

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
