import fs from "fs";
import path from "path";
import {
  clipTo,
  marketByDate,
  methodCandidates,
  rangeCandidates,
  runBuyHold,
  runPortfolio,
  takeOneAtATime,
  YEAR2_FROM,
  type Candidate,
  type NameSeries,
  type PortfolioOpts,
} from "../src/lib/backtest-study";
import { FROZEN_BOX, FROZEN_GAP } from "../src/lib/paper";
import {
  checkFromBook,
  item202Dates,
  mulberry32,
  percentileBelow,
  sharesForRisk,
  shuffle,
  spansEarnings,
  splitStats,
  type Check,
  type TradePnl,
} from "../src/lib/robustness";
import { loadCore } from "./cache-bars";

/**
 * Pre-registered checks. Does not change the frozen rules.
 *   npm run robustness
 */
const OUT = path.join(process.cwd(), "data", "backtest", "robustness.json");
const DOC = path.join(process.cwd(), "docs", "BACKTEST_STUDY.md");
const EDGAR = path.join(process.cwd(), "data", ".cache", "edgar");
const UA = "range-table mimiko.neko.neko@gmail.com";
const IN_FROM = "2024-10-03";
const IN_TO = "2026-10-02";
const OOS_FROM = "2022-10-03";
const OOS_TO = "2024-10-02";
const OOS_YEAR2 = "2023-10-03";
const PUBLISHED_RS = 2052.87;

const usd = (value: number | null | undefined) => (value == null ? "—" : `$${value.toFixed(2)}`);

function orderBy(field: "rs10" | "rs20" | "rs40" | "rs60") {
  return (list: Candidate[]) => {
    list.sort((a, b) => {
      const av = a[field] ?? null;
      const bv = b[field] ?? null;
      if (av == null && bv != null) return 1;
      if (av != null && bv == null) return -1;
      if (av != null && bv != null && av !== bv) return bv - av;
      return a.ticker.localeCompare(b.ticker);
    });
  };
}

function closesOf(names: NameSeries[]) {
  const map = new Map<string, Map<string, number>>();
  for (const name of names) {
    const days = new Map<string, number>();
    for (const bar of name.feats) days.set(bar.date, bar.c);
    map.set(name.ticker, days);
  }
  return map;
}

function windowNames(names: NameSeries[], to: string): NameSeries[] {
  return names.map((name) => ({ ...name, feats: clipTo(name.feats, to) }));
}

function sessionsBetween(dates: string[], from: string, to: string): string[] {
  return dates.filter((date) => date >= from && date <= to);
}

async function secJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json();
}

type FilingBlock = { form?: string[]; filingDate?: string[]; items?: string[] };

function datesIn(block: FilingBlock | undefined): string[] {
  if (!block) return [];
  return item202Dates(block.form ?? [], block.filingDate ?? [], block.items ?? []);
}

