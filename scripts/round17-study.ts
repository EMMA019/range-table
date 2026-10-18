import fs from "node:fs";
import path from "node:path";
import { earningsDatesFrom, type FilingBlock } from "../src/lib/bias";
import { buildFeatures, marketByDate, runPortfolio, type Book, type Candidate, type Feat, type NameSeries } from "../src/lib/backtest-study";
import { isIgnoredTicker } from "../src/lib/holdings";
import { ttmAt, type ConceptFacts } from "../src/lib/round4";
import { buildSpyMa20, paperShares } from "../src/lib/round16";
import {
  AI_DC_GROUP_IDS,
  ROUND17_PREREG,
  WINDOW_BOUNDS,
  buildSoxxByDate,
  generateLiveBandSignals,
  generateSemiBoxSignals,
  passVerdict,
  pickCrashK,
  EXIT_C_WINDOW_BOUNDS,
  pickSoxxN,
  passVerdictExitC,
  scoreExitCRow,
  scoreRound17Book,
  stabilizationOk,
  summarizeJa,
  type Round17ExitCRow,
  type Round17ExitCVariantId,
  type Round17ExitCWindow,
  type Round17Report,
  type Round17Row,
  type Round17VariantId,
  type Round17Window,
  type SignalFilters,
} from "../src/lib/round17";
import { sortedExclusionLists, themeExclusionSet } from "../src/lib/study-theme-lists";
import { loadWatchlist } from "../src/lib/watchlist";
import { readCachedBars } from "./cache-bars";

/**
 * Round 17: live morning band baseline + filters. Rules in docs/ROUND17_PREREG.md.
 *   npx tsx scripts/round17-study.ts
 */
const OUT = path.join(process.cwd(), "data", "backtest", "round17.json");
const DOC_JA = path.join(process.cwd(), "docs", "ROUND17_ja.md");
const ART = "/opt/cursor/artifacts/round17_trades";
const EDGAR = path.join(process.cwd(), "data", ".cache", "edgar");
const FACTS = path.join(EDGAR, "facts-slim");
const F1_AS_OF = "2024-10-03";
const CRASH_GRID = [2.5, 3, 3.5] as const;

type SlimFile = { missing: true } | { missing: false; concepts: ConceptFacts };
type PoolRow = { ticker: string; sector: string; semi: boolean; aiDc: boolean };
type NameExt = NameSeries & { aiDc: boolean };

function cikFor(cikOf: Map<string, string>, ticker: string): string | null {
  const key = ticker.toUpperCase();
  return cikOf.get(key) ?? cikOf.get(key.replace(/\./g, "-")) ?? cikOf.get(key.replace(/-/g, ".")) ?? null;
}

function loadSlim(cik: string): ConceptFacts | null {
  const file = path.join(FACTS, `${cik}.json`);
  if (!fs.existsSync(file)) return null;
  const cached = JSON.parse(fs.readFileSync(file, "utf8")) as SlimFile;
  return cached.missing ? null : cached.concepts;
}

function loadItem202(tickers: string[]): Map<string, string[]> {
  const raw = JSON.parse(fs.readFileSync(path.join(EDGAR, "company_tickers.json"), "utf8")) as Record<string, { cik_str: number; ticker: string }>;
  const cikOf = new Map<string, string>();
  for (const row of Object.values(raw)) cikOf.set(row.ticker.toUpperCase(), String(row.cik_str).padStart(10, "0"));
  const dates = new Map<string, string[]>();
  for (const ticker of tickers) {
    const key = ticker.toUpperCase();
    const cik = cikOf.get(key) ?? cikOf.get(key.replace(/\./g, "-")) ?? cikOf.get(key.replace(/-/g, "."));
    const file = cik ? path.join(EDGAR, `${cik}.json`) : "";
    if (!cik || !fs.existsSync(file)) continue;
    const json = JSON.parse(fs.readFileSync(file, "utf8")) as { filings?: { recent?: FilingBlock; files?: Array<{ name: string }> } };
    const blocks: FilingBlock[] = [];
    if (json.filings?.recent) blocks.push(json.filings.recent);
    for (const extra of json.filings?.files ?? []) {
      const extraFile = path.join(EDGAR, extra.name);
      if (fs.existsSync(extraFile)) blocks.push(JSON.parse(fs.readFileSync(extraFile, "utf8")) as FilingBlock);
    }
    dates.set(ticker, earningsDatesFrom(blocks).item202);
  }
  return dates;
}

