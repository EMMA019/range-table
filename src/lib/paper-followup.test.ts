import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  followupLine,
  measureFollowup,
  summarizeFollowup,
  type FollowupInput,
  type FollowupRecord,
} from "./paper-followup";
import { parseSignals } from "./paper-signals";

const noBench = {
  soxx5: null,
  soxx10: null,
  spy5: null,
  spy10: null,
  excess5_soxx: null,
  excess10_soxx: null,
};

const signal: FollowupInput = {
  signal_date: "2026-09-28",
  symbol: "ON",
  ref_close: 75.65,
  low20: 65.8,
  source: "morning_entry_near_到達",
};

function withSignal(after: number[], signalClose = 75.65): Array<{ date: string; c: number }> {
  const out = [{ date: signal.signal_date, c: signalClose }];
  const cursor = new Date(Date.UTC(2026, 8, 28));
  for (const c of after) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    out.push({ date: cursor.toISOString().slice(0, 10), c });
  }
  return out;
}

describe("notification follow-up", () => {
  it("is a hit only when the 10th close is above the ref and low20 holds", () => {
    const bars = withSignal([80, 81, 82, 83, 85.93, 86, 87, 88, 89, 90]);
    const row = measureFollowup(signal, bars);
    assert.equal(row.status, "hit");
    assert.equal(row.broke_low20, false);
    assert.equal(row.ret5, 13.59);
    assert.equal(row.ret10, 18.97);
    assert.equal(row.plus5_date, "2026-10-03");
    assert.equal(row.note, null);
    assert.equal(row.soxx5, null);
    assert.equal(row.spy5, null);
    assert.equal(row.excess5_soxx, null);
    assert.equal(row.excess10_soxx, null);
  });

  it("uses each benchmark's own close on the signal date and does not fill a missing bar", () => {
    const bars = withSignal([80, 81, 82, 83, 85.93, 86, 87, 88, 89, 90]);
    const soxx = withSignal([202, 204, 206, 208, 210, 212, 214, 216, 218, 230], 200);
    const spy = [{ date: "2026-10-01", c: 100 }];
    const row = measureFollowup(signal, bars, { soxx, spy });
    assert.equal(row.ret5, 13.59);
    assert.equal(row.ret10, 18.97);
    assert.equal(row.soxx5, 5);
    assert.equal(row.soxx10, 15);
    assert.equal(row.spy5, null);
    assert.equal(row.spy10, null);
    assert.equal(row.excess5_soxx, 8.59);
    assert.equal(row.excess10_soxx, 3.97);

    const short = measureFollowup(signal, bars, { soxx: withSignal([202, 204, 206, 208], 200), spy: null });
    assert.equal(short.soxx5, null);
    assert.equal(short.excess5_soxx, null);
    assert.equal(short.spy10, null);
  });

  it("is a miss when the 10th close is not above the ref close", () => {
    const flat = measureFollowup(signal, withSignal(Array.from({ length: 10 }, () => 75.65)));
    assert.equal(flat.status, "miss");
    assert.equal(flat.broke_low20, false);
    assert.equal(flat.ret10, 0);
    const down = measureFollowup(signal, withSignal(Array.from({ length: 10 }, () => 70)));
    assert.equal(down.status, "miss");
    assert.equal(down.ret10, -7.47);
  });

  it("misses immediately when a close breaks low20, and does not invent the missing 10th return", () => {
    const early = measureFollowup(signal, withSignal([80, 60, 70]));
    assert.equal(early.status, "miss");
    assert.equal(early.broke_low20, true);
    assert.equal(early.ret5, null);
    assert.equal(early.ret10, null);
    assert.equal(early.sessions_after, 3);

    const afterFive = measureFollowup(signal, withSignal([80, 81, 82, 83, 85.93, 65.79]));
    assert.equal(afterFive.status, "miss");
    assert.equal(afterFive.ret5, 13.59);
    assert.equal(afterFive.ret10, null);
    assert.equal(afterFive.broke_low20, true);
  });

  it("stays pending until the 10th bar exists, and a touch of low20 is not a break", () => {
    const four = measureFollowup(signal, withSignal([80, 81, 82, 83]));
    assert.equal(four.status, "pending");
    assert.equal(four.ret5, null);
    assert.equal(four.ret10, null);
    assert.equal(four.broke_low20, null);

    const nine = measureFollowup(signal, withSignal([80, 81, 82, 83, 85.93, 86, 87, 88, 89]));
    assert.equal(nine.status, "pending");
    assert.equal(nine.ret5, 13.59);
    assert.equal(nine.ret10, null);
    assert.equal(nine.broke_low20, null);

    const touch = measureFollowup(signal, withSignal([65.8, 80, 81, 82, 83, 84, 85, 86, 87, 90]));
    assert.equal(touch.status, "hit");
    assert.equal(touch.broke_low20, false);
  });

  it("ignores a break after the 10th session", () => {
    const bars = withSignal([...Array.from({ length: 10 }, () => 90), 10]);
    const row = measureFollowup(signal, bars);
    assert.equal(row.status, "hit");
    assert.equal(row.broke_low20, false);
  });

  it("does not estimate when the signal date is missing", () => {
    const row = measureFollowup(signal, [{ date: "2026-10-01", c: 90 }]);
    assert.equal(row.status, "pending");
    assert.equal(row.ret5, null);
    assert.equal(row.ret10, null);
    assert.equal(row.sessions_after, null);
    assert.equal(row.note, "通知日の足が無い");
  });

  it("says nothing is decided yet, and still shows the +5 median with its dates", () => {
    const records: FollowupRecord[] = [3.7, 13.59, -0.92].map((ret5, i) => ({
      ...signal,
      symbol: `N${i}`,
      ret5,
      ret10: null,
      broke_low20: null,
      status: "pending",
      plus5_date: "2026-10-05",
      plus10_date: null,
      sessions_after: 7,
      note: null,
      ...noBench,
    }));
    const summary = summarizeFollowup({
      source: "Yahoo日足",
      fetchedAtJst: "2026-10-08 07:04 JST",
      barsThrough: "2026-10-07",
      hitDefinition: "x",
      records: [...records, { ...records[0], symbol: "ONDS", status: "hit", ret10: 5, ret5: 99 }],
    });
    assert.equal(summary.total, 3);
    assert.equal(summary.decided, 0);
    assert.equal(summary.pending, 3);
    assert.equal(summary.hitRate, null);
    assert.equal(summary.ret5Median, 3.7);
    const line = followupLine(summary);
    assert.match(line, /判定済み 0 \/ 全3/);
    assert.match(line, /判定済みなし（\+10日の足待ち）/);
    assert.match(line, /未判定 3/);
    assert.match(line, /\+5日の中央値 \+3\.70%（同期間SOXX 中央値 —、SPY —、対SOXX超過 中央値 —。/);
    assert.match(line, /\+5日の終値がある3件、うちSOXX 0件・SPY 0件・対SOXX超過 0件/);
    assert.match(line, /2026-10-07/);
    assert.match(line, /2026-10-08 07:04 JST/);
    assert.equal(line.includes("的中率"), false);
    assert.equal(line.includes("ONDS"), false);
  });

  it("states the hit rate from decided rows only", () => {
    const row = (status: FollowupRecord["status"], ret5: number | null, symbol: string): FollowupRecord => ({
      ...signal,
      symbol,
      ret5,
      ret10: status === "pending" ? null : 1,
      broke_low20: status === "miss" ? true : status === "hit" ? false : null,
      status,
      plus5_date: ret5 == null ? null : "2026-10-05",
      plus10_date: status === "pending" ? null : "2026-10-12",
      sessions_after: 10,
      note: null,
      ...noBench,
    });
    const summary = summarizeFollowup({
      source: "Yahoo日足",
      fetchedAtJst: "2026-10-20 07:00 JST",
      barsThrough: "2026-10-17",
      records: [row("hit", 4, "AAA"), row("hit", 8, "BBB"), row("miss", -2, "CCC"), row("pending", 1, "DDD")],
    });
    assert.equal(summary.decided, 3);
    assert.equal(summary.hits, 2);
    assert.equal(summary.pending, 1);
    assert.equal(summary.hitRate, 66.7);
    assert.equal(summary.ret5Median, 2.5);
    assert.equal(summary.soxx5Median, null);
    const line = followupLine(summary);
    assert.match(line, /的中率 66\.7%/);
    assert.match(line, /的中 2 \/ 判定済み 3/);
    assert.match(line, /定義:/);
    assert.match(line, /未判定 1/);
    assert.equal(line.includes("判定済みなし"), false);
  });

  it("takes SOXX, SPY, and excess medians only from rows that already have a +5 return", () => {
    const row = (
      symbol: string,
      ret5: number | null,
      soxx5: number | null,
      spy5: number | null,
      excess5: number | null,
    ): FollowupRecord => ({
      ...signal,
      symbol,
      ret5,
      ret10: null,
      broke_low20: null,
      status: "pending",
      plus5_date: ret5 == null ? null : "2026-10-05",
      plus10_date: null,
      sessions_after: 7,
      note: null,
      soxx5,
      soxx10: null,
      spy5,
      spy10: null,
      excess5_soxx: excess5,
      excess10_soxx: null,
    });
    const summary = summarizeFollowup({
      source: "Yahoo日足",
      fetchedAtJst: "2026-10-08 07:04 JST",
      barsThrough: "2026-10-07",
      records: [
        row("AAA", 10, 4, 2, 6),
        row("BBB", 2, 8, 1, -6),
        row("CCC", null, 100, 100, 100),
        row("DDD", 6, null, 3, null),
      ],
    });
    assert.equal(summary.ret5Median, 6);
    assert.equal(summary.ret5Count, 3);
    assert.equal(summary.soxx5Median, 6);
    assert.equal(summary.soxx5Count, 2);
    assert.equal(summary.spy5Median, 2);
    assert.equal(summary.spy5Count, 3);
    assert.equal(summary.excess5Median, 0);
    assert.equal(summary.excess5Count, 2);
    const line = followupLine(summary);
    assert.match(line, /\+5日の中央値 \+6\.00%（同期間SOXX 中央値 \+6\.00%、SPY \+2\.00%、対SOXX超過 中央値 0%。/);
    assert.match(line, /\+5日の終値がある3件、うちSOXX 2件・SPY 3件・対SOXX超過 2件/);
  });

  it("keeps the seeded ref closes and matches follow-up rows to the log", () => {
    const root = process.cwd();
    const signals = parseSignals(JSON.parse(fs.readFileSync(path.join(root, "data/paper/signals.json"), "utf8")));
    const followup = summarizeFollowup(JSON.parse(fs.readFileSync(path.join(root, "data/paper/followup.json"), "utf8")));
    assert.ok(signals.length >= 21);
    assert.equal(followup.total, signals.length);
    assert.equal(signals.some((row) => row.symbol === "ONDS"), false);
    assert.equal(signals.some((row) => row.symbol === "HOOD"), false);
    for (const symbol of ["GDDY", "HPQ", "JBL", "CDW", "CVNA", "STX"]) {
      assert.equal(signals.some((row) => row.symbol === symbol), true, symbol);
    }
    const on = signals.find((row) => row.symbol === "ON" && row.signal_date === "2026-09-28");
    assert.equal(on?.ref_close, 75.65);
    assert.equal(on?.low20, 65.8);
    assert.equal(on?.source, "morning_entry_near_到達");
    assert.match(followup.fetchedAtJst, /JST$/);
  });
});
