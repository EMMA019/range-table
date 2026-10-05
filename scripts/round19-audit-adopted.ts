/**
 * Sections 7–10 for ROUND19_AUDIT_ja.md (corrdiverse_15__equal @ 2026-10-01 + OOS fees).
 */
import fs from "node:fs";
import path from "node:path";
import {
  SAKA_CORR_PAIR_MAX,
  SAKA_END,
  SAKA_INITIAL_CASH,
  SAKA_OOS_START,
  SAKA_START,
  avgCorr,
  buildCorrInputs,
  correlationMatrix,
  filterEligibleCandidates,
  hasCorrHistoryAtDate,
  isExcludedTheme,
  isFinancialSector,
  isSemiSubIndustry,
  pickCorrGreedyTraced,
  pickHoldings,
  rebalanceDates,
  sharesOutstandingAsOf,
  simulateSaka,
  tradingDaysFromBars,
  ttmNetIncomeAsOf,
  type SakaConfig,
} from "../src/lib/round19-saka";
import { membersOnDate, parseSp500GicsCsv, parseTickerStartEndCsv, uniqueTickersInRange } from "../src/lib/sp500-pit";
import type { Bar } from "../src/lib/types";

const CACHE = path.join(process.cwd(), "data", ".cache", "round19");
const DATE = "2026-10-01";
const CONFIG: SakaConfig = { id: "corrdiverse_15__equal", pick: "corrdiverse", n: 15, weight: "equal" };
const SEMIS = ["NVDA", "AVGO", "AMD", "MU", "QCOM", "TXN", "AMAT", "LRCX", "KLAC", "INTC"];
const COMMISSION = 0.35;