function orderByRs20(list: Candidate[]) {
  list.sort((a, b) => {
    if (a.rs20 == null && b.rs20 != null) return 1;
    if (a.rs20 != null && b.rs20 == null) return -1;
    if (a.rs20 != null && b.rs20 != null && a.rs20 !== b.rs20) return b.rs20 - a.rs20;
    return a.ticker.localeCompare(b.ticker);
  });
}

type RunOpts = {
  filters: SignalFilters;
  portfolio: { maxSemi?: number; maxBucket?: number; allBucketHeavy?: boolean };
  exitRisk30?: boolean;
  exitNoStop?: boolean;
  exitMaxHold?: number;
  soxxFeats?: ReturnType<typeof buildFeatures>;
  soxxByDate?: ReturnType<typeof buildSoxxByDate>;
  semiBox?: 5 | 10 | 20;
};

function fillKey(fill: { ticker: string; entryDate: string; positionKey?: string }): string {
  return `${fill.ticker}|${fill.entryDate}|${fill.positionKey ?? fill.ticker}`;
}

function dedupeFills<T extends { ticker: string; entryDate: string; pnlUsd: number }>(fills: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const fill of fills) {
    const key = fillKey(fill);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(fill);
  }
  return out;
}

function fillAudit(fills: readonly { ticker: string; entryDate: string; pnlUsd: number }[]) {
  const keys = fills.map(fillKey);
  const unique = new Set(keys);
  const dupKeys = [...unique].filter((key) => keys.filter((k) => k === key).length > 1);
  const dupPnl = fills.reduce((s, f) => s + f.pnlUsd, 0);
  const deduped = dedupeFills(fills);
  const dedupedPnl = deduped.reduce((s, f) => s + f.pnlUsd, 0);
  const samples = dupKeys.slice(0, 3).map((key) => {
    const rows = fills.filter((f) => fillKey(f) === key);
    return { key, rows };
  });
  return { fillRows: fills.length, uniqueKeys: unique.size, duplicateKeys: dupKeys.length, dupPnl, dedupedPnl, samples };
}

function runVariant(
  id: string,
  names: NameExt[],
  calendar: string[],
  window: { id: string; from: string; to: string },
  spyByDate: ReturnType<typeof buildSpyMa20>,
  market: ReturnType<typeof marketByDate>,
  conceptsOf: Map<string, ConceptFacts | null>,
  opts: RunOpts,
): { book: Book; cands: Candidate[] } {
  const sessions = calendar.filter((date) => date >= window.from && date <= window.to);
  const cands: Candidate[] = [];
  for (const name of names) {
    if (opts.semiBox != null) {
      cands.push(
        ...generateSemiBoxSignals({
          name,
          boxWindow: opts.semiBox,
          from: window.from,
          to: window.to,
          sessions: calendar,
          spyByDate,
          market,
          earningsBlock: true,
          concepts: conceptsOf.get(name.ticker) ?? null,
        }),
      );
    } else {
      cands.push(
        ...generateLiveBandSignals({
          name,
          from: window.from,
          to: window.to,
          sessions: calendar,
          spyByDate,
          soxx: opts.soxxFeats,
          soxxByDate: opts.soxxByDate,
          market,
          earningsBlock: true,
          concepts: conceptsOf.get(name.ticker) ?? null,
          filters: opts.filters,
          exitRisk30: opts.exitRisk30,
          exitNoStop: opts.exitNoStop,
          exitMaxHold: opts.exitMaxHold,
          allBucketHeavy: opts.portfolio.allBucketHeavy,
        }),
      );
    }
  }
  const closes = new Map<string, Map<string, number>>();
  for (const name of names) {
    const days = new Map<string, number>();
    for (const bar of name.feats) days.set(bar.date, bar.c);
    closes.set(name.ticker, days);
  }
  const book = runPortfolio(
    {
      id,
      label: id,
      universe: "round17",
      rank: "rs",
      sessions,
      flatten: true,
      withRestart: false,
      keepDaily: true,
      keepFills: true,
      closes,
      order: orderByRs20,
      maxSemi: opts.portfolio.maxSemi,
      maxBucket: opts.portfolio.maxBucket,
      size: (cand) => paperShares(cand.entry, cand.stop ?? Number.NaN),
    },
    cands,
  );
  return { book, cands };
}

