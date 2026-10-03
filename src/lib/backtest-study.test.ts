import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_RULES, runTicker } from "./backtest";
import {
  BASE_RULES,
  buildFeatures,
  chaseFlag,
  clipTo,
  improvesRow,
  nearEarnings,
  rangeCandidates,
  runPortfolio,
  sharesForBudget,
  takeOneAtATime,
  tradingDistance,
  withRules,
  type Candidate,
  type Feat,
  type MarketDay,
  type NameSeries,
  type Row,
} from "./backtest-study";
import type { Bar } from "./types";

function day(i: number): string {
  const d = new Date(Date.UTC(2026, 0, 5));
  let n = 0;
  while (n < i) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (d.getUTCDay() % 6 !== 0) n += 1;
  }
  return d.toISOString().slice(0, 10);
}

/** Same shape as the published backtest fixture: signal on bar 26, ATR about 15.71. */
function series(after: Array<[number, number, number, number]>): Bar[] {
  const bars: Bar[] = [];
  for (let i = 0; i < 24; i += 1) {
    const c = i % 2 ? 118 : 104;
    bars.push({ date: day(i), o: c, h: c + 3, l: c - 3, c, v: 1e6 });
  }
  bars.push({ date: day(24), o: 104, h: 104, l: 92, c: 93, v: 1e6 });
  bars.push({ date: day(25), o: 93, h: 97, l: 92.5, c: 96, v: 1e6 });
  bars.push({ date: day(26), o: 96, h: 98, l: 95.5, c: 97.5, v: 1e6 });
  after.forEach(([o, h, l, c], k) => bars.push({ date: day(27 + k), o, h, l, c, v: 1e6 }));
  return bars;
}

