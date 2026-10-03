import {
  BROAD_PRICE_MAX,
  ROUND_TRIP_FEE,
  START_CAPITAL,
  marketByDate,
  methodCandidates,
  rangeCandidates,
  runBuyHold,
  runPortfolio,
  withRules,
  type Book,
  type Feat,
  type NameSeries,
} from "./backtest-study";
import type { Candidate } from "./backtest-study";

/** First session of the paper test. Signals use that close or a later one; fills are the next open. */
export const PAPER_START = "2026-10-05";

/**
 * Commit that froze these rules. The scheduled job copies this string and does not advance it.
 * PENDING until the rules commit exists.
 */
export const PAPER_RULES_COMMIT = "PENDING";

export const PAPER_RULES = [
  "開始は 2026-10-05。ブックは4つ、それぞれ現金 $3,200。箱と RSI は同時5件、1件 $300–$450、整数株、往復手数料 $0.70。売却代金は翌セッションまで使えない。",
  "箱: 反発1日以上、終値が20日箱の15%線以上、ATR 3%以上、終値 $550以下。利確は翌日始値+1ATR。損切りは終値がシグナル日の20日安値を下回ったときの終値。20営業日で期限。シグナルは終値、買いは翌営業日の始値。",
  "箱の並べ方は二つ。ティッカー順。もう一つは20日リターンからSPYの20日リターンを引いた大きい順。",
  "RSI(2)が10未満なら翌日始値で買う。終値が5日線を上回るか、5営業日で売る。並べ方はティッカー順。",
  "QQQは開始日の始値で口座全額を整数株にする。1件 $450の上限は使わない。往復手数料 $0.70は最終足で引く。",
  "ルールはここで固定する。結果を見てエントリーも出口も変えない。",
] as const;

export const FROZEN_BOX = withRules({
  id: "frozen-box",
  label: "箱・ATR≥3%・終値≤$550",
  atrMin: 3,
  priceMax: BROAD_PRICE_MAX,
});

export const FROZEN_GAP = withRules({
  id: "frozen-gap",
  label: "箱・ATR≥3%・終値≤$550・ギャップは始値で損切り",
  atrMin: 3,
  priceMax: BROAD_PRICE_MAX,
  gapThroughStop: true,
});

export type PaperBook = {
  id: string;
  label: string;
  n: number;
  totalUsd: number;
  endEquity: number;
  mtmDdUsd: number;
  realizedDdUsd: number;
  daily: Array<{ date: string; equity: number; realizedEquity: number }>;
};

export type PaperReport = {
  v: 1;
  rulesCommit: string;
  generatedAt: string;
  start: typeof PAPER_START;
  asOf: string | null;
  rules: string[];
  note: string;
  books: PaperBook[];
};

function orderByRs20(list: Candidate[]): void {
  list.sort((a, b) => {
    if (a.rs20 == null && b.rs20 != null) return 1;
    if (a.rs20 != null && b.rs20 == null) return -1;
    if (a.rs20 != null && b.rs20 != null && a.rs20 !== b.rs20) return b.rs20 - a.rs20;
    return a.ticker.localeCompare(b.ticker);
  });
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

function toPaper(book: Book): PaperBook {
  return {
    id: book.id,
    label: book.label,
    n: book.n,
    totalUsd: book.totalUsd,
    endEquity: book.endEquity,
    mtmDdUsd: book.maxDrawdownUsd,
    realizedDdUsd: book.realizedDrawdownUsd ?? 0,
    daily: book.daily ?? [],
  };
}

function flat(id: string, label: string): PaperBook {
  return { id, label, n: 0, totalUsd: 0, endEquity: START_CAPITAL, mtmDdUsd: 0, realizedDdUsd: 0, daily: [] };
}

/**
 * Deterministic paper books. Bars after `PAPER_START` are the only fills.
 * A signal on day T uses the close of T. The buy is the next session's open.
 */
export function buildPaper(args: { names: NameSeries[]; spy: Feat[]; qqq: Feat[]; generatedAt: string }): PaperReport {
  const sessions = args.spy.map((bar) => bar.date).filter((date) => date >= PAPER_START);
  const asOf = sessions.at(-1) ?? null;
  const note = asOf
    ? `${PAPER_START} から ${asOf} の確定足。シグナルは終値、買いは翌始値。`
    : `${PAPER_START} の始値までは現金 $${START_CAPITAL}。確定足がまだない。`;
  const labels = {
    ticker: "箱・ATR≥3%・ティッカー順",
    rs: "箱・ATR≥3%・20日の対SPY",
    rsi: "RSI(2)<10",
    qqq: "QQQを口座いっぱい",
  };
  if (!asOf) {
    return {
      v: 1,
      rulesCommit: PAPER_RULES_COMMIT,
      generatedAt: args.generatedAt,
      start: PAPER_START,
      asOf: null,
      rules: [...PAPER_RULES],
      note,
      books: [flat("box-ticker", labels.ticker), flat("box-rs", labels.rs), flat("rsi2", labels.rsi), flat("qqq", labels.qqq)],
    };
  }
  const market = marketByDate(args.spy, []);
  const bounds = { from: PAPER_START, to: asOf };
  const closes = closesOf(args.names);
  const box = args.names.flatMap((name) => rangeCandidates(name, FROZEN_BOX, market, sessions, bounds));
  const rsi = args.names.flatMap((name) => methodCandidates(name, "oversold", market, bounds));
  const common = { universe: "paper", sessions, flatten: true, withRestart: false, closes, keepDaily: true, capital: START_CAPITAL };
  const ticker = runPortfolio({ ...common, id: "box-ticker", label: labels.ticker, rank: "ticker" }, box);
  const rs = runPortfolio({ ...common, id: "box-rs", label: labels.rs, rank: "rs", order: orderByRs20 }, box);
  const rsiBook = runPortfolio({ ...common, id: "rsi2", label: labels.rsi, rank: "ticker" }, rsi);
  const qqq = toPaper(runBuyHold("qqq", labels.qqq, args.qqq, PAPER_START, asOf));
  qqq.daily = holdDaily(args.qqq, PAPER_START, asOf);
  return {
    v: 1,
    rulesCommit: PAPER_RULES_COMMIT,
    generatedAt: args.generatedAt,
    start: PAPER_START,
    asOf,
    rules: [...PAPER_RULES],
    note,
    books: [toPaper(ticker), toPaper(rs), toPaper(rsiBook), qqq],
  };
}

function holdDaily(feats: Feat[], from: string, to: string): PaperBook["daily"] {
  const bars = feats.filter((bar) => bar.date >= from && bar.date <= to);
  if (!bars.length || !(bars[0].o > 0)) return [];
  const qty = Math.floor(START_CAPITAL / bars[0].o);
  const cash = START_CAPITAL - qty * bars[0].o;
  const round = (value: number) => Math.round(value * 100) / 100;
  return bars.map((bar, index) => {
    const last = index === bars.length - 1;
    const fee = last ? ROUND_TRIP_FEE : 0;
    return {
      date: bar.date,
      equity: round(cash + qty * bar.c - fee),
      realizedEquity: round(last ? cash + qty * bar.c - fee : START_CAPITAL),
    };
  });
}
