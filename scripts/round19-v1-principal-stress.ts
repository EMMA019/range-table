/**
 * Principal-breach stress for adopted v1 plain_15__mcap.
 * Does not change pit-mcap ranking. Writes docs/ROUND19_V1_PRINCIPAL_STRESS_ja.md.
 *
 *   NODE_OPTIONS=--max-old-space-size=8192 ./node_modules/.bin/tsx scripts/round19-v1-principal-stress.ts
 */
import fs from "node:fs";
import path from "node:path";
import {
  SAKA_CONFIGS,
  SAKA_END,
  SAKA_INITIAL_CASH,
  SAKA_OOS_START,
  SAKA_REBAL_MIN_TRADE_USD,
  SAKA_REBAL_REL_DRIFT,
  SAKA_START,
  drawdownFromCurve,
  filterEligibleCandidates,
  isSemiSubIndustry,
  pickHoldings,
  profitabilityStatus,
  rebalanceDates,
  applySameCikHandoffTransfers,
  simulateSaka,
  targetWeights,
  tradingDaysFromBars,
  type ProfitabilityStatus,
  type SakaCandidateContext,
  type SakaEquityPoint,
} from "../src/lib/round19-saka";
import { buildPitCikMapForTickers } from "../src/lib/pit-cik";
import { buildPitFactsIndex, loadMergedPitFacts } from "../src/lib/pit-facts-index";
import { pitMarketCapAtDate } from "../src/lib/pit-mcap";
import { mcapCloseOnOrBefore } from "../src/lib/pit-mcap-price";
import { loadPitSplits, type PitSplit } from "../src/lib/pit-splits";
import { loadPitBars, loadPitCikOverrides, PIT_CACHE } from "../src/lib/pit-dataset";
import { loadSp500PitFiles, membersOnDate, uniqueTickersInRange, buildSameCikHandoffResolver } from "../src/lib/sp500-pit";
import type { Bar } from "../src/lib/types";

const OUT_MD = path.join(process.cwd(), "docs", "ROUND19_V1_PRINCIPAL_STRESS_ja.md");
const COMMISSION = 0.35;
const PRINCIPAL = SAKA_INITIAL_CASH;
const MATERIAL = 0.01;
const MIN_SESSIONS = 252;
const CONFIG = SAKA_CONFIGS.find((c) => c.id === "plain_15__mcap")!;
const CALLOUT_MONTHS = ["2021-09", "2021-10", "2021-11", "2021-12", "2022-01"];
const FIXED_MONTHS = ["2016-01", "2021-01"];
const WATCH = ["AAPL", "MSFT", "AMZN", "GOOGL", "NVDA", "META", "FB"];

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

function monthStarts(calendar: string[], from: string, to: string): string[] {
  const out: string[] = [];
  let last = "";
  for (const d of calendar) {
    if (d < from || d > to) continue;
    const key = d.slice(0, 7);
    if (key !== last) {
      out.push(d);
      last = key;
    }
  }
  return out;
}

function inclusiveCalDays(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.round(ms / 86_400_000) + 1;
}

function quantile(values: number[], q: number): number {
  const s = [...values].sort((a, b) => a - b);
  if (!s.length) return NaN;
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return s[lo]!;
  const w = pos - lo;
  return s[lo]! * (1 - w) + s[hi]! * w;
}

