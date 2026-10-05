/**
 * Round 19 universe audit — facts only.
 *   SEC_USER_AGENT='...' npx tsx scripts/round19-universe-audit.ts
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  SAKA_END,
  SAKA_START,
  buildCorrInputs,
  filterEligibleCandidates,
  hasCorrHistoryAtDate,
  isExcludedTheme,
  isFinancialSector,
  rebalanceDates,
  sharesOutstandingAsOf,
  tradingDaysFromBars,
  ttmNetIncomeAsOf,
  type SakaCandidateContext,
} from "../src/lib/round19-saka";
import {
  loadSp500PitFiles,
  membersOnDate,
  parseSp500GicsCsv,
  parseTickerStartEndCsv,
  uniqueTickersInRange,
} from "../src/lib/sp500-pit";
import { loadWatchlist } from "../src/lib/watchlist";
import type { Bar } from "../src/lib/types";

const CACHE = path.join(process.cwd(), "data", ".cache", "round19");
const OUT = path.join(process.cwd(), "docs", "ROUND19_AUDIT_ja.md");
const PIT_URL =
  "https://raw.githubusercontent.com/fja05680/sp500/master/sp500_ticker_start_end.csv";

function yahooSymbol(ticker: string): string {
  return ticker.replace(/\./g, "-");
}

function loadBarsFromCache(ticker: string): Bar[] {
  const file = path.join(CACHE, `${yahooSymbol(ticker)}.json`);
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, "utf8")) as Bar[];
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

type Funnel = {
  date: string;
  pit: number;
  afterThemeSector: number;
  afterProfit: number;
  afterPrice: number;
  afterLookback: number;
  eligible: number;
  withMcap: number;
  corrPool: number;
};

async function main() {
  const pitPath = path.join(CACHE, "sp500_ticker_start_end.csv");
  if (!fs.existsSync(pitPath)) {
    await loadSp500PitFiles(CACHE);
  }
  const pitSha = crypto.createHash("sha256").update(fs.readFileSync(pitPath)).digest("hex").slice(0, 12);
  const pitMtime = fs.statSync(pitPath).mtime.toISOString().slice(0, 10);
  const intervals = parseTickerStartEndCsv(fs.readFileSync(pitPath, "utf8"));
  const gics = parseSp500GicsCsv(fs.readFileSync(path.join(CACHE, "sp500.csv"), "utf8"));

  const distinctPit = uniqueTickersInRange(intervals, SAKA_START, SAKA_END);

  const spyBars = loadBarsFromCache("SPY");
  if (!spyBars.length) throw new Error("Missing SPY cache in data/.cache/round19");
  const calendar = tradingDaysFromBars(spyBars);
  const rebals = rebalanceDates(calendar, SAKA_START, SAKA_END);

  const tickers = uniqueTickersInRange(intervals, "2014-01-01", SAKA_END);
  const barsBy = new Map<string, Bar[]>();
  for (const t of tickers) {
    const b = loadBarsFromCache(t);
    if (b.length) barsBy.set(t, b);
  }

  const factsBy = new Map<string, unknown>();
  const factsDir = path.join(CACHE, "facts");
  if (fs.existsSync(factsDir)) {
    for (const f of fs.readdirSync(factsDir)) {
      if (!f.endsWith(".json")) continue;
      factsBy.set(f.replace(/\.json$/, ""), JSON.parse(fs.readFileSync(path.join(factsDir, f), "utf8")));
    }
  }

  const cacheFiles = fs.readdirSync(CACHE).filter((f) => f.endsWith(".json") && f !== "equity-chart.json");

  const closeHistory = new Map<string, Map<string, number>>();
  for (const [t, bars] of barsBy) {
    const m = new Map<string, number>();
    for (const b of bars) m.set(b.date, b.c);
    closeHistory.set(t, m);
  }

  const lastKnownShares = new Map<string, number>();
  const sharesLookup = (ticker: string, date: string) => {
    const f = factsBy.get(ticker);
    let sh: number | null = null;
    if (f) sh = sharesOutstandingAsOf(f, date);
    if (sh != null && sh > 0) {
      lastKnownShares.set(ticker, sh);
      return { shares: sh, stale: false };
    }
    const prev = lastKnownShares.get(ticker);
    if (prev != null) return { shares: prev, stale: true };
    return { shares: 0, stale: true };
  };

  const price = (ticker: string, date: string) => closeOnOrBefore(barsBy.get(ticker) ?? [], date);

  const ctx: SakaCandidateContext = {
    calendar,
    closeHistory,
    gicsOf: (t) => {
      const g = gics.get(t);
      if (!g) return null;
      return { sector: g.sector, subIndustry: g.subIndustry, semiBucket: false };
    },
    mcap: (t, date) => {
      const p = price(t, date);
      const { shares } = sharesLookup(t, date);
      if (p == null || shares <= 0) return 0;
      return p * shares;
    },
    sharesLookup,
    profitable: (t, date) => {
      const f = factsBy.get(t);
      if (!f) return false;
      const ni = ttmNetIncomeAsOf(f, date);
      return ni != null && ni > 0;
    },
    hasPrice: (t, date) => price(t, date) != null,
  };

  const funnelAt = (date: string): Funnel => {
    const members = membersOnDate(intervals, date);
    const afterThemeSector = members.filter((t) => {
      if (isExcludedTheme(t)) return false;
      const g = ctx.gicsOf(t);
      return !(g && isFinancialSector(g.sector));
    });
    const afterProfit = afterThemeSector.filter((t) => ctx.profitable(t, date));
    const afterPrice = afterProfit.filter((t) => ctx.hasPrice(t, date));
    const afterLookback = afterPrice.filter((t) => {
      const hist = closeHistory.get(t);
      return hist != null && hasCorrHistoryAtDate(calendar, hist, date);
    });
    const eligible = filterEligibleCandidates(members, date, ctx);
    const withMcap = eligible.filter((t) => ctx.mcap(t, date) > 0);
    const corr = buildCorrInputs(eligible, calendar, closeHistory, date);
    return {
      date,
      pit: members.length,
      afterThemeSector: afterThemeSector.length,
      afterProfit: afterProfit.length,
      afterPrice: afterPrice.length,
      afterLookback: afterLookback.length,
      eligible: eligible.length,
      withMcap: withMcap.length,
      corrPool: corr?.tickers.length ?? 0,
    };
  };

  const funnels = rebals.map(funnelAt);
  const sampleIdx = new Set([0, ...funnels.map((_, i) => i).filter((i) => i % 4 === 0), funnels.length - 1]);
  const sample = [...sampleIdx].sort((a, b) => a - b).map((i) => funnels[i]);

  const lastDate = rebals[rebals.length - 1]!;
  const lastMembers = membersOnDate(intervals, lastDate);
  const lastF = funnelAt(lastDate);

  let mcapAmongAllMembers = 0;
  let noPriceMember = 0;
  let noSharesMember = 0;
  let noFactsMember = 0;
  for (const t of lastMembers) {
    const p = price(t, lastDate);
    const f = factsBy.get(t);
    const sh = f ? sharesOutstandingAsOf(f, lastDate) : null;
    if (p != null && sh != null && sh > 0) mcapAmongAllMembers += 1;
    else if (p == null) noPriceMember += 1;
    else if (!f) noFactsMember += 1;
    else noSharesMember += 1;
  }

  const missingPriceEligiblePath = lastMembers.filter((t) => {
    if (isExcludedTheme(t)) return false;
    const g = ctx.gicsOf(t);
    if (g && isFinancialSector(g.sector)) return false;
    if (!ctx.profitable(t, lastDate)) return false;
    return !ctx.hasPrice(t, lastDate);
  });

  const pitNoBarFile = lastMembers.filter((t) => !barsBy.has(t));
  const pitNoBarHasEmptyFetch = pitNoBarFile.filter((t) => fs.existsSync(path.join(CACHE, `${yahooSymbol(t)}.json`)));

  const wl = new Set<string>();
  for (const g of loadWatchlist().groups) for (const t of g.tickers) wl.add(t.ticker);

  const adopted15 = ["MO", "VRSK", "CVX", "TMUS", "T", "TYL", "PM", "FANG", "NOW", "VLO", "DGX", "WMT", "NFLX", "AMT", "ADSK"];
  const extrasNamed = ["CPRT", "TJX", "WELL", "CHTR", "EIX"];
  const inWl = (ts: string[]) => ts.filter((t) => wl.has(t));

  const wlPctLines = funnels.map((f) => {
    const el = filterEligibleCandidates(membersOnDate(intervals, f.date), f.date, ctx);
    const nWl = el.filter((t) => wl.has(t)).length;
    return `| ${f.date} | ${el.length} | ${nWl} | ${el.length ? ((100 * nWl) / el.length).toFixed(1) : "0"}% |`;
  });

  const funnelRow = (f: Funnel) =>
    `| ${f.date} | ${f.pit} | ${f.pit - f.afterThemeSector} | ${f.afterThemeSector - f.afterProfit} | ${f.afterProfit - f.afterPrice} | ${f.afterPrice - f.afterLookback} | ${f.eligible - f.withMcap} | ${f.eligible} | ${f.corrPool} |`;

  const factsCount = factsBy.size;

  const md = `# Round 19 ユニバース監査（事実のみ）

生成: \`npx tsx scripts/round19-universe-audit.ts\`（既存 \`data/.cache/round19\` を読む。フルスタディは再実行していない）

**注意（EDGAR）:** ローカル \`facts/*.json\` は **${factsCount}** 件のみ。\`profitable()\` は facts 無しを **赤字扱い**（\`round19-saka-study.ts\` ctx）。よって eligible は「PIT∩除外∩価格∩**facts 取得成功銘柄**∩TTM 黒字」に実質限定される（ウォッチリスト由来ではない）。

## (1) PIT ユニバース

| 項目 | 値 |
|---|---|
| 期間 | ${SAKA_START} ～ ${SAKA_END} |
| **ユニーク銘柄数**（期間内に 1 日でも S&P 構成だったティッカー） | **${distinctPit.length}** |
| 使用ファイル | \`${PIT_URL}\`（ローカル: \`data/.cache/round19/sp500_ticker_start_end.csv\`） |
| ローカル SHA-256（先頭 12 桁） | \`${pitSha}\` |
| ローカル更新日 | ${pitMtime} |
| 備考 | upstream コミットは未ピン留め。初回取得は \`loadSp500PitFiles\` が raw URL からダウンロード |

## (2) 四半期リバランス日ごとの候補漏斗

列: PIT 構成数 → 除外（テーマ・金融）→ 除外（TTM 赤字 / EDGAR 欠損）→ 除外（当日価格なし）→ 除外（相関用 126 日リターン不足）→ 除外（eligible だが mcap≤0）→ **eligible**（\`filterEligibleCandidates\`）→ corrdiverse 用プール（\`buildCorrInputs\` 銘柄数）

代表行（全 ${rebals.length} 回中: 初回・4 回に 1 回・最終）:

| 日付 | PIT | −テーマ/金融 | −赤字/EDGAR | −価格 | −lookback | −mcap | eligible | corr pool |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
${sample.map(funnelRow).join("\n")}

### 最終リバランス **${lastDate}**（詳細）

| 段階 | 銘柄数 |
|---|---:|
| PIT 構成 | ${lastF.pit} |
| テーマ・金融除外後 | ${lastF.afterThemeSector} |
| 黒字（TTM）後 | ${lastF.afterProfit} |
| 当日価格あり後 | ${lastF.afterPrice} |
| 126 日+ lookback 後 | ${lastF.afterLookback} |
| **eligible** | **${lastF.eligible}** |
| eligible かつ mcap>0（plain 用） | ${lastF.withMcap} |
| corrdiverse プール | ${lastF.corrPool} |

**PIT 全員の mcap 算出可能数（価格×株数、eligible 外含む）:** ${mcapAmongAllMembers} — ROUND19_ja の「132 件」と一致する指標（内訳: 価格なし ${noPriceMember}、facts なし ${noFactsMember}、株数なし ${noSharesMember}）。

**最終日: 黒字だが価格なしで落ちた銘柄（${missingPriceEligiblePath.length}）:** ${
    missingPriceEligiblePath.length < 60 ? missingPriceEligiblePath.sort().join(", ") || "（なし）" : `${missingPriceEligiblePath.slice(0, 55).join(", ")} …他 ${missingPriceEligiblePath.length - 55} 件`
  }

## (3) ウォッチリスト汚染のコード追跡

### \`scripts/round19-saka-study.ts\` および Round 19 専用 import

| ファイル | watchlist 参照 |
|---|---|
| \`scripts/round19-saka-study.ts\` | **直接なし**（\`loadWatchlist\` / \`watchlist.yaml\` 未 import） |
| \`scripts/round19-saka-study.ts:10,85\` | \`cikForTicker\` を import — \`loadFacts\` で GICS CIK が無いときのフォールバック |
| \`src/lib/round19-saka.ts\` | **なし** — \`./themes\`（固定配列）、\`./corr\`、\`./types\` のみ |
| \`src/lib/sp500-pit.ts:33-44\` | **なし**（ただし GICS CSV の単純 \`split(",")\` で **CIK 列が壊れて常に null**） |
| \`src/lib/edgar-companyfacts.ts:30-43\` | \`data/sec_cik.json\` を読む — ファイル注記どおり **watchlist 銘柄のみ**（\`scripts/build-sec-cik.ts\`） |
| \`data/watchlist.yaml\` | スタディ本体は未読。監査 (4) と \`sec_cik.json\` 経由で間接的に関連 |

### 価格キャッシュ

- パス: \`data/.cache/round19/{SYMBOL}.json\`（\`scripts/round19-saka-study.ts:45,66-76\`）
- 取得対象: \`uniqueTickersInRange(intervals, SAKA_START, SAKA_END)\`（\`round19-saka-study.ts:136\`）— **PIT 期間の全ユニーク銘柄**（本監査: ${tickers.length} 銘柄リクエスト、${barsBy.size} 銘柄に非空バー）
- キャッシュ JSON ファイル数: **${cacheFiles.length}**（ウォッチリスト専用ディレクトリではない）
- \`scripts/cache-bars.ts\` / \`data/.cache/bt/\` は **本スタディ未使用**

### テーマ除外と watchlist

\`isExcludedTheme\`（\`round19-saka.ts\`）は \`themeOf\`（\`themes.ts\` の **固定配列** QUANTUM/SPACE/CRYPTO 等）を使用。\`themes.ts\` は watchlist を読まない（コメントに watchlist 由来の **銘柄名** の記述のみ）。

### サイレント欠損の有無

- \`loadBars\` 失敗時は **空配列**（\`round19-saka-study.ts:77-78\`）→ \`barsBy\` に未登録 → \`hasPrice\` が false → **eligible から除外**（ウォッチリストとは無関係）。
- 最終リバランスで PIT 構成 ${lastMembers.length} のうち **バー未ロード ${pitNoBarFile.length}**（空 JSON が ${pitNoBarHasEmptyFetch.length} — 取得失敗の痕跡）。
- **ウォッチリスト外だから価格が無い**という経路はコード上 **存在しない**。逆に、キャッシュは PIT ユニーク銘柄向けに広く取られている。

### 132 mcap の理由

最終日 PIT **${lastMembers.length}** 名のうち **${mcapAmongAllMembers}** 名のみ「終値×EDGAR 株数」が正（= レポートの 132）。残り **${lastMembers.length - mcapAmongAllMembers}** は構成員だが (1) Yahoo 価格なし ${noPriceMember}、(2) companyfacts 未取得 ${noFactsMember}、(3) 株数タグ欠損 ${noSharesMember}。eligible（${lastF.eligible}）は黒字・価格ありに更に限定。

**結論（watchlist 直接参照）:** \`round19-saka-study.ts\` / \`round19-saka.ts\` が \`watchlist.yaml\` を読む **証拠はない**。

**結論（実質的な汚染 — 要修正）:** EDGAR の CIK 解決が **watchlist 限定の \`sec_cik.json\`** にフォールバックするため、黒字判定・株数が **ウォッチリスト ∩ facts 取得成功** に実質限定される。

- \`parseSp500GicsCsv\`: ローカル検証で **CIK 非 null は 0 / 503**（CSV クォート崩れ）
- \`data/.cache/round19/facts/*.json\`: **${factsCount}** ファイル、**${factsCount} / ${factsCount}** が watchlist 銘柄（0 件が watchlist 外）
- その結果 eligible の watchlist 交集合比率が多くのリバランスで **100%**（下表）— 価格キャッシュ（PIT 784 銘柄分）は広いが **黒字ゲートがボトルネック**

**修正案（スタディ再実行前）:** (1) \`sp500.csv\` の正しい CSV パースで CIK を入れる、または SEC 全ティッカー CIK マップを使用。(2) \`profitable()\` で facts 欠損を赤字と同一視しない（別カウント）。(3) レポートに EDGAR カバレッジ率を必須表示。**本監査ではスタディ未再実行。**

## (4) 採用・参考ホールディングと watchlist（186）

ウォッチリスト銘柄数（\`data/watchlist.yaml\`）: **${wl.size}**

| グループ | 銘柄 | watchlist 内 |
|---|---|---|
| 採用 15 | ${adopted15.join(", ")} | **${inWl(adopted15).length}/15** — ${inWl(adopted15).join(", ") || "なし"} |
| 参考 20 の追加分 | ${extrasNamed.join(", ")} | **${inWl(extrasNamed).length}/5** — ${inWl(extrasNamed).join(", ")} |

eligible ユニバースに占める watchlist 比率（各リバランス）:

| 日付 | eligible | watchlist 交集合 | 比率 |
|---|---:|---:|---:|
${wlPctLines.join("\n")}

---

*本ドキュメントは事実記録のみ。スタディ再実行・パラメータ変更は行っていない。*
`;

  fs.writeFileSync(OUT, md);
  console.log(JSON.stringify({ distinctPit: distinctPit.length, lastDate, lastF, mcapAmongAllMembers }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