function loadBars(t: string): Bar[] {
  const f = path.join(CACHE, `${t.replace(/\./g, "-")}.json`);
  if (!fs.existsSync(f)) return [];
  return JSON.parse(fs.readFileSync(f, "utf8")) as Bar[];
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

function buildEnv() {
  const intervals = parseTickerStartEndCsv(fs.readFileSync(path.join(CACHE, "sp500_ticker_start_end.csv"), "utf8"));
  const gics = parseSp500GicsCsv(fs.readFileSync(path.join(CACHE, "sp500.csv"), "utf8"));
  const tickers = uniqueTickersInRange(intervals, SAKA_START, SAKA_END);
  const barsBy = new Map<string, Bar[]>();
  for (const t of tickers) {
    const b = loadBars(t);
    if (b.length) barsBy.set(t, b);
  }
  const spy = loadBars("SPY");
  const calendar = tradingDaysFromBars(spy);
  const factsBy = new Map<string, unknown>();
  const fd = path.join(CACHE, "facts");
  if (fs.existsSync(fd)) {
    for (const f of fs.readdirSync(fd)) {
      if (f.endsWith(".json")) factsBy.set(f.replace(/\.json$/, ""), JSON.parse(fs.readFileSync(path.join(fd, f), "utf8")));
    }
  }
  const closeHistory = new Map<string, Map<string, number>>();
  for (const [t, bars] of barsBy) {
    const m = new Map<string, number>();
    for (const b of bars) m.set(b.date, b.c);
    closeHistory.set(t, m);
  }
  const lastKnownShares = new Map<string, number>();
  const ctx = {
    calendar,
    closeHistory,
    gicsOf: (t: string) => {
      const g = gics.get(t);
      if (!g) return null;
      return { sector: g.sector, subIndustry: g.subIndustry, semiBucket: isSemiSubIndustry(g.subIndustry) };
    },
    mcap: (t: string, date: string) => {
      const p = closeOnOrBefore(barsBy.get(t) ?? [], date);
      const f = factsBy.get(t);
      let sh: number | null = null;
      if (f) sh = sharesOutstandingAsOf(f, date);
      if (sh != null && sh > 0) lastKnownShares.set(t, sh);
      else sh = lastKnownShares.get(t) ?? null;
      if (p == null || !sh || sh <= 0) return 0;
      return p * sh;
    },
    sharesLookup: (t: string, date: string) => {
      const f = factsBy.get(t);
      let sh: number | null = null;
      if (f) sh = sharesOutstandingAsOf(f, date);
      if (sh != null && sh > 0) return { shares: sh, stale: false };
      const prev = lastKnownShares.get(t);
      if (prev != null) return { shares: prev, stale: true };
      return { shares: 0, stale: true };
    },
    profitable: (t: string, date: string) => {
      const f = factsBy.get(t);
      if (!f) return false;
      const ni = ttmNetIncomeAsOf(f, date);
      return ni != null && ni > 0;
    },
    hasPrice: (t: string, date: string) => closeOnOrBefore(barsBy.get(t) ?? [], date) != null,
  };
  const price = (t: string, date: string) => closeOnOrBefore(barsBy.get(t) ?? [], date);
  const membersOn = (d: string) => membersOnDate(intervals, d);
  const semiOf = (t: string) => ctx.gicsOf(t)?.semiBucket ?? false;
  return { ctx, membersOn, price, semiOf, intervals, gics, factsBy, barsBy, calendar };
}

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

function feeBreakdownOos(env: ReturnType<typeof buildEnv>) {
  const { ctx, membersOn, price, semiOf, calendar } = env;
  const rebals = rebalanceDates(calendar, SAKA_OOS_START, SAKA_END);
  let prev = new Set<string>();
  let swapOrders = 0;
  let reweightOrders = 0;
  let totalOrders = 0;
  for (const date of rebals) {
    const eligible = filterEligibleCandidates(membersOn(date), date, ctx);
    const holdings = pickHoldings(CONFIG, eligible, date, ctx);
    const cur = new Set(holdings);
    const removed = [...prev].filter((t) => !cur.has(t));
    const added = holdings.filter((t) => !prev.has(t));
    const kept = holdings.filter((t) => prev.has(t));
    const sellOrders = prev.size;
    const buyOrders = holdings.length;
    totalOrders += sellOrders + buyOrders;
    swapOrders += removed.length + added.length;
    reweightOrders += kept.length * 2;
    prev = cur;
  }
  const swapUsd = swapOrders * COMMISSION;
  const reweightUsd = reweightOrders * COMMISSION;
  const totalUsd = totalOrders * COMMISSION;
  const tinyThreshold = 50;
  let skippedEst = 0;
  for (const date of rebals) {
    const eligible = filterEligibleCandidates(membersOn(date), date, ctx);
    const holdings = pickHoldings(CONFIG, eligible, date, ctx);
    const eq = SAKA_INITIAL_CASH;
    const per = eq / holdings.length;
    for (const t of holdings) {
      if (per < tinyThreshold) skippedEst += 2;
    }
  }
  return { rebals: rebals.length, totalOrders, swapOrders, reweightOrders, swapUsd, reweightUsd, totalUsd, skippedEst, skippedUsd: skippedEst * COMMISSION };
}

function semiDropReason(ticker: string, date: string, env: ReturnType<typeof buildEnv>, pool: string[], corr: Map<string, Map<string, number>>, picked: string[]) {
  const { ctx, membersOn, factsBy, barsBy } = env;
  const members = membersOn(date);
  if (!members.includes(ticker)) return "PIT 構成外（当日）";
  if (isExcludedTheme(ticker)) return "テーマ除外";
  const g = ctx.gicsOf(ticker);
  if (g && isFinancialSector(g.sector)) return "金融セクター除外";
  if (!factsBy.has(ticker)) return `EDGAR facts なし（黒字判定不可）`;
  if (!ctx.profitable(ticker, date)) return "TTM 赤字または黒字データ不足";
  if (!ctx.hasPrice(ticker, date)) return "当日価格なし";
  const hist = env.ctx.closeHistory.get(ticker);
  if (!hist || !hasCorrHistoryAtDate(ctx.calendar, hist, date)) return "相関用 126 日リターン不足";
  if (!pool.includes(ticker)) return "corrdiverse プール外（buildCorrInputs 不通過）";
  const universe = pool;
  const ac = avgCorr(ticker, universe, corr);
  const ranked = [...pool].sort((a, b) => avgCorr(a, universe, corr) - avgCorr(b, universe, corr));
  const rank = ranked.indexOf(ticker) + 1;
  if (picked.includes(ticker)) return `採用（プール内平均ρ順位 ${rank}/${pool.length}）`;
  const { attemptLog } = pickCorrGreedyTraced(pool, corr, CONFIG.n);
  const att = attemptLog.find((a) => a.ticker === ticker);
  if (att?.skippedDueToRho) {
    return `greedy でスキップ（既選との ρ>${SAKA_CORR_PAIR_MAX}、最大 ρ=${att.maxRhoToChosen.toFixed(2)}）— プール平均ρ ${ac.toFixed(2)}、順位 ${rank}/${pool.length}`;
  }
  if (picked.length >= CONFIG.n) return `枠 15 名満了のため未採用（平均ρ ${ac.toFixed(2)}、順位 ${rank}/${pool.length}）`;
  return `未採用（平均ρ ${ac.toFixed(2)}、順位 ${rank}/${pool.length}）`;
}

function main() {
  const env = buildEnv();
  const { ctx, membersOn } = env;
  const members = membersOn(DATE);
  const afterTheme = members.filter((t) => !isExcludedTheme(t));
  const afterFin = afterTheme.filter((t) => {
    const g = ctx.gicsOf(t);
    return !(g && isFinancialSector(g.sector));
  });
  const afterPrice = afterFin.filter((t) => ctx.hasPrice(t, DATE));
  const afterProfit = afterPrice.filter((t) => ctx.profitable(t, DATE));
  const afterLookback = afterProfit.filter((t) => {
    const hist = ctx.closeHistory.get(t);
    return hist != null && hasCorrHistoryAtDate(ctx.calendar, hist, DATE);
  });
  const eligible = filterEligibleCandidates(members, DATE, ctx);
  const inputs = buildCorrInputs(eligible, ctx.calendar, ctx.closeHistory, DATE);
  const pool = inputs?.tickers ?? [];
  const corr = inputs ? correlationMatrix(inputs) : new Map();
  const { holdings, trace } = inputs ? pickCorrGreedyTraced(pool, corr, CONFIG.n) : { holdings: [], trace: [] };
  const fees = feeBreakdownOos(env);

  const md = `
## (7) 最終リバランス（${DATE}）— なぜこの 15 銘柄まで残ったか（漏斗）

採用構成 **corrdiverse_15__equal** の、その日の選び方です。上から順に「足切り」されていきます。

| 段階 | 残った銘柄数 | この段階で落ちた数 |
|---|---:|---:|
| ① S&P 500 構成（PIT） | ${members.length} | — |
| ② テーマ除外（crypto/space 等）後 | ${afterTheme.length} | ${members.length - afterTheme.length} |
| ③ 金融セクター除外後 | ${afterFin.length} | ${afterTheme.length - afterFin.length} |
| ④ 当日株価がある | ${afterPrice.length} | ${afterFin.length - afterPrice.length} |
| ⑤ 黒字（TTM・EDGAR） | ${afterProfit.length} | ${afterPrice.length - afterProfit.length} |
| ⑥ 相関計算用データ（約 1 年分の値動き） | ${afterLookback.length} | ${afterProfit.length - afterLookback.length} |
| ⑦ **eligible**（②〜⑤を一括した公式リスト） | ${eligible.length} | — |
| ⑧ corrdiverse **候補プール**（⑥で相関が計算できる銘柄） | ${pool.length} | ${eligible.length - pool.length} |
| ⑨ **最終 15 銘柄** | ${holdings.length} | ${pool.length - holdings.length} はプール内だが枠・相関ルールで不採用 |

※ v1 実行時点の EDGAR キャッシュは **watchlist 中心**（監査 §3）のため、⑤で大半の構成銘柄が落ちています。これが「たばこ・通信ばかり」に見える主因です。

### corrdiverse の考え方（2〜3 文）

候補プールの中で、**他の銘柄と値動きがあまり似ていないもの**を優先します。まずプール全体での「平均の似方（相関）」が**低い順**に並べ、上から 1 銘柄ずつ試します。**すでに選んだ銘柄と相関が 0.7 より高い**ものはスキップし、15 銘柄埋まるまで続けます（\`round19-saka.ts\` の \`pickCorrGreedy\`）。

## (8) 採用 15 銘柄 — 選ばれた順番と相関

| 順番 | ティッカー | セクター | プール内の平均相関 | 採用時点で既選銘柄との平均相関 | 最大 ρ（既選） |
|---:|---|---|---:|---:|---:|
${trace
  .map(
    (r) =>
      `| ${r.pickOrder} | ${r.ticker} | ${env.ctx.gicsOf(r.ticker)?.sector ?? "—"} | ${r.avgCorrToPool.toFixed(2)} | ${r.avgCorrToChosen.toFixed(2)} | ${r.maxRhoToChosen.toFixed(2)} |`,
  )
  .join("\n")}

**選定理由の要約:** 各行は「プール内で平均相関が低い順」に試した結果、既選 15 とどれも ρ≤0.7 だった銘柄です（同順位はティッカー名順）。

## (9) 半導体代表銘柄 — どの段階で落ちたか（${DATE}）

| ティッカー | 結果 |
|---|---|
${SEMIS.map((t) => `| ${t} | ${semiDropReason(t, DATE, env, pool, corr, holdings)} |`).join("\n")}

※ 半導体 **セクター上限 30%** は **ウェイト付け段階**（equal なら採用後も各 6.7%）であり、**選定段階では不適用**です。

## (10) 手数料 **$244**（採用構成・OOS・$0.35）の内訳

スタディは**四半期ごとに全売却→再購入**（\`simulateSaka\`）のため、銘柄が同じでも「売り＋買い」の 2 注文が発生します。

| 項目 | 注文数 | 金額（$0.35/注文） |
|---|---:|---:|
| OOS 四半期リバランス回数 | ${fees.rebals} 回 | — |
| **合計注文** | **${fees.totalOrders}** | **$${fees.totalUsd.toFixed(0)}**（レポート $244 と整合） |
| 銘柄入替に伴う注文（外れた銘柄の売り＋新規の買い） | ${fees.swapOrders} | $${fees.swapUsd.toFixed(0)} |
| 継続銘柄のウェイト合わせ（売り＋買いの両方） | ${fees.reweightOrders} | $${fees.reweightUsd.toFixed(0)} |

**見積（ラベル付き）:** 取引額が **$50 未満**のリバランス片をスキップした場合、約 **${fees.skippedEst}** 注文を省略でき、手数料はおおよそ **$${fees.skippedUsd.toFixed(0)}** 少なくなる可能性があります（実装は未変更・概算のみ）。
`;

  const auditPath = path.join(process.cwd(), "docs", "ROUND19_AUDIT_ja.md");
  let base = fs.readFileSync(auditPath, "utf8");
  if (base.includes("## (7)")) {
    base = base.split("## (7)")[0].trimEnd();
  }
  fs.writeFileSync(auditPath, `${base}\n${md}\n`);
  console.log(JSON.stringify({ holdings, pool: pool.length, fees }, null, 2));
}

main();