function pct(x: number, digits = 1): string {
  if (!Number.isFinite(x)) return "—";
  const n = x * 100;
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

function num(x: number, digits = 1): string {
  if (!Number.isFinite(x)) return "—";
  return x.toFixed(digits);
}

type Book = { holdings: string[]; weights: Record<string, number> };

type StressRow = {
  start: string;
  month: string;
  pitDate: string;
  nextRebal: string;
  sessions: number;
  endEquity: number;
  day1Equity: number;
  deepest: number;
  troughDate: string;
  daysUnder: number;
  materialDays: number;
  episodeCalDays: number;
  longestEpisodeCal: number;
  spanCalDays: number;
  material: boolean;
  strict: boolean;
  maxDd: number;
  spyMaxDd: number;
  holdings: string[];
  endUnder: boolean;
};

function simulateDelta(
  calendar: string[],
  from: string,
  to: string,
  rebalSet: Set<string>,
  bootstrapPit: string | null,
  bookOf: (pitDate: string) => Record<string, number>,
  price: (ticker: string, date: string) => number | null,
  handoffSuccessor?: (fromTicker: string, pitDate: string) => string | null,
): SakaEquityPoint[] {
  const minTradeUsd = SAKA_REBAL_MIN_TRADE_USD;
  const relDrift = SAKA_REBAL_REL_DRIFT;
  let cash = PRINCIPAL;
  let bootstrapped = bootstrapPit == null;
  const shares: Record<string, number> = {};
  const lastPrice: Record<string, number> = {};
  const curve: SakaEquityPoint[] = [];

  const equityOn = (date: string) => {
    let eq = cash;
    for (const [t, sh] of Object.entries(shares)) {
      const p = price(t, date) ?? lastPrice[t] ?? 0;
      eq += sh * p;
    }
    return eq;
  };

  for (const date of calendar) {
    if (date < from) continue;
    if (date > to) break;
    for (const t of Object.keys(shares)) {
      const p = price(t, date);
      if (p != null) lastPrice[t] = p;
    }
    const scheduled = rebalSet.has(date);
    const bootstrapToday = !bootstrapped && bootstrapPit != null;
    if (scheduled || bootstrapToday) {
      const pitDate = scheduled ? date : bootstrapPit!;
      if (bootstrapToday) bootstrapped = true;
      const weights = bookOf(pitDate);
      if (handoffSuccessor) {
        applySameCikHandoffTransfers(shares, weights, pitDate, price, lastPrice, handoffSuccessor);
      }
      const eq = equityOn(date);
      const targetSet = new Set(Object.keys(weights));
      for (const t of Object.keys(shares)) {
        if (targetSet.has(t)) continue;
        const p = price(t, date) ?? lastPrice[t];
        if (p && shares[t] > 0) cash += shares[t] * p - COMMISSION;
        delete shares[t];
      }
      for (const t of Object.keys(weights)) {
        const p = price(t, date);
        if (!p || p <= 0) continue;
        const targetUsd = eq * weights[t];
        const curUsd = (shares[t] ?? 0) * p;
        const delta = targetUsd - curUsd;
        const had = (shares[t] ?? 0) > 0;
        if (had) {
          const rel = curUsd > 0 ? Math.abs(delta) / curUsd : 1;
          if (Math.abs(delta) < minTradeUsd && rel < relDrift) continue;
        }
        if (delta < -minTradeUsd / 2) {
          const sellUsd = Math.min(-delta, curUsd);
          const sellSh = sellUsd / p;
          if (sellSh > 0 && sellSh <= shares[t]) {
            shares[t] -= sellSh;
            cash += sellUsd - COMMISSION;
            if (shares[t] <= 1e-9) delete shares[t];
          }
        } else if (delta > minTradeUsd / 2) {
          const buyUsd = delta;
          const cost = buyUsd + COMMISSION;
          if (cost <= cash) {
            cash -= cost;
            shares[t] = (shares[t] ?? 0) + buyUsd / p;
            lastPrice[t] = p;
          }
        } else if (!had && targetUsd >= minTradeUsd / 2) {
          const cost = targetUsd + COMMISSION;
          if (cost <= cash) {
            cash -= cost;
            shares[t] = targetUsd / p;
            lastPrice[t] = p;
          }
        }
      }
    }
    curve.push({ date, equity: equityOn(date) });
  }
  return curve;
}

function measure(curve: SakaEquityPoint[], spyCurve: SakaEquityPoint[], pitDate: string, nextRebal: string, holdings: string[]): StressRow {
  const start = curve[0]!.date;
  let minEq = Infinity;
  let troughDate = start;
  let daysUnder = 0;
  let materialDays = 0;
  const episodes: Array<{ start: string; end: string }> = [];
  let cur: { start: string; end: string } | null = null;
  for (const p of curve) {
    if (p.equity < minEq) {
      minEq = p.equity;
      troughDate = p.date;
    }
    const under = p.equity < PRINCIPAL;
    if (under) {
      daysUnder += 1;
      if (p.equity < PRINCIPAL * (1 - MATERIAL)) materialDays += 1;
      if (!cur) cur = { start: p.date, end: p.date };
      else cur.end = p.date;
    } else if (cur) {
      episodes.push(cur);
      cur = null;
    }
  }
  if (cur) episodes.push(cur);
  const episodeCalDays = episodes.reduce((s, e) => s + inclusiveCalDays(e.start, e.end), 0);
  const longestEpisodeCal = episodes.reduce((m, e) => Math.max(m, inclusiveCalDays(e.start, e.end)), 0);
  const spanCalDays = episodes.length ? inclusiveCalDays(episodes[0]!.start, episodes[episodes.length - 1]!.end) : 0;
  const deepest = minEq / PRINCIPAL - 1;
  const dd = drawdownFromCurve(curve, start, SAKA_END);
  const spyDd = drawdownFromCurve(spyCurve, start, SAKA_END);
  const endEquity = curve[curve.length - 1]!.equity;
  return {
    start,
    month: start.slice(0, 7),
    pitDate,
    nextRebal,
    sessions: curve.length,
    endEquity,
    day1Equity: curve[0]!.equity,
    deepest,
    troughDate,
    daysUnder,
    materialDays,
    episodeCalDays,
    longestEpisodeCal,
    spanCalDays,
    material: deepest < -MATERIAL,
    strict: deepest < 0,
    maxDd: dd.maxDd,
    spyMaxDd: spyDd.maxDd,
    holdings,
    endUnder: endEquity < PRINCIPAL,
  };
}

function distLines(label: string, rows: StressRow[]): string {
  const n = rows.length;
  if (!n) return `| ${label} | 0 | — | — | — | — | — | — | — | — |`;
  const depths = rows.map((r) => r.deepest);
  const days = rows.map((r) => r.daysUnder);
  const matDays = rows.map((r) => r.materialDays);
  const months = rows.map((r) => r.episodeCalDays / 30.4375);
  const materialN = rows.filter((r) => r.material).length;
  const strictN = rows.filter((r) => r.strict).length;
  const shallower = rows.filter((r) => r.maxDd > r.spyMaxDd).length;
  return `| ${label} | ${n} | ${num((100 * strictN) / n, 0)}% | ${num((100 * materialN) / n, 0)}% | ${pct(quantile(depths, 0.5))} | ${pct(quantile(depths, 0.1))} | ${num(quantile(days, 0.5), 0)} / ${num(quantile(months, 0.5))} | ${num(quantile(days, 0.9), 0)} / ${num(quantile(months, 0.9))} | ${num(quantile(matDays, 0.5), 0)} / ${num(quantile(matDays, 0.9), 0)} | ${num((100 * shallower) / n, 0)}% |`;
}

function rowLine(r: StressRow): string {
  const names = r.holdings.join(", ");
  return `| ${r.month} | ${r.start} | ${r.pitDate} | ${r.nextRebal || "—"} | ${pct(r.deepest)} | ${r.troughDate} | ${r.daysUnder} | ${num(r.episodeCalDays / 30.4375)} | ${r.material ? "あり" : "なし"} | ${pct(r.maxDd)} | ${pct(r.spyMaxDd)} | ${pct(r.endEquity / PRINCIPAL - 1)} | ${r.endUnder ? "下" : "上"} | ${names} |`;
}

function bookTable(rebals: string[], books: Map<string, Book>, from: string, to: string): string {
  const lines: string[] = [];
  for (const d of rebals) {
    if (d < from || d > to) continue;
    const b = books.get(d);
    if (!b) continue;
    const present = WATCH.filter((t) => b.holdings.includes(t));
    const absent = WATCH.filter((t) => !b.holdings.includes(t));
    lines.push(`| ${d} | ${present.join(", ") || "—"} | ${absent.join(", ") || "—"} | ${b.holdings.join(", ")} |`);
  }
  return lines.join("\n");
}

async function main() {
  const t0 = Date.now();
  const { intervals, gics } = await loadSp500PitFiles(PIT_CACHE);
  const tickers = uniqueTickersInRange(intervals, SAKA_START, SAKA_END);
  const overrides = loadPitCikOverrides().cik;
  const cikResolved = await buildPitCikMapForTickers(PIT_CACHE, gics, tickers, overrides);
  const cikMap = new Map([...cikResolved.entries()].map(([t, r]) => [t, r.cik]));
  const factsIndex = buildPitFactsIndex(PIT_CACHE);
  const factByTicker = new Map<string, unknown | undefined>();
  const factForTicker = (t: string): unknown | undefined => {
    if (factByTicker.has(t)) return factByTicker.get(t);
    const json = loadMergedPitFacts(t, cikMap.get(t) ?? null, factsIndex, PIT_CACHE);
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
  const splitsBy = new Map<string, PitSplit[]>();
  for (const t of tickers) {
    const bars = loadPitBars(t, PIT_CACHE);
    if (bars.length) barsBy.set(t, bars);
    splitsBy.set(t, loadPitSplits(t, PIT_CACHE));
  }
  const spyBars = loadPitBars("SPY", PIT_CACHE);
  if (!spyBars.length) throw new Error("SPY bars missing from PIT cache");
  const calendar = tradingDaysFromBars(spyBars);
  const price = (ticker: string, date: string) => closeOnOrBefore(barsBy.get(ticker) ?? (ticker === "SPY" ? spyBars : []), date);
  const mcapCache = new Map<string, number>();
  const mcapOf = (t: string, date: string) => {
    const k = `${t}|${date}`;
    const hit = mcapCache.get(k);
    if (hit != null) return hit;
    const v = pitMarketCapAtDate(barsBy.get(t) ?? [], factForTicker(t), date, splitsBy.get(t) ?? []);
    mcapCache.set(k, v);
    return v;
  };
  const hasPriceCache = new Map<string, boolean>();
  const ctx: SakaCandidateContext = {
    calendar,
    closeHistory: new Map(),
    gicsOf: (t) => {
      const g = gics.get(t);
      if (!g) return null;
      return { sector: g.sector, subIndustry: g.subIndustry, semiBucket: isSemiSubIndustry(g.subIndustry) };
    },
    mcap: mcapOf,
    sharesLookup: () => ({ shares: 0, stale: true }),
    profitable: (t, date) => profitOf(t, date) === "profitable",
    hasPrice: (t, date) => {
      const k = `${t}|${date}`;
      const hit = hasPriceCache.get(k);
      if (hit != null) return hit;
      const v = mcapCloseOnOrBefore(barsBy.get(t) ?? [], date) != null;
      hasPriceCache.set(k, v);
      return v;
    },
    cikOf: (t) => cikMap.get(t) ?? null,
  };
  const semiOf = (t: string) => ctx.gicsOf(t)?.semiBucket ?? false;
  const handoffSuccessor = buildSameCikHandoffResolver(intervals, (t) => cikMap.get(t) ?? null);
  const membersOn = (date: string) => membersOnDate(intervals, date);
  const rebals = rebalanceDates(calendar, SAKA_START, SAKA_END);
  const rebalSet = new Set(rebals);
  const books = new Map<string, Book>();
  console.log(`loading done ${((Date.now() - t0) / 1000).toFixed(1)}s; rebals=${rebals.length}`);
  for (const date of rebals) {
    const t1 = Date.now();
    const eligible = filterEligibleCandidates(membersOn(date), date, ctx);
    const holdings = pickHoldings(CONFIG, eligible, date, ctx);
    const weights = targetWeights(CONFIG, holdings, date, ctx, semiOf);
    const ranked = Object.entries(weights)
      .filter(([, w]) => w > 0)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([t]) => t);
    books.set(date, { holdings: ranked, weights });
    console.log(`book ${date} n=${ranked.length} ${(Date.now() - t1) / 1000}s`);
  }

  const bookOf = (pitDate: string) => books.get(pitDate)?.weights ?? {};
  const aligned = rebals[0];
  if (!aligned) throw new Error("no rebalance dates");
  const mine = simulateDelta(calendar, aligned, SAKA_END, rebalSet, null, bookOf, price, handoffSuccessor);
  const ref = simulateSaka(CONFIG, calendar, membersOn, ctx, semiOf, price, COMMISSION, aligned, SAKA_END, {
    rebalance: "delta",
    minTradeUsd: SAKA_REBAL_MIN_TRADE_USD,
    relDrift: SAKA_REBAL_REL_DRIFT,
    initialCash: PRINCIPAL,
    handoffSuccessor,
  });
  let maxDiff = 0;
  if (mine.length !== ref.curve.length) maxDiff = Infinity;
  else {
    for (let i = 0; i < mine.length; i += 1) {
      if (mine[i]!.date !== ref.curve[i]!.date) {
        maxDiff = Infinity;
        break;
      }
      maxDiff = Math.max(maxDiff, Math.abs(mine[i]!.equity - ref.curve[i]!.equity));
    }
  }
  console.log(`sanity vs simulateSaka from ${aligned}: max |Δequity|=${maxDiff} points=${mine.length}/${ref.curve.length}`);
  if (!(maxDiff < 0.05)) throw new Error(`delta copy diverges from simulateSaka (max abs equity diff ${maxDiff})`);

  const q2021 = rebals.find((d) => d >= SAKA_OOS_START);
  if (q2021) {
    const mine21 = simulateDelta(calendar, q2021, SAKA_END, rebalSet, null, bookOf, price, handoffSuccessor);
    const ref21 = simulateSaka(CONFIG, calendar, membersOn, ctx, semiOf, price, COMMISSION, q2021, SAKA_END, {
      rebalance: "delta",
      minTradeUsd: SAKA_REBAL_MIN_TRADE_USD,
      relDrift: SAKA_REBAL_REL_DRIFT,
      initialCash: PRINCIPAL,
      handoffSuccessor,
    });
    let d21 = mine21.length === ref21.curve.length ? 0 : Infinity;
    if (d21 === 0) {
      for (let i = 0; i < mine21.length; i += 1) {
        if (mine21[i]!.date !== ref21.curve[i]!.date) {
          d21 = Infinity;
          break;
        }
        d21 = Math.max(d21, Math.abs(mine21[i]!.equity - ref21.curve[i]!.equity));
      }
    }
    console.log(`sanity vs simulateSaka from ${q2021}: max |Δequity|=${d21}`);
    if (!(d21 < 0.05)) throw new Error(`2021-aligned delta copy diverges (${d21})`);
  }

  const starts = monthStarts(calendar, SAKA_START, SAKA_END);
  const rows: StressRow[] = [];
  for (const start of starts) {
    let pitDate = "";
    for (const d of rebals) {
      if (d <= start) pitDate = d;
      else break;
    }
    if (!pitDate) continue;
    const startIsRebal = rebalSet.has(start);
    const bootstrapPit = startIsRebal ? null : pitDate;
    const nextRebal = rebals.find((d) => d > start) ?? "";
    const curve = simulateDelta(calendar, start, SAKA_END, rebalSet, bootstrapPit, bookOf, price, handoffSuccessor);
    const p0 = price("SPY", start);
    if (p0 == null || p0 <= 0) throw new Error(`SPY price missing at ${start}`);
    const spyCurve: SakaEquityPoint[] = curve.map((p) => {
      const px = price("SPY", p.date);
      return { date: p.date, equity: px != null && px > 0 ? (PRINCIPAL * px) / p0 : PRINCIPAL };
    });
    const book = books.get(pitDate);
    rows.push(measure(curve, spyCurve, pitDate, nextRebal, book?.holdings ?? []));
  }
  console.log(`paths=${rows.length} elapsed ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const oos = rows.filter((r) => r.start >= SAKA_OOS_START);
  const long = rows.filter((r) => r.sessions >= MIN_SESSIONS);
  const longOos = oos.filter((r) => r.sessions >= MIN_SESSIONS);
  const worst = [...rows].sort((a, b) => a.deepest - b.deepest || a.start.localeCompare(b.start)).slice(0, 8);
  const callouts = CALLOUT_MONTHS.map((m) => rows.find((r) => r.month === m)).filter((r): r is StressRow => r != null);
  const fixed = FIXED_MONTHS.map((m) => rows.find((r) => r.month === m)).filter((r): r is StressRow => r != null);
  const day1 = rows.map((r) => r.day1Equity / PRINCIPAL - 1);

  const header = [
    "# Round 19 v1 元本割れストレス（plain_15__mcap）",
    "",
    "**状態:** 計測のみ。`src/lib/pit-mcap.ts` は変えていない。債券・金、SPY 200日で現金、含み益のあとに株を厚くする、といったスリーブは入れていない。",
    `**在庫:** [\`docs/ROUND19_MCAP_LEAK_AUDIT_ja.md\`](ROUND19_MCAP_LEAK_AUDIT_ja.md)（コミット \`930540d53483d0765febb7592cd0ad8982b161c5\`）。件数は算出不可 19、偽急落 7、参照上位なのにPIT下位 30、ティッカー変更 24、穴埋め 51、合計 131。この数値にはそのリークがまだ入っている。`,
    "**生成:** `scripts/round19-v1-principal-stress.ts`",
    "**サイト非掲載。**",
    "",
    "## 定義",
    "",
    "主レンズは元本割れ。古典のピーク・トゥ・トラフ MaxDD は、これまでの v1 との連続のために併記する。",
    "",
    `- ルールは採用 v1 \`plain_15__mcap\`。四半期の差分リバランス、注文あたり $0.35、継続銘柄は |Δ$| < $25 かつ相対ドリフト < 20% なら見送り、端株。半導体サブインダストリの合計が 30% を超えるときだけ \`applySemiCap\`。`,
    `- 元本は $${PRINCIPAL.toLocaleString("en-US")}。叙事上の 50 万円は 1 ドル = 156.25 円の固定換算（500,000 / 3,200）であり、実勢レートではない。深さは NAV / 元本 − 1 なので、円で読み替えても同じ比率になる。`,
    `- 開始は各月の最初の SPY セッション。${SAKA_START} から ${SAKA_END} まで。その日に元本を入れ、${SAKA_END} まで v1 のルールで持つ。`,
    "- リバランス日は全期間の四半期初セッションに固定する。開始日が四半期日でないときは、その日以前で最後の四半期リバランスの PIT で銘柄とウェイトを決め、開始日の価格で買う。開始月そのものを四半期の初日にはしない（11 月開始を 11 月のリバランスにしない）。",
    "- 最深元本割れ = 経路上の min(NAV / 元本) − 1。",
    "- 水中取引日 = NAV < 元本のセッション数。水中月 = 連続して NAV < 元本だった各区間について、両端を含む暦日を足し、30.4375 で割ったもの。途中で元本へ戻った日は、その合計に入れない。",
    `- 材料割れ = 最深が −${(MATERIAL * 100).toFixed(0)}% より深い。初日の手数料だけで NAV は元本をわずかに下回る。測定した初日の元本比の中央値は ${pct(quantile(day1, 0.5), 2)}。厳密な NAV < 元本は、この手数料の凹みでも「割れた」になる。割れたかどうかの主指標は材料割れにする。`,
    "- 古典 MaxDD は同じ日付の資産曲線。SPY は手数料なしの買い持ちで、開始日終値を元本に合わせる。MaxDD はピーク比で負の値。戦略の MaxDD が SPY より大きい（ゼロに近い）とき「SPY より浅い」。",
    "- 分布の p90 深さは、深さ（負の値）の 10 パーセンタイル。開始月の 10% はこれより深い。p90 期間は水中取引日の 90 パーセンタイル。いずれも (n−1)×q の位置を線形補間する。",
    `- 残取引日が ${MIN_SESSIONS} 未満の開始月は 2026-10-02 で打ち切られる。期間の p90 は、残取引日 ≥ ${MIN_SESSIONS} の列を主に読む。`,
    "",
    "## 事実",
    "",
    `開始月は ${rows.length}。うち 2021-01 以降は ${oos.length}。残取引日 ≥ ${MIN_SESSIONS} は全期間 ${long.length}、2021 以降 ${longOos.length}。`,
    `四半期リバランスは ${rebals[0]} から ${rebals[rebals.length - 1]} の ${rebals.length} 日。`,
    `差分ループは、四半期日に揃えた開始（${aligned}${q2021 ? ` と ${q2021}` : ""}）で \`simulateSaka\` の delta と資産曲線が一致する（絶対差 < $0.05）。月の途中の開始だけ、窓の初日をリバランスにしない点で \`simulateSaka\` と違う。`,
    "",
    "### 分布",
    "",
    "| 集合 | 開始月 | 厳密に割れた割合 | 材料割れの割合 | 最深の中央値 | 最深の p90 | 水中 取引日/月 の中央値 | 水中 取引日/月 の p90 | 材料の水中取引日 中央値/p90 | 古典 MaxDD が SPY より浅い割合 |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    distLines("2016–2026 の全開始月", rows),
    distLines("2021–2026 の開始月", oos),
    distLines(`残取引日 ≥ ${MIN_SESSIONS}`, long),
    distLines(`2021–2026 かつ残取引日 ≥ ${MIN_SESSIONS}`, longOos),
    "",
    "水中の「月」はカレンダー日の合計であり、材料列は取引日（NAV が元本の 99% を下回ったセッション数）である。材料列は、手数料だけの凹みを期間から外している。",
    "",
    "### 深い開始月",
    "",
    "最深元本割れが深い順の 8 開始月。エントリー銘柄は、その開始に使った PIT 日のウェイト降順。",
    "",
    "| 開始月 | 開始日 | エントリー PIT | 次の四半期リバランス | 最深元本割れ | 谷の日 | 水中取引日 | 水中月 | 材料割れ | 古典 MaxDD | SPY MaxDD | 終了時の元本比 | 終了時 | エントリー 15 |",
    "|---|---|---|---|---:|---|---:|---:|---|---:|---:|---:|---|---|",
    worst.map(rowLine).join("\n"),
    "",
    "### 2021 年後半の開始",
    "",
    "遅い 2021 年に始めると、エントリーの直後に 2022 年の下落が来る。",
    "",
    "| 開始月 | 開始日 | エントリー PIT | 次の四半期リバランス | 最深元本割れ | 谷の日 | 水中取引日 | 水中月 | 材料割れ | 古典 MaxDD | SPY MaxDD | 終了時の元本比 | 終了時 | エントリー 15 |",
    "|---|---|---|---|---:|---|---:|---:|---|---:|---:|---:|---|---|",
    callouts.map(rowLine).join("\n"),
    "",
    "### 固定の長い経路",
    "",
    "| 開始月 | 開始日 | エントリー PIT | 次の四半期リバランス | 最深元本割れ | 谷の日 | 水中取引日 | 水中月 | 材料割れ | 古典 MaxDD | SPY MaxDD | 終了時の元本比 | 終了時 | エントリー 15 |",
    "|---|---|---|---|---:|---|---:|---:|---|---:|---:|---:|---|---|",
    fixed.map(rowLine).join("\n"),
    "",
    "### リークがブックに出ている四半期",
    "",
    "採用 15 に入っているかどうかだけを示す。順位の中身は在庫文書の表が正。2023-04-03 の AMZN は TTM 赤字の除外であり、リークではない。",
    "",
    "| リバランス日 | 監視銘柄のうち採用 | 監視銘柄のうち不在 | 採用 15（ウェイト降順） |",
    "|---|---|---|---|",
    bookTable(rebals, books, "2021-07-01", "2022-10-03"),
    bookTable(rebals, books, "2025-10-01", "2026-10-02"),
    "",
    "## 解釈",
    "",
    "- 元本割れは入口からの下落、古典 MaxDD は経路の途中の高値からの下落である。2016-01 開始は元本割れ −7.6%（水中 56 取引日）に対し古典 MaxDD −33.8%。2021-01 開始は元本割れ −9.1%（82 取引日）に対し古典 MaxDD −34.3%。どちらも谷は深いが、入口から見ると元本の下に長くはいない。2022-01 開始では両者が −34% で揃う。2021-11 と 2021-12 は元本割れ −29.4% と −30.5% で、古典 MaxDD はおよそ −34% のままである。",
    "- 2021-11 開始は 2021-10-01 のブックを 11 月 1 日に買い、次の売買は 2022-01-03 である。最深は −29.4%、水中 353 取引日（約 16.7 ヶ月）、谷は 2023-01-05。2021-12 は −30.5% / 372 取引日。最悪は 2022-01-03 開始の −34.1% / 460 取引日（約 21.8 ヶ月）で、同じ谷の日である。いずれも 2026-10-02 には元本の上に戻っている。",
    "- 2021-07 から 2022-04 まで AMZN と GOOGL は採用 15 にいない。2021-07 のブックは NVDA もいない。2021-10 から 2022-04 のブックでは NVDA は戻っている。2021-09 開始（−26.7%）は 2021-07 のブック、2021-11 以降の悪い開始は 2021-10 または 2022-01 のブックである。この 2022 年の元本割れは、市場の下落と、その欠けたブックの両方を含んでいる。",
    "- 2025-10 以降の NVDA、2026-07 と 2026-10 の AAPL・GOOGL・NVDA は、4 兆ドル上限で算出不可のまま採用されていない。終盤の NAV もそのブックのままである。",
    "- この未修正のブックでは、130 開始月のどれも古典 MaxDD が SPY より浅くない。2022 年を谷に含む開始では戦略がおよそ −34% で、同じ窓の SPY はおよそ −24.5% である。2016-01 開始の古典 MaxDD は −33.8% で、SPY の −33.7% と並ぶ。",
    "- 在庫のリークを直すまで、ここの深さと期間は確定版の成績として使わない。スリーブの採否も、この表からは決めない。",
    "",
  ].join("\n");

  fs.writeFileSync(OUT_MD, header.endsWith("\n") ? header : `${header}\n`);
  const cacheOut = path.join(process.cwd(), "data", ".cache", "round19-principal-stress");
  fs.mkdirSync(cacheOut, { recursive: true });
  fs.writeFileSync(
    path.join(cacheOut, "summary.json"),
    JSON.stringify(
      {
        rows: rows.map(({ holdings, ...rest }) => ({ ...rest, holdings })),
        worst: worst.map((r) => r.month),
      },
      null,
      2,
    ),
  );
  console.log(`wrote ${OUT_MD}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