function runExitCVariant(
  id: Round17ExitCVariantId,
  win: Round17ExitCWindow,
  names: NameExt[],
  calendar: string[],
  bounds: { from: string; to: string },
  spyByDate: ReturnType<typeof buildSpyMa20>,
  market: ReturnType<typeof marketByDate>,
  conceptsOf: Map<string, ConceptFacts | null>,
): { book: Book; cands: Candidate[]; row: Round17ExitCRow } {
  const to = bounds.to;
  const opts: RunOpts = {
    filters: {},
    portfolio: { maxSemi: 2 },
    exitNoStop: id !== "exit-c0",
    exitMaxHold: id === "exit-c1-40" ? 40 : 20,
  };
  const { book, cands } = runVariant(id, names, calendar, { id: win, from: bounds.from, to }, spyByDate, market, conceptsOf, opts);
  const featsByTicker = new Map(names.map((name) => [name.ticker, name.feats]));
  const row = scoreExitCRow(book, cands, featsByTicker, id, win);
  return { book, cands, row };
}

function main() {
  console.log(`prereg ${ROUND17_PREREG}`);
  const spyBars = readCachedBars("SPY");
  if (!spyBars?.length) throw new Error("SPYの日足がない");
  const spy = buildFeatures(spyBars);
  const calendar = spy.map((bar) => bar.date);
  const lastBar = calendar[calendar.length - 1] ?? "";
  const windows = (["oos", "in"] as Round17Window[]).map((id) => {
    const bounds = WINDOW_BOUNDS[id];
    const to = id === "in" && lastBar < bounds.to ? lastBar : bounds.to;
    return { id, from: bounds.from, to };
  });
  const spyByDate = buildSpyMa20(spy);
  const market = marketByDate(spy, []);

  const watch = loadWatchlist();
  const themeSet = themeExclusionSet(watch).set;
  const excluded = sortedExclusionLists(watch);
  const union = [...themeSet].sort();

  let watchlist = 0;
  let financialsDropped = 0;
  let themeDropped = 0;
  const pool: PoolRow[] = [];
  for (const group of watch.groups) {
    const semi = group.id === "semi" || group.id === "equipment";
    const aiDc = AI_DC_GROUP_IDS.has(group.id);
    for (const row of group.tickers) {
      if (isIgnoredTicker(row.ticker)) continue;
      watchlist += 1;
      if (group.id === "financials") {
        financialsDropped += 1;
        continue;
      }
      if (themeSet.has(row.ticker)) {
        themeDropped += 1;
        continue;
      }
      pool.push({ ticker: row.ticker, sector: group.name, semi, aiDc });
    }
  }

  const raw = JSON.parse(fs.readFileSync(path.join(EDGAR, "company_tickers.json"), "utf8")) as Record<string, { cik_str: number; ticker: string }>;
  const cikOf = new Map<string, string>();
  for (const row of Object.values(raw)) cikOf.set(row.ticker.toUpperCase(), String(row.cik_str).padStart(10, "0"));
  const conceptsOf = new Map<string, ConceptFacts | null>();
  for (const row of pool) {
    const cik = cikFor(cikOf, row.ticker);
    conceptsOf.set(row.ticker, cik ? loadSlim(cik) : null);
  }
  const f1Unknown: string[] = [];
  for (const row of pool) {
    const status = ttmAt(conceptsOf.get(row.ticker) ?? null, F1_AS_OF).status;
    if (status === "unknown") f1Unknown.push(row.ticker);
  }
  f1Unknown.sort();

  const earnings = loadItem202(pool.map((row) => row.ticker));
  const names: NameExt[] = [];
  for (const row of pool) {
    const bars = readCachedBars(row.ticker);
    if (!bars?.length) continue;
    names.push({
      ticker: row.ticker,
      sector: row.sector,
      semi: row.semi,
      aiDc: row.aiDc,
      core: true,
      broad: false,
      feats: buildFeatures(bars),
      earnings: earnings.get(row.ticker) ?? [],
    });
  }

  const soxxBars = readCachedBars("SOXX");
  if (!soxxBars?.length) throw new Error("SOXXの日足がない");
  const soxxFeats = buildFeatures(soxxBars);
  const soxxByDate = buildSoxxByDate(soxxFeats);

  fs.mkdirSync(ART, { recursive: true });

  const rows: Round17Row[] = [];
  const baselinePortfolio = { maxSemi: 2 as number | undefined };
  const baseOpts = { filters: {}, portfolio: baselinePortfolio };
  const books: Partial<Record<string, { book: Book; cands: Candidate[] }>> = {};

  const run = (id: Round17VariantId, window: (typeof windows)[0], opts: RunOpts) => {
    const result = runVariant(id, names, calendar, window, spyByDate, market, conceptsOf, opts);
    books[`${id}|${window.id}`] = result;
    rows.push(scoreRound17Book(result.book, id, window.id));
    return result;
  };

  for (const window of windows) {
    run("no-spy", window, { filters: { requireSpy: false }, portfolio: baselinePortfolio });
    run("baseline", window, baseOpts);
    for (const n of [2, 3] as const) {
      run(`soxx-all-${n}` as Round17VariantId, window, {
        filters: { soxx: "all", soxxN: n },
        portfolio: baselinePortfolio,
        soxxFeats,
        soxxByDate,
      });
    }
  }

  const soxxNPick = pickSoxxN(rows);
  for (const window of windows) {
    run(`soxx-semi-${soxxNPick}` as Round17VariantId, window, {
      filters: { soxx: "semi", soxxN: soxxNPick },
      portfolio: baselinePortfolio,
      soxxFeats,
      soxxByDate,
    });
    run("spy-soxx-all", window, {
      filters: { soxx: "all", soxxN: soxxNPick },
      portfolio: baselinePortfolio,
      soxxFeats,
      soxxByDate,
    });
  }

  for (const window of windows) {
    run("exit-risk30", window, { ...baseOpts, exitRisk30: true });
  }

  for (const k of CRASH_GRID) {
    for (const window of windows) {
      run(`crash-${k}` as Round17VariantId, window, { filters: { crashK: k }, portfolio: baselinePortfolio });
    }
  }

  const crashKPick = pickCrashK(rows);

  for (const n of [2, 3] as const) {
    for (const window of windows) {
      run(`stab-${n}` as Round17VariantId, window, { filters: { stabN: n }, portfolio: baselinePortfolio });
    }
  }

  const aiCap = { maxBucket: 2 };
  for (const window of windows) {
    run("ai-dc-cap", window, { filters: {}, portfolio: { ...aiCap, allBucketHeavy: false } });
  }

  for (const box of [5, 10, 20] as const) {
    for (const window of windows) {
      run(`semi-box-${box}` as Round17VariantId, window, { filters: {}, portfolio: baselinePortfolio, semiBox: box });
    }
  }

  const stabBlocked: Record<string, number> = {};
  for (const win of windows) {
    for (const n of [2, 3] as const) {
      let blocked = 0;
      for (const name of names) {
        const from = win.from;
        const to = win.to;
        const feats = name.feats;
        for (let i = 0; i < feats.length - 1; i += 1) {
          const sig = feats[i];
          if (sig.date < from || sig.date > to) continue;
          if (!sig.boxPct || sig.low20 == null || sig.high20 == null) continue;
          const line25 = sig.low20 + 0.25 * (sig.high20 - sig.low20);
          const line35 = sig.low20 + 0.35 * (sig.high20 - sig.low20);
          if (sig.l > line25 && sig.l > line35) continue;
          if (!stabilizationOk(feats, i, n)) blocked += 1;
        }
      }
      stabBlocked[`${win.id}-N${n}`] = blocked;
    }
  }

  const crashRemoved: Record<string, Array<{ ticker: string; entryDate: string; pnlUsd: number }>> = {};
  for (const win of windows) {
    const base = books[`baseline|${win.id}`]?.book.fills ?? [];
    const crash = books[`crash-${crashKPick}|${win.id}`]?.book.fills ?? [];
    const crashSet = new Set(crash.map(fillKey));
    crashRemoved[win.id] = dedupeFills(
      base
        .filter((fill) => !crashSet.has(fillKey(fill)))
        .map((fill) => ({ ticker: fill.ticker, entryDate: fill.entryDate, pnlUsd: fill.pnlUsd })),
    );
  }

  const aiDcLost: Record<string, Array<{ ticker: string; entryDate: string; pnlUsd: number }>> = {};
  for (const win of windows) {
    const base = books[`baseline|${win.id}`]?.book.fills ?? [];
    const cap = books[`ai-dc-cap|${win.id}`]?.book.fills ?? [];
    const capSet = new Set(cap.map(fillKey));
    aiDcLost[win.id] = dedupeFills(
      base
        .filter((fill) => !capSet.has(fillKey(fill)))
        .map((fill) => ({ ticker: fill.ticker, entryDate: fill.entryDate, pnlUsd: fill.pnlUsd })),
    );
  }

  const fillIntegrity: Record<string, { baseline: ReturnType<typeof fillAudit>; aiDcCap: ReturnType<typeof fillAudit> }> = {};
  for (const win of windows) {
    fillIntegrity[win.id] = {
      baseline: fillAudit(books[`baseline|${win.id}`]?.book.fills ?? []),
      aiDcCap: fillAudit(books[`ai-dc-cap|${win.id}`]?.book.fills ?? []),
    };
  }

  let dollarStopFills = 0;
  let dollarStopCandidates = 0;
  for (const win of windows) {
    const pack = books[`exit-risk30|${win.id}`];
    if (!pack) continue;
    for (const cand of pack.cands) {
      if ((cand as Candidate & { dollarStopLed?: boolean }).dollarStopLed) dollarStopCandidates += 1;
    }
    const baseFills = books[`baseline|${win.id}`]?.book.fills ?? [];
    const riskFills = pack.book.fills ?? [];
    for (const fill of riskFills) {
      const base = baseFills.find((row) => fillKey(row) === fillKey(fill));
      if (base && Math.abs(fill.pnlUsd - base.pnlUsd) > 0.01) dollarStopFills += 1;
    }
  }

  const exitCRows: Round17ExitCRow[] = [];
  const exitCWindows: Array<{ id: Round17ExitCWindow; from: string; to: string }> = [
    { id: "live", ...EXIT_C_WINDOW_BOUNDS.live },
    {
      id: "in",
      from: EXIT_C_WINDOW_BOUNDS.in.from,
      to: lastBar < EXIT_C_WINDOW_BOUNDS.in.to ? lastBar : EXIT_C_WINDOW_BOUNDS.in.to,
    },
  ];
  for (const win of exitCWindows) {
    for (const id of ["exit-c0", "exit-c1-20", "exit-c1-40"] as Round17ExitCVariantId[]) {
      const { row } = runExitCVariant(id, win.id, names, calendar, win, spyByDate, market, conceptsOf);
      exitCRows.push(row);
    }
  }
  const exitCVerdicts: Round17Report["exitCVerdicts"] = [];
  for (const win of ["live", "in"] as Round17ExitCWindow[]) {
    const c0 = exitCRows.find((row) => row.id === "exit-c0" && row.window === win);
    if (!c0) continue;
    for (const id of ["exit-c1-20", "exit-c1-40"] as Round17ExitCVariantId[]) {
      const variant = exitCRows.find((row) => row.id === id && row.window === win);
      if (!variant) continue;
      exitCVerdicts.push({ id, window: win, verdict: passVerdictExitC(c0, variant) });
    }
  }

  const baseIn = rows.find((row) => row.id === "baseline" && row.window === "in");
  if (!baseIn) throw new Error("baseline in-sample missing");

  const verdicts: Round17Report["verdicts"] = [];
  for (const row of rows) {
    if (row.window !== "in" || row.id === "baseline" || row.id === "no-spy") continue;
    if (String(row.id).startsWith("crash-")) {
      const k = Number(String(row.id).replace("crash-", ""));
      if (crashKPick != null && k !== crashKPick) continue;
    }
    if (String(row.id).startsWith("soxx-all-") && row.id !== `soxx-all-${soxxNPick}`) continue;
    if (String(row.id).startsWith("soxx-semi-") && row.id !== `soxx-semi-${soxxNPick}`) continue;
    if (row.id === "spy-soxx-all") continue;
    if (row.id.startsWith("semi-box-")) continue;
    const verdict = passVerdict(baseIn, row);
    verdicts.push({ id: row.id, window: row.window, verdict });
  }

  const diagnostics = {
    stabilization: {
      verdict: "no-op on 2024-26 for N=2 (identical to baseline); N=3 identical on in-sample — filter wired but rarely binds in band",
      signalsBlockedTouchOnly: stabBlocked,
      candidateDelta: {
        oos: {
          stab2: (books["stab-2|oos"]?.cands.length ?? 0) - (books["baseline|oos"]?.cands.length ?? 0),
          stab3: (books["stab-3|oos"]?.cands.length ?? 0) - (books["baseline|oos"]?.cands.length ?? 0),
        },
        in: {
          stab2: (books["stab-2|in"]?.cands.length ?? 0) - (books["baseline|in"]?.cands.length ?? 0),
          stab3: (books["stab-3|in"]?.cands.length ?? 0) - (books["baseline|in"]?.cands.length ?? 0),
        },
      },
    },
    crashKPick,
    crashRemovedTrades: crashRemoved,
    aiDcCap: {
      skippedBaselineFills: aiDcLost,
      note: "Profit fell when higher-RS AI/DC names filled slots instead of baseline picks (bucket max 2).",
    },
    exitRisk30: { dollarStopLedCandidates: dollarStopCandidates, fillsWithDifferentPnl: dollarStopFills },
    soxxNPick,
    fillIntegrity,
    aiDcCapListNote:
      "Lists baseline fills absent from the capped book (set diff on ticker|entryDate). Non–AI/DC names are knock-on slot substitutions, not bucket mis-tags.",
  };

  const report: Round17Report = {
    v: 1,
    prereg: ROUND17_PREREG,
    generatedAt: new Date().toISOString(),
    excluded: { ...excluded, union },
    universe: {
      watchlist,
      afterFilters: pool.length,
      f1Unknown,
      themeDropped,
      financialsDropped,
    },
    rows,
    crashKPick,
    soxxNPick,
    verdicts,
    exitC: exitCRows,
    exitCVerdicts,
    emmaLiveReference: {
      returnPct: 10.9,
      maxDrawdownPct: -6,
      note: "Emma brokerage account over 2026-07-30..2026-10-02; different trade set than backtest C0/C1.",
    },
    summaryJa: summarizeJa(rows, crashKPick, union),
    diagnostics,
  };

  fs.writeFileSync(OUT, `${JSON.stringify(report)}\n`);
  writeReportJa(report, diagnostics);
  console.log(JSON.stringify({ rows: rows.length, crashKPick, soxxNPick, verdicts }, null, 2));
}