const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} ≠ ${expected}`);

function nameOf(bars: Bar[], ticker = "AAA"): NameSeries {
  return { ticker, sector: "テスト", semi: false, core: true, broad: false, feats: buildFeatures(bars), earnings: [] };
}

const market = new Map<string, MarketDay>();

function scored(pnl: number, year: 1 | 2, n = 40): Row {
  const stats = {
    n,
    winRate: 0.5,
    avgUsd: pnl,
    profitFactor: pnl > 0 ? 1.2 : 0.8,
    maxConsecLosses: 1,
    maxDrawdownUsd: 1,
    totalUsd: pnl * n,
    avgHold: 2,
    targets: 1,
    stops: 1,
    timeouts: 0,
    sharps: 0,
  };
  const empty = { ...stats, n: 0, avgUsd: null, profitFactor: null, winRate: null, totalUsd: 0 };
  return {
    id: "x",
    label: "x",
    rawSignals: n,
    signalsPerWeek: null,
    open: 0,
    stats,
    year1: year === 1 ? stats : empty,
    year2: year === 2 ? stats : empty,
  };
}

function bothYears(y1: number, y2: number, pf = 1.2): Row {
  const leg = (avg: number) => ({
    n: 40,
    winRate: 0.5,
    avgUsd: avg,
    profitFactor: pf,
    maxConsecLosses: 1,
    maxDrawdownUsd: 1,
    totalUsd: avg * 40,
    avgHold: 2,
    targets: 1,
    stops: 1,
    timeouts: 0,
    sharps: 0,
  });
  return {
    id: "x",
    label: "x",
    rawSignals: 80,
    signalsPerWeek: null,
    open: 0,
    stats: leg((y1 + y2) / 2),
    year1: leg(y1),
    year2: leg(y2),
  };
}

describe("budget sizing", () => {
  it("buys the most whole shares that cost between $300 and $450", () => {
    assert.equal(sharesForBudget(100), 4);
    assert.equal(sharesForBudget(151), 2);
    assert.equal(sharesForBudget(310), 1);
    assert.equal(sharesForBudget(450), 1);
    assert.equal(sharesForBudget(230), null);
    assert.equal(sharesForBudget(450.01), null);
    assert.equal(sharesForBudget(20), 22);
  });
});

describe("earnings distance", () => {
  const sessions = ["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09", "2026-01-12", "2026-01-13"];

  it("counts sessions, not calendar days, and blocks five sessions either side", () => {
    assert.equal(tradingDistance(sessions, "2026-01-05", "2026-01-12"), 5);
    assert.equal(nearEarnings(sessions, "2026-01-05", ["2026-01-12"]), true);
    assert.equal(nearEarnings(sessions, "2026-01-05", ["2026-01-13"]), false);
    assert.equal(nearEarnings(sessions, "2026-01-08", []), false);
  });
});

describe("features are causal", () => {
  it("does not change earlier bars when a future bar is appended", () => {
    const bars = series([[98, 100, 97, 98]]);
    const before = buildFeatures(bars);
    const after = buildFeatures([...bars, { date: day(40), o: 200, h: 220, l: 50, c: 210, v: 1 }]);
    assert.deepEqual(after.slice(0, before.length), before);
  });

  it("computes Wilder RSI(2) from past closes only", () => {
    const bars: Bar[] = [
      { date: day(0), o: 10, h: 10, l: 10, c: 10, v: 1 },
      { date: day(1), o: 10, h: 11, l: 10, c: 11, v: 1 },
      { date: day(2), o: 11, h: 11, l: 10, c: 10, v: 1 },
      { date: day(3), o: 10, h: 10, l: 9, c: 9, v: 1 },
    ];
    const feats = buildFeatures(bars);
    assert.equal(feats[1].rsi2, null);
    near(feats[2].rsi2 ?? 0, 50);
    near(feats[3].rsi2 ?? 0, 25);
  });
});

describe("range trades match the published engine", () => {
  it("takes the same target, stop, timeout and same-day priority", () => {
    const cases: Bar[][] = [
      series([[98, 100, 97, 97.8], [99, 114, 98, 110]]),
      series([[98, 100, 97, 97.8], [120, 125, 119, 122]]),
      series([[98, 100, 97, 97.8], [97, 98, 90, 91], [89, 90, 88, 89.5]]),
      series([[98, 100, 97, 97.8], [99, 115, 90, 91]]),
      series(Array.from({ length: 22 }, () => [98, 99, 97, 97.6] as [number, number, number, number])),
    ];
    for (const bars of cases) {
      const published = runTicker("AAA", bars, DEFAULT_RULES).trades;
      const mine = takeOneAtATime(rangeCandidates(nameOf(bars), BASE_RULES, market, [])).trades;
      assert.equal(mine.length, published.length);
      published.forEach((trade, index) => {
        const got = mine[index];
        assert.equal(got.signalDate, trade.signalDate);
        assert.equal(got.entryDate, trade.entryDate);
        assert.equal(got.exitDate, trade.exitDate);
        assert.equal(got.reason, trade.reason);
        assert.equal(got.qty10, trade.qty);
        near(got.entry, trade.entry);
        near(got.exit, trade.exit);
        near(got.qty10 * (got.exit - got.entry) - 0.7, trade.pnlUsd);
      });
    }
  });

  it("keeps a wider stop and a sharp-up close distinct from the 1 ATR limit", () => {
    const bars = series([[98, 100, 97, 97.8], [97, 98, 90, 91]]);
    const wide = withRules({ id: "half", label: "half", stop: "half" });
    const held = rangeCandidates(nameOf(bars), wide, market, []);
    assert.equal(held.length, 1);
    assert.equal(held[0].reason, "window", "91 is under the 20-day low but not under low − 0.5 ATR");

    const sharpBars = series([
      [98, 100, 97, 97.8],
      [98, 113.65, 97, 113.6],
    ]);
    const sharp = withRules({ id: "sharp", label: "sharp", tp: null, sharp: true });
    const [trade] = takeOneAtATime(rangeCandidates(nameOf(sharpBars), sharp, market, [])).trades;
    assert.ok(trade, "sharp exit should close the trade");
    assert.equal(trade.reason, "sharp");
    assert.equal(trade.exit, 113.6);
    assert.ok(trade.exit < trade.entry + trade.atr);
  });

  it("sells at the forced close unless the stop fills first", () => {
    const bars = series(Array.from({ length: 22 }, () => [98, 99, 97, 97.6] as [number, number, number, number]));
    const open = rangeCandidates(nameOf(bars), BASE_RULES, market, []);
    const forced = rangeCandidates(nameOf(bars), BASE_RULES, market, [], undefined, (entry) => entry);
    assert.equal(open.length, 1);
    assert.equal(forced.length, 1);
    assert.equal(forced[0].exitDate, forced[0].entryDate);
    assert.equal(forced[0].exit, 97.6);
    assert.notEqual(open[0].exitDate, forced[0].exitDate);

    const stopped = series([[98, 100, 97, 97.8], [97, 98, 90, 91], [89, 90, 88, 89.5]]);
    const cut = rangeCandidates(nameOf(stopped), BASE_RULES, market, [], undefined, () => day(40));
    const plain = rangeCandidates(nameOf(stopped), BASE_RULES, market, []);
    assert.equal(cut[0].exitDate, plain[0].exitDate);
    assert.equal(cut[0].reason, plain[0].reason);
  });

  it("keeps the box-low stop unless a replacement stop is supplied", () => {
    const bars = series([[98, 100, 97, 97.8], [97, 98, 90, 91], [89, 90, 88, 89.5]]);
    const rules = withRules({ id: "gap", label: "gap", gapThroughStop: true });
    const base = rangeCandidates(nameOf(bars), rules, market, []);
    const wide = rangeCandidates(nameOf(bars), rules, market, [], undefined, undefined, () => 1);
    assert.equal(base.length, 1);
    assert.equal(wide.length, 1);
    assert.equal(base[0].reason, "stop");
    assert.ok(wide[0].exitIndex > base[0].exitIndex);
  });
});

describe("portfolio constraints", () => {
  const sessions = [day(0), day(1), day(2), day(3)];

  function cand(ticker: string, entryDate: string, exitDate: string, entry: number, exit: number, extra: Partial<Candidate> = {}): Candidate {
    return {
      ticker,
      sector: "t",
      semi: false,
      signalIndex: 0,
      entryIndex: 1,
      exitIndex: 2,
      signalDate: entryDate,
      entryDate,
      exitDate,
      entry,
      exit,
      atr: 2,
      atrPct: extra.atrPct ?? 3,
      boxPct: extra.boxPct ?? 20,
      rebound: 1,
      rs20: extra.rs20 ?? 0,
      qty10: 1,
      reason: "target",
      exitTiming: extra.exitTiming ?? "close",
      voided: false,
      ...extra,
    };
  }

  function closes(tickers: string[]): Map<string, Map<string, number>> {
    const map = new Map<string, Map<string, number>>();
    for (const ticker of tickers) {
      const days = new Map<string, number>();
      for (const date of sessions) days.set(date, 100);
      map.set(ticker, days);
    }
    return map;
  }

  it("caps concurrent names at 5 and does not spend unsettled sale proceeds the same day", () => {
    const names = ["A", "B", "C", "D", "E", "F"];
    const cands = names.map((ticker) => cand(ticker, sessions[0], sessions[2], 50, 55));
    const book = runPortfolio(
      {
        id: "cap",
        label: "cap",
        universe: "core",
        rank: "ticker",
        sessions,
        flatten: true,
        closes: closes(names),
        withRestart: false,
      },
      cands,
    );
    assert.equal(book.n, 5);
    assert.equal(book.skippedSlot, 1);
    assert.ok(book.endEquity > 3200);

    const openExit = cand("A", sessions[0], sessions[1], 100, 120, { exitTiming: "open" });
    const sameDay = cand("B", sessions[1], sessions[2], 100, 110);
    const settled = runPortfolio(
      {
        id: "t1",
        label: "t1",
        universe: "core",
        rank: "ticker",
        sessions,
        flatten: true,
        capital: 400,
        closes: closes(["A", "B"]),
        withRestart: false,
      },
      [openExit, sameDay],
    );
    assert.equal(settled.n, 1, "B cannot use A's same-day sale");
    assert.equal(settled.skippedCash, 1);
  });

  it("ranks by ATR%, lower box position, or relative strength when slots run out", () => {
    const hi = cand("AAA", sessions[0], sessions[1], 100, 101, { atrPct: 9, boxPct: 40, rs20: -0.1 });
    const lo = cand("BBB", sessions[0], sessions[1], 100, 130, { atrPct: 3, boxPct: 16, rs20: 0.2 });
    const run = (rank: "atr" | "box" | "rs") =>
      runPortfolio(
        {
          id: rank,
          label: rank,
          universe: "core",
          rank,
          sessions,
          flatten: true,
          maxPositions: 1,
          closes: closes(["AAA", "BBB"]),
          withRestart: false,
        },
        [lo, hi],
      );
    assert.equal(run("atr").totalUsd > 0 && run("atr").n, 1);
    const atrBook = run("atr");
    const boxBook = run("box");
    const rsBook = run("rs");
    assert.ok(atrBook.totalUsd < boxBook.totalUsd, "ATR rank takes AAA, the smaller winner");
    assert.ok(boxBook.totalUsd > rsBook.totalUsd || boxBook.avgUsd !== atrBook.avgUsd);
    assert.ok(boxBook.totalUsd > atrBook.totalUsd);
    assert.ok(rsBook.totalUsd > atrBook.totalUsd);
  });

  it("caps non-semiconductor slots only when maxNonSemi is set", () => {
    const semis = ["S1", "S2"].map((ticker) => cand(ticker, sessions[0], sessions[1], 100, 110, { semi: true }));
    const others = ["A", "B", "C", "D"].map((ticker) => cand(ticker, sessions[0], sessions[1], 100, 120));
    const names = [...others, ...semis].map((row) => row.ticker);
    const open = {
      id: "slots",
      label: "slots",
      universe: "core",
      rank: "ticker" as const,
      sessions,
      flatten: true,
      maxPositions: 5,
      closes: closes(names),
      withRestart: false,
    };
    const base = runPortfolio(open, [...semis, ...others]);
    const capped = runPortfolio({ ...open, maxSemi: 2, maxNonSemi: 1 }, [...semis, ...others]);
    assert.equal(base.n, 5);
    assert.equal(base.skippedSemi, 0);
    assert.equal(capped.n, 3);
    assert.equal(capped.skippedSemi, 3);
  });

  it("charges a per-order fee on the entry and the exit only when one is supplied", () => {
    const trade = cand("AAA", sessions[0], sessions[1], 50, 55);
    const open = {
      id: "fee",
      label: "fee",
      universe: "core",
      rank: "ticker" as const,
      sessions,
      flatten: true,
      maxPositions: 1,
      closes: closes(["AAA"]),
      withRestart: false,
    };
    const flat = runPortfolio(open, [trade]);
    const ibkr = runPortfolio({ ...open, orderFee: () => 1 }, [trade]);
    assert.equal(flat.totalUsd, 44.3);
    assert.equal(ibkr.totalUsd, 43);
  });
});

describe("rule selection guards", () => {
  it("adopts a variation only when both years improve by at least five cents with PF at least 1", () => {
    const base = bothYears(0.4, 0.3);
    assert.equal(improvesRow(bothYears(0.5, 0.36), base), true);
    assert.equal(improvesRow(bothYears(0.5, 0.3), base), false);
    assert.equal(improvesRow(bothYears(0.8, -0.1), base), false);
    assert.equal(improvesRow(bothYears(0.8, 0.5, 0.9), base), false);
  });

  it("calls the chase label justified only when the upper box loses in both years", () => {
    assert.equal(chaseFlag(bothYears(0.5, 0.4), bothYears(0.2, 0.1)), "justified");
    assert.equal(chaseFlag(bothYears(0.3, 0.3), bothYears(0.4, 0.5)), "not_justified");
    assert.equal(chaseFlag(bothYears(0.5, 0.2), bothYears(0.1, 0.4)), "mixed");
    assert.equal(chaseFlag(scored(1, 1, 10), bothYears(0.1, 0.1)), "thin");
  });
});

describe("clip", () => {
  it("keeps warmup bars and drops sessions after the study end", () => {
    const feats = [
      { date: "2024-01-02" },
      { date: "2026-10-02" },
      { date: "2026-10-03" },
    ] as Feat[];
    assert.deepEqual(clipTo(feats).map((bar) => bar.date), ["2024-01-02", "2026-10-02"]);
  });
});
