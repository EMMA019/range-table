import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildFeatures, rangeCandidates, runPortfolio, withRules, type Candidate, type Feat, type NameSeries } from "./backtest-study";
import { buildPaper, FROZEN_GAP, PAPER_START } from "./paper";
import { item202Dates, mulberry32, percentileBelow, sharesForRisk, shuffle, spansEarnings } from "./robustness";
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

function nameOf(bars: Bar[], ticker = "AAA", semi = false): NameSeries {
  return { ticker, sector: "テスト", semi, core: true, broad: false, feats: buildFeatures(bars), earnings: [] };
}

describe("risk sizing", () => {
  it("sizes a 1% loss to the 20-day low and caps the lot at $450", () => {
    assert.equal(sharesForRisk(100, 90, 3200), 3);
    assert.equal(sharesForRisk(100, 99, 3200), 4);
    assert.equal(sharesForRisk(100, 100, 3200), null);
    assert.equal(sharesForRisk(500, 490, 3200), null);
  });
});

describe("earnings span", () => {
  it("counts a filing on the entry, the exit, or a day held in between", () => {
    assert.equal(spansEarnings("2024-10-04", "2024-10-10", ["2024-10-07"]), true);
    assert.equal(spansEarnings("2024-10-04", "2024-10-10", ["2024-10-04"]), true);
    assert.equal(spansEarnings("2024-10-04", "2024-10-10", ["2024-10-11"]), false);
    assert.equal(spansEarnings("2024-10-04", "2024-10-10", []), false);
  });

  it("keeps 8-K item 2.02 filing dates", () => {
    assert.deepEqual(
      item202Dates(["8-K", "10-Q", "8-K"], ["2024-01-02", "2024-02-01", "2024-03-01"], ["2.02,9.01", "", "5.02"]),
      ["2024-01-02"],
    );
  });
});

describe("gap-through stop", () => {
  it("sells at the open when a later session opens under the 20-day low", () => {
    const bars = series([
      [99, 100, 98, 99],
      [90, 97, 89, 96],
    ]);
    const plain = withRules({ id: "plain", label: "plain" });
    const held = rangeCandidates(nameOf(bars), plain, new Map(), []);
    const gapped = rangeCandidates(nameOf(bars), FROZEN_GAP, new Map(), [], { from: "2020-01-01", to: "2030-01-01" });
    assert.equal(gapped.length, 1);
    assert.equal(gapped[0].reason, "stop");
    assert.equal(gapped[0].exit, 90);
    assert.ok(held.length === 1 && held[0].exit !== 90);
  });
});

describe("portfolio add-ons", () => {
  const sessions = [day(0), day(1), day(2), day(3)];

  function cand(ticker: string, entryDate: string, exitDate: string, extra: Partial<Candidate> = {}): Candidate {
    return {
      ticker,
      sector: "t",
      semi: extra.semi ?? false,
      signalIndex: 0,
      entryIndex: 1,
      exitIndex: 2,
      signalDate: entryDate,
      entryDate,
      exitDate,
      entry: 100,
      exit: 100,
      atr: 2,
      atrPct: 3,
      boxPct: 20,
      rebound: 1,
      rs20: 0,
      stop: 90,
      qty10: 1,
      reason: "target",
      exitTiming: "close",
      voided: false,
      ...extra,
    };
  }

  function closes(tickers: string[], px: (ticker: string) => number): Map<string, Map<string, number>> {
    const map = new Map<string, Map<string, number>>();
    for (const ticker of tickers) {
      const days = new Map<string, number>();
      for (const date of sessions) days.set(date, px(ticker));
      map.set(ticker, days);
    }
    return map;
  }

  it("holds at most two semiconductor names", () => {
    const names = ["A", "B", "C"];
    const book = runPortfolio(
      {
        id: "semi",
        label: "semi",
        universe: "core",
        rank: "ticker",
        sessions,
        flatten: true,
        maxSemi: 2,
        closes: closes(names, () => 100),
        withRestart: false,
      },
      names.map((ticker) => cand(ticker, sessions[0], sessions[3], { semi: true })),
    );
    assert.equal(book.n, 2);
    assert.equal(book.skippedSemi, 1);
  });

  it("allows one new buy and two slots once equity is under the start", () => {
    const names = ["LOSS", "B", "C", "D"];
    const book = runPortfolio(
      {
        id: "throttle",
        label: "throttle",
        universe: "core",
        rank: "ticker",
        sessions,
        flatten: true,
        throttleBelowStart: true,
        closes: closes(names, (ticker) => (ticker === "LOSS" ? 50 : 100)),
        withRestart: false,
      },
      [
        cand("LOSS", sessions[0], sessions[3]),
        cand("B", sessions[1], sessions[3]),
        cand("C", sessions[1], sessions[3]),
        cand("D", sessions[1], sessions[3]),
      ],
    );
    assert.equal(book.n, 2);
    assert.equal(book.skippedSlot, 2);
  });
});

describe("random rank helper", () => {
  it("repeats a shuffle for the same seed and scores the reference", () => {
    const once = [1, 2, 3, 4, 5];
    const twice = [1, 2, 3, 4, 5];
    shuffle(once, mulberry32(7));
    shuffle(twice, mulberry32(7));
    assert.deepEqual(once, twice);
    assert.equal(percentileBelow([1, 2, 3, 4], 3), 50);
  });
});

describe("paper books", () => {
  it("stays in cash until the first session on or after the start date", () => {
    const feats = [{ date: "2026-10-01", o: 100, h: 100, l: 100, c: 100, v: 1 }] as Feat[];
    const name: NameSeries = { ticker: "AAA", sector: "t", semi: false, core: true, broad: false, feats, earnings: [] };
    const report = buildPaper({ names: [name], spy: feats, qqq: feats, generatedAt: "2026-10-03" });
    assert.equal(report.start, PAPER_START);
    assert.match(report.rulesCommit, /^[0-9a-f]{40}$/);
    assert.equal(report.asOf, null);
    assert.equal(report.books.length, 4);
    assert.ok(report.books.every((book) => book.endEquity === 3200 && book.n === 0));
  });
});