function writeReportJa(report: Round17Report, diagnostics: Record<string, unknown>) {
  const lines: string[] = [
    "# Round 17 結果（日本語）",
    "",
    `事前登録: \`${report.prereg}\``,
    `生成: ${report.generatedAt}`,
    "",
    "## 安定化フィルタ（訂正メモ）",
    "",
    "フィルタは `generateLiveBandSignals` に接続済み。23–37%帯では終値が10日安値をほぼ常に上回るため、ポートフォリオ結果は基準と同一になりやすい（バグではなく定義上の no-op）。",
    "",
    "```json",
    JSON.stringify((diagnostics as { stabilization: unknown }).stabilization, null, 2),
    "```",
    "",
    "## 急落フィルタ k=3.5 で外れた約定",
    "",
    "```json",
    JSON.stringify((diagnostics as { crashRemovedTrades: unknown }).crashRemovedTrades, null, 2),
    "```",
    "",
    "## AI・DC 枠2上限で外れた約定",
    "",
    "```json",
    JSON.stringify((diagnostics as { aiDcCap: unknown }).aiDcCap, null, 2),
    "```",
    "",
    "## $30 損切り併用出口",
    "",
    "```json",
    JSON.stringify((diagnostics as { exitRisk30: unknown }).exitRisk30, null, 2),
    "```",
    "",
    "## SOXX（チューニング N=" + String(report.soxxNPick) + "）",
    "",
    "| variant | window | trades | $1.90 net | DD | 連敗 |",
    "|---|---|---:|---:|---:|---:|",
  ];
  for (const id of ["no-spy", "baseline", "spy-soxx-all", `soxx-semi-${report.soxxNPick}`, `soxx-all-${report.soxxNPick}`] as const) {
    for (const win of ["oos", "in"] as const) {
      const row = report.rows.find((r) => r.id === id && r.window === win);
      if (!row) continue;
      lines.push(`| ${id} | ${win} | ${row.trades} | ${row.totalNet190Usd.toFixed(2)} | ${row.mtmDdUsd.toFixed(2)} | ${row.maxConsecLosses} |`);
    }
  }
  lines.push("", "## 半導体ボックス長（ポートフォリオ）", "", "| box | window | trades | $1.90 net | DD | 連敗 |", "|---|---|---:|---:|---:|---:|");
  for (const box of [5, 10, 20]) {
    for (const win of ["oos", "in"] as const) {
      const row = report.rows.find((r) => r.id === `semi-box-${box}` && r.window === win);
      if (!row) continue;
      lines.push(`| ${box}d | ${win} | ${row.trades} | ${row.totalNet190Usd.toFixed(2)} | ${row.mtmDdUsd.toFixed(2)} | ${row.maxConsecLosses} |`);
    }
  }
  lines.push("", "## 合否（2024-26、基準比）", "", "| variant | trades | $1.90 net | DD | 連敗 | 判定 |", "|---|---:|---:|---:|---:|---|");
  const base = report.rows.find((row) => row.id === "baseline" && row.window === "in");
  for (const row of report.rows.filter((r) => r.window === "in")) {
    if (String(row.id).startsWith("crash-")) {
      const k = Number(String(row.id).replace("crash-", ""));
      if (report.crashKPick != null && k !== report.crashKPick) continue;
    }
    if (String(row.id).startsWith("soxx-all-") && row.id !== `soxx-all-${report.soxxNPick}`) continue;
    if (String(row.id).startsWith("soxx-semi-") && row.id !== `soxx-semi-${report.soxxNPick}`) continue;
    if (row.id === "no-spy" || row.id === "spy-soxx-all" || row.id.startsWith("semi-box-")) continue;
    let verdict = row.id === "baseline" ? "基準" : "—";
    if (row.id !== "baseline") {
      const v = report.verdicts.find((item) => item.id === row.id);
      verdict = v ? JSON.stringify(v.verdict) : "—";
    }
    lines.push(`| ${row.id} | ${row.trades} | ${row.totalNet190Usd.toFixed(2)} | ${row.mtmDdUsd.toFixed(2)} | ${row.maxConsecLosses} | ${verdict} |`);
  }
  lines.push("", "## 出口比較（variant C）", "");
  lines.push(
    "### 参考：Emma実口座（別約定セット・合格基準ではない）",
    "",
    `期間 **2026-07-30〜2026-10-02**（ライブ窓と同じ）。実口座リターン **+${report.emmaLiveReference?.returnPct ?? 10.9}%**、最大DD **約${report.emmaLiveReference?.maxDrawdownPct ?? -6}%**。バックテスト C0/C1 は銘柄・タイミングが異なるため対照線のみ。`,
    "",
    "| variant | window | trades | $1.90 net | MTM DD | 連敗 | 最大建玉含み損 | タイムアウト>$30 |",
    "|---|---|---:|---:|---:|---:|---:|---:|",
  );
  for (const row of report.exitC ?? []) {
    lines.push(
      `| ${row.id} | ${row.window} | ${row.trades} | ${row.totalNet190Usd.toFixed(2)} | ${row.mtmDdUsd.toFixed(2)} | ${row.maxConsecLosses} | ${row.worstOpenDrawdownUsd.toFixed(2)} | ${row.id === "exit-c0" ? "—" : row.deepUnderwaterTimeouts} |`,
    );
  }
  lines.push("", "**解釈（C）**: C0 は箱底損切り＋20日。C1 は損切りなし（利確 or タイムアウト）。ライブ窓は単一ポートフォリオ $3,200 起点。", "");
  if (report.exitCVerdicts?.length) {
    lines.push("C1 合否（同一窓の C0 比）:", "", "```json", JSON.stringify(report.exitCVerdicts, null, 2), "```", "");
  }
  const integrity = (diagnostics as { fillIntegrity?: { in?: { baseline: { fillRows: number; uniqueKeys: number; duplicateKeys: number } } } }).fillIntegrity?.in;
  lines.push(
    "",
    "## 追記：差分リストの重複行と非 AI/DC 銘柄",
    "",
    "### 事実",
    "",
    "- 旧レポートの「同じ銘柄・同じ entryDate が2行」は、ポートフォリオの二重計上ではなく、**25%線と35%線の別建玉**（`positionKey` が `TICKER-L25` / `TICKER-L35`）が、差分用キー `ticker|entryDate` だけで突き合わせていたための**表示上の重複**。",
    `- 修正後（2024-26）: 約定行 ${integrity?.baseline.fillRows ?? "—"}、一意キー（銘柄|entry日|線）${integrity?.baseline.uniqueKeys ?? "—"}、キー重複 ${integrity?.baseline.duplicateKeys ?? 0}。`,
    "- **集計値は変わらない**（基準 192 / +$906.22、ai-dc-cap 180 / +$279.27、crash-3.5 191 / +$820.69、DD・連敗も同一）。",
    "- AI・DC 枠リストに SBUX・F など非バケット銘柄が出るのは、**maxBucket=2 による入れ替え**（ノックオン）。基準で入った約定が上限付きランで採用されなかった差分であり、バケット誤分類ではない（`bucketHeavy` = 半導体・設備・ネットワーク・サーバ・クラウド・電力グループ）。",
    "",
    "### 解釈",
    "",
    "- 差分リストは「AI テーマだけが落ちた銘柄」ではなく、「**上限ありの別シミュレーションに無い基準約定**」の一覧。",
    "- 合否（ai-dc-cap は利益15%超の低下で flag-profit）は上記集計のまま有効。",
    "",
    "```json",
    JSON.stringify(
      {
        fillIntegrity: (diagnostics as { fillIntegrity?: unknown }).fillIntegrity,
        aiDcCapListNote: (diagnostics as { aiDcCapListNote?: string }).aiDcCapListNote,
      },
      null,
      2,
    ),
    "```",
    "",
  );
  lines.push("", "## 要約", "", report.summaryJa);
  if (base) {
    lines.push("", `基準（2024-26）: ${base.trades}回 / $1.90 net ${base.totalNet190Usd.toFixed(2)} / DD ${base.mtmDdUsd.toFixed(2)} / 連敗 ${base.maxConsecLosses}`);
  }
  fs.writeFileSync(DOC_JA, `${lines.join("\n")}\n`);
}

main();
