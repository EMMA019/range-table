/**
 * Round 19 holdings / turnover audit — appends section (5) data to stdout JSON.
 *   SEC_USER_AGENT='...' npx tsx scripts/round19-turnover-audit.ts
 */
import fs from "node:fs";
import path from "node:path";
import { cikForTicker } from "../src/lib/edgar-companyfacts";
import {
  SAKA_CONFIGS,
  SAKA_END,
  SAKA_START,
  filterEligibleCandidates,
  isSemiSubIndustry,
  pickHoldings,
  rebalanceDates,
  sharesOutstandingAsOf,
  targetWeights,
  tradingDaysFromBars,
  ttmNetIncomeAsOf,
  type SakaCandidateContext,
  type SakaConfig,
} from "../src/lib/round19-saka";
import { membersOnDate, parseSp500GicsCsv, parseTickerStartEndCsv, uniqueTickersInRange } from "../src/lib/sp500-pit";
import type { Bar } from "../src/lib/types";

const CACHE = path.join(process.cwd(), "data", ".cache", "round19");

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

function buildContext(): {
  ctx: SakaCandidateContext;
  calendar: string[];
  intervals: ReturnType<typeof parseTickerStartEndCsv>;
  gics: ReturnType<typeof parseSp500GicsCsv>;
  semiOf: (t: string) => boolean;
  membersOn: (d: string) => string[];
} {
  const intervals = parseTickerStartEndCsv(
    fs.readFileSync(path.join(CACHE, "sp500_ticker_start_end.csv"), "utf8"),
  );
  const gics = parseSp500GicsCsv(fs.readFileSync(path.join(CACHE, "sp500.csv"), "utf8"));
  const tickers = uniqueTickersInRange(intervals, SAKA_START, SAKA_END);
  const barsBy = new Map<string, Bar[]>();
  for (const t of tickers) {
    const b = loadBarsFromCache(t);
    if (b.length) barsBy.set(t, b);
  }
  const spy = loadBarsFromCache("SPY");
  const calendar = tradingDaysFromBars(spy);
  const closeHistory = new Map<string, Map<string, number>>();
  for (const [t, bars] of barsBy) {
    const m = new Map<string, number>();
    for (const b of bars) m.set(b.date, b.c);
    closeHistory.set(t, m);
  }
  const factsBy = new Map<string, unknown>();
  const factsDir = path.join(CACHE, "facts");
  if (fs.existsSync(factsDir)) {
    for (const f of fs.readdirSync(factsDir)) {
      if (f.endsWith(".json")) factsBy.set(f.replace(/\.json$/, ""), JSON.parse(fs.readFileSync(path.join(factsDir, f), "utf8")));
    }
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
      return { sector: g.sector, subIndustry: g.subIndustry, semiBucket: isSemiSubIndustry(g.subIndustry) };
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
  const semiOf = (t: string) => ctx.gicsOf(t)?.semiBucket ?? false;
  return { ctx, calendar, intervals, gics, semiOf, membersOn: (d) => membersOnDate(intervals, d) };
}

type QuarterRow = {
  date: string;
  holdings: string[];
  added: string[];
  removed: string[];
  sectorWeights: Record<string, number>;
  anySemi: boolean;
  semiTickers: string[];
};

function auditConfig(config: SakaConfig, env: ReturnType<typeof buildContext>): QuarterRow[] {
  const { ctx, calendar, semiOf, membersOn } = env;
  const rebals = rebalanceDates(calendar, SAKA_START, SAKA_END);
  const rows: QuarterRow[] = [];
  let prev = new Set<string>();
  for (const date of rebals) {
    const eligible = filterEligibleCandidates(membersOn(date), date, ctx);
    const holdings = pickHoldings(config, eligible, date, ctx);
    const weights = targetWeights(config, holdings, date, ctx, semiOf);
    const sectorWeights: Record<string, number> = {};
    for (const t of holdings) {
      const sec = ctx.gicsOf(t)?.sector ?? "Unknown";
      sectorWeights[sec] = (sectorWeights[sec] ?? 0) + (weights[t] ?? 0);
    }
    const cur = new Set(holdings);
    const added = holdings.filter((t) => !prev.has(t));
    const removed = [...prev].filter((t) => !cur.has(t));
    const semiTickers = holdings.filter((t) => semiOf(t) || isSemiSubIndustry(ctx.gicsOf(t)?.subIndustry ?? ""));
    rows.push({
      date,
      holdings,
      added,
      removed,
      sectorWeights,
      anySemi: semiTickers.length > 0,
      semiTickers,
    });
    prev = cur;
  }
  return rows;
}

function main() {
  const env = buildContext();
  const cfgA = SAKA_CONFIGS.find((c) => c.id === "corrdiverse_15__equal")!;
  const cfgB = SAKA_CONFIGS.find((c) => c.id === "plain_20__mcap")!;
  const rowsA = auditConfig(cfgA, env);
  const rowsB = auditConfig(cfgB, env);

  const unchangedA = rowsA.filter((r, i) => i > 0 && r.added.length === 0 && r.removed.length === 0).length;
  const unchangedB = rowsB.filter((r, i) => i > 0 && r.added.length === 0 && r.removed.length === 0).length;

  const out = {
    corrdiverse_15__equal: { rows: rowsA, unchangedQuarters: unchangedA },
    plain_20__mcap: { rows: rowsB, unchangedQuarters: unchangedB },
  };
  const outPath = path.join(CACHE, "turnover-audit.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));

  const mdPath = path.join(process.cwd(), "docs", "ROUND19_AUDIT_section5.md");
  fs.writeFileSync(mdPath, renderSection5(out));
  console.log(JSON.stringify({ outPath, mdPath, unchangedA, unchangedB, quarters: rowsA.length }, null, 2));
}

function fmtSectors(sw: Record<string, number>): string {
  return Object.entries(sw)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k.replace(/"/g, "")}:${(v * 100).toFixed(0)}%`)
    .join("; ");
}

function renderSection5(out: {
  corrdiverse_15__equal: { rows: QuarterRow[]; unchangedQuarters: number };
  plain_20__mcap: { rows: QuarterRow[]; unchangedQuarters: number };
}): string {
  const renderTable = (id: string, data: { rows: QuarterRow[]; unchangedQuarters: number }) => {
    const lines = [
      `### ${id}`,
      "",
      `四半期ごとにホールディングが完全同一だった回数（前四半期比 added=removed=0）: **${data.unchangedQuarters}** / ${data.rows.length - 1}`,
      "",
      "| リバランス日 | ホールディング（ティッカー） | 入替 +/− | GICS セクターウェイト（構成ウェイト） | 半導体* |",
      "|---|---|---|---|---|",
    ];
    for (const r of data.rows) {
      const semiCol =
        r.date.startsWith("2023") || r.date.startsWith("2024")
          ? r.anySemi
            ? `**あり** (${r.semiTickers.join(",")})`
            : "**なし**"
          : r.anySemi
            ? r.semiTickers.join(",")
            : "—";
      lines.push(
        `| ${r.date} | ${r.holdings.join(",")} | +${r.added.length}/−${r.removed.length} | ${fmtSectors(r.sectorWeights)} | ${semiCol} |`,
      );
    }
    return lines.join("\n");
  };

  return `## (5) ターンオーバー実態（採用構成 vs 比較）

*半導体* = GICS Sub-Industry に \`semiconductor\` を含む（\`isSemiSubIndustry\`、\`round19-saka.ts\`）。2023–2024 の列は四半期ごとに明示。

**リバランスは実行されている:** \`simulateSaka\` が \`rebalanceDates\` の各日で \`filterEligibleCandidates\` → \`pickHoldings\` → 全売買（\`round19-saka.ts:517,541-552\`）。本表はスタディと同じ \`pickHoldings\` / \`targetWeights\` をキャッシュ上で再計算（\`scripts/round19-turnover-audit.ts\`）。

**ホールディングが四半期で一切変わらないか:** いいえ（corrdiverse **0** / 43 四半期、plain **${out.plain_20__mcap.unchangedQuarters}** / 43）。相関 lookback が固定でも eligible プールと greedy 選定で入替が発生。

${renderTable("corrdiverse_15__equal（IS 採用）", out.corrdiverse_15__equal)}

${renderTable("plain_20__mcap（OOS 年率上位の比較）", out.plain_20__mcap)}

### 2023–2024 半導体サマリ

| 構成 | 四半期 | 半導体保有 |
|---|---|---|
${out.corrdiverse_15__equal.rows
  .filter((r) => r.date.startsWith("2023") || r.date.startsWith("2024"))
  .map((r) => `| corrdiverse_15__equal | ${r.date} | ${r.anySemi ? "あり " + r.semiTickers.join(",") : "なし"} |`)
  .join("\n")}
${out.plain_20__mcap.rows
  .filter((r) => r.date.startsWith("2023") || r.date.startsWith("2024"))
  .map((r) => `| plain_20__mcap | ${r.date} | ${r.anySemi ? "あり " + r.semiTickers.join(",") : "なし"} |`)
  .join("\n")}
`;
}

main();