async function edgarDates(tickers: string[]): Promise<{ byTicker: Map<string, string[]>; missing: string[]; withDate: number; filings: number }> {
  fs.mkdirSync(EDGAR, { recursive: true });
  const tickerFile = path.join(EDGAR, "company_tickers.json");
  if (!fs.existsSync(tickerFile)) {
    const json = await secJson("https://www.sec.gov/files/company_tickers.json");
    fs.writeFileSync(tickerFile, JSON.stringify(json));
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  const raw = JSON.parse(fs.readFileSync(tickerFile, "utf8")) as Record<string, { cik_str: number; ticker: string }>;
  const cikOf = new Map<string, number>();
  for (const row of Object.values(raw)) cikOf.set(row.ticker.toUpperCase(), row.cik_str);

  const byTicker = new Map<string, string[]>();
  const missing: string[] = [];
  let filings = 0;
  for (const ticker of tickers) {
    const key = ticker.toUpperCase().replace(/\./g, "-");
    const cik = cikOf.get(key) ?? cikOf.get(ticker.toUpperCase()) ?? cikOf.get(ticker.toUpperCase().replace(/-/g, "."));
    if (cik == null) {
      missing.push(ticker);
      continue;
    }
    const id = String(cik).padStart(10, "0");
    const file = path.join(EDGAR, `${id}.json`);
    let json: { filings?: { recent?: FilingBlock; files?: Array<{ name: string }> } };
    if (fs.existsSync(file)) json = JSON.parse(fs.readFileSync(file, "utf8"));
    else {
      json = (await secJson(`https://data.sec.gov/submissions/CIK${id}.json`)) as typeof json;
      fs.writeFileSync(file, JSON.stringify(json));
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    const dates = new Set(datesIn(json.filings?.recent));
    const recentDates = json.filings?.recent?.filingDate ?? [];
    const oldest = recentDates.length ? recentDates[recentDates.length - 1] : "9999";
    if (oldest > OOS_FROM) {
      for (const extra of json.filings?.files ?? []) {
        const extraFile = path.join(EDGAR, extra.name);
        let block: FilingBlock;
        if (fs.existsSync(extraFile)) block = JSON.parse(fs.readFileSync(extraFile, "utf8"));
        else {
          block = (await secJson(`https://data.sec.gov/submissions/${extra.name}`)) as FilingBlock;
          fs.writeFileSync(extraFile, JSON.stringify(block));
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
        for (const date of datesIn(block)) dates.add(date);
      }
    }
    const list = [...dates].sort();
    filings += list.length;
    byTicker.set(ticker, list);
  }
  return { byTicker, missing, withDate: byTicker.size, filings };
}

function tradeSplit(trades: TradePnl[], byTicker: Map<string, string[]>) {
  const span: TradePnl[] = [];
  const clear: TradePnl[] = [];
  let noFiling = 0;
  for (const trade of trades) {
    const dates = byTicker.get(trade.ticker);
    if (!dates) noFiling += 1;
    if (dates && spansEarnings(trade.entryDate, trade.exitDate, dates)) span.push(trade);
    else clear.push(trade);
  }
  return { span: splitStats(span), clear: splitStats(clear), noFiling };
}

function markdown(report: {
  checks: Check[];
  random: { trials: number; rsUsd: number; publishedUsd: number; percentileOfRerun: number | null; percentileOfPublished: number | null; mean: number; p05: number; p50: number; p95: number };
  dropped: Array<{ ticker: string; pnlUsd: number }>;
  earnings: { portfolio: ReturnType<typeof tradeSplit>; oneAtATime: ReturnType<typeof tradeSplit>; tickers: number; withDate: number; filings: number; missing: string[] };
  survivorship: string;
}): string {
  const row = (check: Check) =>
    `| ${check.label} | ${check.n} | ${usd(check.totalUsd)} | ${usd(check.totalOverMtm)} | ${usd(check.totalOverRealized)} | ${usd(check.year1.totalUsd)} | ${usd(check.year1.totalOverMtm)} | ${usd(check.year1.totalOverRealized)} | ${usd(check.year2.totalUsd)} | ${usd(check.year2.totalOverMtm)} | ${usd(check.year2.totalOverRealized)} |`;
  const lines = [
    `相対強度の並べ方を、スロットが足りない日だけ乱数にした試行は ${report.random.trials} 回。20日の対SPY ${usd(report.random.rsUsd)} より小さい乱数結果は ${report.random.percentileOfRerun ?? "—"}%。公開時の $2,053 でも ${report.random.percentileOfPublished ?? "—"}%。乱数の平均 ${usd(report.random.mean)}、中央値 ${usd(report.random.p50)}、5%点 ${usd(report.random.p05)}、95%点 ${usd(report.random.p95)}。`,
    "",
    "外した上位10銘柄（ATR≥3%・相対強度の確定損益）: " + report.dropped.map((row) => `${row.ticker} ${usd(row.pnlUsd)}`).join("、") + "。",
    "",
    `SECの8-K Item 2.02は ${report.earnings.withDate}/${report.earnings.tickers} 銘柄、届出 ${report.earnings.filings} 件。CIKがない銘柄: ${report.earnings.missing.length ? report.earnings.missing.join(", ") : "なし"}。保有期間に届出日を含む取引と含まない取引を分けた。届出が無い銘柄は「含まない」に入れ、件数は noFiling。`,
    "",
    `| 分け方 | 件数 | 合計 | 平均 | 勝率 | PF |`,
    `| --- | ---: | ---: | ---: | ---: | ---: |`,
    `| ポートフォリオ・決算をまたぐ | ${report.earnings.portfolio.span.n} | ${usd(report.earnings.portfolio.span.totalUsd)} | ${usd(report.earnings.portfolio.span.avgUsd)} | ${report.earnings.portfolio.span.winRate == null ? "—" : `${(report.earnings.portfolio.span.winRate * 100).toFixed(1)}%`} | ${report.earnings.portfolio.span.profitFactor ?? "—"} |`,
    `| ポートフォリオ・またがない | ${report.earnings.portfolio.clear.n} | ${usd(report.earnings.portfolio.clear.totalUsd)} | ${usd(report.earnings.portfolio.clear.avgUsd)} | ${report.earnings.portfolio.clear.winRate == null ? "—" : `${(report.earnings.portfolio.clear.winRate * 100).toFixed(1)}%`} | ${report.earnings.portfolio.clear.profitFactor ?? "—"} |`,
    `| $10建玉・決算をまたぐ | ${report.earnings.oneAtATime.span.n} | ${usd(report.earnings.oneAtATime.span.totalUsd)} | ${usd(report.earnings.oneAtATime.span.avgUsd)} | ${report.earnings.oneAtATime.span.winRate == null ? "—" : `${(report.earnings.oneAtATime.span.winRate * 100).toFixed(1)}%`} | ${report.earnings.oneAtATime.span.profitFactor ?? "—"} |`,
    `| $10建玉・またがない | ${report.earnings.oneAtATime.clear.n} | ${usd(report.earnings.oneAtATime.clear.totalUsd)} | ${usd(report.earnings.oneAtATime.clear.avgUsd)} | ${report.earnings.oneAtATime.clear.winRate == null ? "—" : `${(report.earnings.oneAtATime.clear.winRate * 100).toFixed(1)}%`} | ${report.earnings.oneAtATime.clear.profitFactor ?? "—"} |`,
    "",
    `ポートフォリオ側で届出日が無い銘柄の取引: ${report.earnings.portfolio.noFiling}。$10建玉側: ${report.earnings.oneAtATime.noFiling}。`,
    "",
    report.survivorship,
    "",
    "| 条件 | 件数 | 合計 | 合計/評価DD | 合計/確定DD | 年1 | 年1/評価DD | 年1/確定DD | 年2 | 年2/評価DD | 年2/確定DD |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...report.checks.map(row),
    "",
  ];
  return lines.join("\n");
}

async function main() {
  console.log("bars");
  const { names, spy, qqq } = await loadCore(false);
  const market = marketByDate(spy, []);
  const allDates = spy.map((bar) => bar.date);
  const inSessions = sessionsBetween(allDates, IN_FROM, IN_TO);
  const inNames = windowNames(names, IN_TO);
  const inCloses = closesOf(inNames);
  const box = inNames.flatMap((name) => rangeCandidates(name, FROZEN_BOX, market, inSessions, { from: IN_FROM, to: IN_TO }));
  console.log(`in-sample signals ${box.length} sessions ${inSessions.length}`);

  const run = (id: string, label: string, cands: Candidate[], extra: Partial<PortfolioOpts> = {}) =>
    runPortfolio(
      {
        id,
        label,
        universe: "core",
        rank: "rs",
        sessions: inSessions,
        flatten: true,
        withRestart: true,
        yearSplit: YEAR2_FROM,
        closes: inCloses,
        keepFills: true,
        ...extra,
      },
      cands,
    );

  const rs = run("rs20", "ATR≥3%・20日の対SPY", box, { order: orderBy("rs20") });
  const lookbacks = [10, 20, 40, 60].map((days) => {
    const field = `rs${days}` as "rs10" | "rs20" | "rs40" | "rs60";
    return checkFromBook(`rs${days}`, `ATR≥3%・${days}日の対SPY`, run(`rs${days}`, `${days}日`, box, { order: orderBy(field), keepFills: false }));
  });
  console.log(`rs20 ${rs.totalUsd} published ${PUBLISHED_RS}`);

  const totals: number[] = [];
  for (let seed = 1; seed <= 1000; seed += 1) {
    const rng = mulberry32(seed);
    const trial = runPortfolio(
      {
        id: `rand-${seed}`,
        label: "random",
        universe: "core",
        rank: "ticker",
        sessions: inSessions,
        flatten: true,
        withRestart: false,
        closes: inCloses,
        order: (list) => shuffle(list, rng),
      },
      box,
    );
    totals.push(trial.totalUsd);
    if (seed % 200 === 0) console.log(`random ${seed} last ${trial.totalUsd}`);
  }
  totals.sort((a, b) => a - b);
  const at = (q: number) => {
    const index = (totals.length - 1) * q;
    const lo = Math.floor(index);
    const hi = Math.ceil(index);
    return Math.round((totals[lo] * (hi - index) + totals[hi] * (index - lo)) * 100) / 100;
  };
  const mean = Math.round((totals.reduce((sum, value) => sum + value, 0) / totals.length) * 100) / 100;

  const fills = rs.fills ?? [];
  const byTicker = new Map<string, number>();
  for (const fill of fills) byTicker.set(fill.ticker, (byTicker.get(fill.ticker) ?? 0) + fill.pnlUsd);
  const dropped = [...byTicker.entries()]
    .map(([ticker, pnl]) => ({ ticker, pnlUsd: Math.round(pnl * 100) / 100 }))
    .sort((a, b) => b.pnlUsd - a.pnlUsd)
    .slice(0, 10);
  const dropSet = new Set(dropped.map((row) => row.ticker));
  const without = checkFromBook(
    "drop10",
    `ATR≥3%・20日の対SPY・上位10銘柄を除外`,
    run("drop10", "drop10", box.filter((cand) => !dropSet.has(cand.ticker)), { order: orderBy("rs20"), keepFills: false }),
  );

  console.log("edgar");
  const edgar = await edgarDates(inNames.map((name) => name.ticker));
  const portfolioSplit = tradeSplit(fills, edgar.byTicker);
  const singles = takeOneAtATime(box).trades.map((trade) => ({
    ticker: trade.ticker,
    pnlUsd: Math.round((trade.qty10 * (trade.exit - trade.entry) - 0.7) * 100) / 100,
    entryDate: trade.entryDate,
    exitDate: trade.exitDate,
  }));
  const singleSplit = tradeSplit(singles, edgar.byTicker);

  const gapCands = inNames.flatMap((name) => rangeCandidates(name, FROZEN_GAP, market, inSessions, { from: IN_FROM, to: IN_TO }));
  const gap = checkFromBook(
    "gap-stop",
    "ATR≥3%・20日の対SPY・ギャップは始値で損切り",
    run("gap-stop", "gap", gapCands, { order: orderBy("rs20"), keepFills: false }),
  );
  const semi = checkFromBook(
    "semi-cap",
    "ATR≥3%・20日の対SPY・半導体と装置は同時2まで",
    run("semi-cap", "semi", box, { order: orderBy("rs20"), maxSemi: 2, keepFills: false }),
  );
  const risk = checkFromBook(
    "risk",
    "ATR≥3%・20日の対SPY・損切り幅が資金の1%・上限$450",
    run("risk", "risk", box, {
      order: orderBy("rs20"),
      keepFills: false,
      size: (cand, equity) => sharesForRisk(cand.entry, cand.stop, equity),
    }),
  );
  const throttle = checkFromBook(
    "throttle",
    "ATR≥3%・20日の対SPY・評価が$3,200未満なら2枠・新規1",
    run("throttle", "throttle", box, { order: orderBy("rs20"), throttleBelowStart: true, keepFills: false }),
  );

  console.log("oos");
  const oosNames = windowNames(names, OOS_TO);
  const oosSessions = sessionsBetween(allDates, OOS_FROM, OOS_TO);
  const oosCloses = closesOf(oosNames);
  const oosBox = oosNames.flatMap((name) => rangeCandidates(name, FROZEN_BOX, market, oosSessions, { from: OOS_FROM, to: OOS_TO }));
  const oosRsi = oosNames.flatMap((name) => methodCandidates(name, "oversold", market, { from: OOS_FROM, to: OOS_TO }));
  const oosRun = (id: string, label: string, cands: Candidate[], rank: "ticker" | "rs", order?: (list: Candidate[]) => void) =>
    checkFromBook(
      id,
      label,
      runPortfolio(
        {
          id,
          label,
          universe: "core",
          rank,
          sessions: oosSessions,
          flatten: true,
          withRestart: true,
          yearSplit: OOS_YEAR2,
          closes: oosCloses,
          ...(order ? { order } : {}),
        },
        cands,
      ),
    );
  const y1Last = oosSessions.filter((date) => date < OOS_YEAR2).at(-1) ?? OOS_FROM;
  const y2First = oosSessions.find((date) => date >= OOS_YEAR2) ?? OOS_YEAR2;
  const qqqBook = runBuyHold("oos-qqq", "OOS QQQ", qqq, OOS_FROM, OOS_TO);
  const qqq1 = runBuyHold("oos-qqq-1", "OOS QQQ y1", qqq, OOS_FROM, y1Last);
  const qqq2 = runBuyHold("oos-qqq-2", "OOS QQQ y2", qqq, y2First, OOS_TO);
  qqqBook.restartYear1 = { n: qqq1.n, totalUsd: qqq1.totalUsd, maxDrawdownUsd: qqq1.maxDrawdownUsd, realizedDrawdownUsd: qqq1.realizedDrawdownUsd, daysRealized10: qqq1.daysRealized10 };
  qqqBook.restartYear2 = { n: qqq2.n, totalUsd: qqq2.totalUsd, maxDrawdownUsd: qqq2.maxDrawdownUsd, realizedDrawdownUsd: qqq2.realizedDrawdownUsd, daysRealized10: qqq2.daysRealized10 };

  const checks: Check[] = [
    ...lookbacks,
    without,
    gap,
    semi,
    risk,
    throttle,
    oosRun("oos-ticker", "OOS 2022-10..2024-10 箱・ティッカー順", oosBox, "ticker"),
    oosRun("oos-rs", "OOS 2022-10..2024-10 箱・20日の対SPY", oosBox, "rs", orderBy("rs20")),
    oosRun("oos-rsi", "OOS 2022-10..2024-10 RSI(2)<10", oosRsi, "ticker"),
    checkFromBook("oos-qqq", "OOS 2022-10..2024-10 QQQ", qqqBook),
  ];

  const survivorship =
    "ポイントインタイムの指数採用日は取っていない。前回の広いユニバースは2026-10-02時点のS&P500とNasdaq-100のまま。この追試の186銘柄も今のウォッチリストで、2022年当時のメンバーではない。";

  const report = {
    v: 1 as const,
    generatedAt: new Date().toISOString(),
    account: { capital: 3200, maxPositions: 5, positionMin: 300, positionMax: 450, fee: 0.7 },
    random: {
      trials: 1000,
      rsUsd: rs.totalUsd,
      publishedUsd: PUBLISHED_RS,
      percentileOfRerun: percentileBelow(totals, rs.totalUsd),
      percentileOfPublished: percentileBelow(totals, PUBLISHED_RS),
      mean,
      p05: at(0.05),
      p50: at(0.5),
      p95: at(0.95),
      min: totals[0],
      max: totals[totals.length - 1],
    },
    dropped,
    earnings: {
      tickers: inNames.length,
      withDate: edgar.withDate,
      filings: edgar.filings,
      missing: edgar.missing,
      portfolio: portfolioSplit,
      oneAtATime: singleSplit,
    },
    survivorship,
    checks,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report));
  const body = markdown(report);
  const doc = fs.readFileSync(DOC, "utf8");
  const next = doc.replace(/<!-- ROBUSTNESS-START -->[\s\S]*?<!-- ROBUSTNESS-END -->/, `<!-- ROBUSTNESS-START -->\n${body}<!-- ROBUSTNESS-END -->`);
  fs.writeFileSync(DOC, next);
  console.log(`wrote ${OUT}`);
  console.log(body);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
