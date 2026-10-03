import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Feat } from "./backtest-study";
import {
  bootstrapMean,
  commonStockTitle,
  driftCandidates,
  dropMonthTurn,
  entryBeforeEarnings,
  flagIsPlan,
  footnoteIsPlan,
  gapFillCandidates,
  ibkrFixedFee,
  insiderFilingSignals,
  insiderRole,
  monthTurnSessions,
  overallVerdict,
  reactionDay,
  windowVerdict,
} from "./round2";

function bar(date: string, o: number, h: number, l: number, c: number, v: number, atr: number, extra: Partial<Feat> = {}): Feat {
  return {
    date,
    o,
    h,
    l,
    c,
    v,
    atr,
    low20: l,
    high20: h,
    priorHigh20: h,
    boxPct: 20,
    line15: l,
    mid: (l + h) / 2,
    rebound: 1,
    entrySignal: "in_ok",
    gapWarning: false,
    avgDollar20: c * v,
    ma5: c,
    ma50: c,
    ma200: c,
    rsi2: 50,
    ret10: 0,
    ret20: 0.1,
    ret40: 0,
    ret60: 0,
    ret63: 0,
    down3: false,
    gapPct: 0,
    bullish: c > o,
    ...extra,
  };
}

describe("round 2 rules", () => {
  it("charges the IBKR minimum until the per-share amount clears a dollar", () => {
    assert.equal(ibkrFixedFee(10, 40), 1);
    assert.equal(ibkrFixedFee(225, 2), 1.125);
  });

  it("maps an acceptance timestamp onto the reaction session", () => {
    const sessions = ["2024-01-12", "2024-01-15", "2024-01-16", "2024-07-15", "2024-07-16"];
    assert.equal(reactionDay("2024-01-15T14:00:00.000Z", sessions), "2024-01-15");
    assert.equal(reactionDay("2024-01-15T15:00:00.000Z", sessions), "2024-01-15");
    assert.equal(reactionDay("2024-01-15T21:30:00.000Z", sessions), "2024-01-16");
    assert.equal(reactionDay("2024-07-15T20:30:00.000Z", sessions), "2024-07-16");
    assert.equal(reactionDay("2024-07-13T12:00:00.000Z", sessions), "2024-07-15");
    assert.equal(reactionDay("not-a-time", sessions), null);
  });

  it("marks the last session and the first three sessions of a month", () => {
    const sessions = ["2024-01-29", "2024-01-30", "2024-01-31", "2024-02-01", "2024-02-02", "2024-02-05", "2024-02-06", "2024-02-07"];
    const turns = monthTurnSessions(sessions);
    assert.equal(turns.has("2024-01-31"), true);
    assert.equal(turns.has("2024-01-30"), true);
    assert.equal(turns.has("2024-02-01"), true);
    assert.equal(turns.has("2024-02-05"), true);
    assert.equal(turns.has("2024-02-06"), false);
    assert.equal(turns.has("2024-02-07"), true);
  });

  it("blocks only the five sessions before a reaction day", () => {
    const sessions = ["2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05", "2024-01-08", "2024-01-09", "2024-01-10"];
    assert.equal(entryBeforeEarnings("2024-01-02", ["2024-01-09"], sessions), true);
    assert.equal(entryBeforeEarnings("2024-01-03", ["2024-01-09"], sessions), true);
    assert.equal(entryBeforeEarnings("2024-01-09", ["2024-01-09"], sessions), false);
    assert.equal(entryBeforeEarnings("2024-01-10", ["2024-01-09"], sessions), false);
  });

  it("keeps a drift entry only when the reaction day gaps, closes up, and doubles volume", () => {
    const bars = [bar("2024-01-02", 100, 101, 99, 100, 100, 2)];
    for (let i = 0; i < 20; i += 1) bars.push(bar(`2024-02-${String(i + 1).padStart(2, "0")}`, 100, 101, 99, 100, 100, 2));
    bars.push(bar("2024-03-01", 106, 112, 105, 110, 250, 4));
    bars.push(bar("2024-03-04", 110, 114, 109, 112, 100, 4));
    const spy = new Map<string, number | null>([["2024-03-01", 0]]);
    const hits = driftCandidates("AAA", false, bars, ["2024-03-01"], spy, { from: "2024-03-01", to: "2024-03-31" });
    assert.equal(hits.length, 1);
    assert.equal(hits[0]?.entryDate, "2024-03-04");
    assert.equal(hits[0]?.entry, 110);
    const quiet = driftCandidates("AAA", false, bars, ["2024-03-01"], spy, { from: "2024-03-01", to: "2024-03-31" });
    bars[bars.length - 2] = bar("2024-03-01", 106, 112, 105, 110, 100, 4);
    assert.equal(quiet.length, 1);
    assert.equal(driftCandidates("AAA", false, bars, ["2024-03-01"], spy, { from: "2024-03-01", to: "2024-03-31" }).length, 0);
    assert.equal(dropMonthTurn(hits, new Set(["2024-03-04"])).length, 0);
  });

  it("buys a no-news gap at the open and sells a fill at the prior close", () => {
    const bars = [bar("2024-03-04", 100, 101, 99, 100, 100, 4), bar("2024-03-05", 96, 100, 95, 97, 100, 4)];
    const ok = new Map([["2024-03-05", true]]);
    const spy = new Map<string, number | null>([["2024-03-04", 0]]);
    const hit = gapFillCandidates("AAA", false, bars, new Set(), ok, spy, { from: "2024-03-01", to: "2024-03-31" });
    assert.equal(hit.length, 1);
    assert.equal(hit[0]?.entry, 96);
    assert.equal(hit[0]?.exit, 100);
    const blocked = gapFillCandidates("AAA", false, bars, new Set(["2024-03-05"]), ok, spy, { from: "2024-03-01", to: "2024-03-31" });
    assert.equal(blocked.length, 0);
  });

  it("qualifies one large insider buy or two smaller buys inside ten sessions", () => {
    const sessions = ["2024-03-01", "2024-03-04", "2024-03-05", "2024-03-06", "2024-03-07", "2024-03-08", "2024-03-11", "2024-03-12", "2024-03-13", "2024-03-14", "2024-03-15", "2024-03-18"];
    const one = insiderFilingSignals([{ ticker: "AAA", owner: "1", filingDate: "2024-03-01", valueUsd: 100_000 }], sessions);
    assert.deepEqual(one, [{ ticker: "AAA", filingDate: "2024-03-01" }]);
    const two = insiderFilingSignals(
      [
        { ticker: "AAA", owner: "1", filingDate: "2024-03-01", valueUsd: 10 },
        { ticker: "AAA", owner: "2", filingDate: "2024-03-14", valueUsd: 10 },
        { ticker: "AAA", owner: "3", filingDate: "2024-04-01", valueUsd: 10 },
      ],
      sessions,
    );
    assert.deepEqual(two.map((row) => row.filingDate), ["2024-03-14"]);
    assert.equal(commonStockTitle("Class A Common Stock"), true);
    assert.equal(commonStockTitle("Preferred Stock"), false);
    assert.equal(insiderRole("OFFICER", "Chief Financial Officer"), true);
    assert.equal(insiderRole("OFFICER", "Vice President"), false);
    assert.equal(insiderRole("DIRECTOR", ""), true);
    assert.equal(footnoteIsPlan("Sold under a Rule 10b5-1 plan."), true);
    assert.equal(flagIsPlan("1"), true);
    assert.equal(flagIsPlan("0"), false);
  });

  it("holds a positive book that does not have enough trades, and fails a negative one", () => {
    assert.equal(windowVerdict({ totalUsd: 10, n: 4, ratio: 2, spyRatio: 1, lower: -1, nRequired: 30 }), "hold");
    assert.equal(windowVerdict({ totalUsd: -1, n: 40, ratio: 2, spyRatio: 1, lower: -1, nRequired: null }), "fail");
    assert.equal(windowVerdict({ totalUsd: 10, n: 40, ratio: 0.5, spyRatio: 1, lower: 0.2, nRequired: 10 }), "fail");
    assert.equal(windowVerdict({ totalUsd: 10, n: 40, ratio: 2, spyRatio: 1, lower: 0.2, nRequired: 10 }), "pass");
    assert.equal(overallVerdict(["pass", "hold"]), "hold");
    assert.equal(overallVerdict(["not-judged", "not-judged"]), "not-judged");
    assert.equal(overallVerdict(["pass", "fail"]), "fail");
    const same = bootstrapMean([2, 2, 2, 2], 0.02, 2.05, 20, 1);
    assert.equal(same.lower, 2);
    assert.equal(same.nRequired, 0);
  });
});
