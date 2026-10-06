import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PICK_EARNINGS_BADGE, PICK_ENTRY_BADGE, PICK_WATCH_BADGE, TEAM_PICKS_EMPTY } from "./copy";
import { buildPickCard, lineDistancePct, loadTeamPicks, parseTeamPicks } from "./picks";
import type { PickQuote, TeamPick } from "./types";

const TODAY = "2026-10-01";

function raw(overrides: Record<string, unknown> = {}) {
  return {
    ticker: "vrt",
    name: "Vertiv",
    genre: "電力",
    thesis_facts: "受注残がある",
    thesis_hypothesis: "データセンター投資が続く",
    entry_line: 100,
    entry_basis: "20日安値の少し上",
    review_line: 150,
    review_basis: "直近高値",
    earnings_date: null,
    status: "候補",
    recommended_by: "田中",
    as_of: "2026-10-01",
    ...overrides,
  };
}

function quote(close: number): PickQuote {
  return {
    close,
    closeDate: "2026-09-30",
    boxPct: 40,
    low20: 90,
    high20: 140,
    volumeRatio: 1.2,
    atr14: 5,
    shares10: 2,
    cost10: 200,
    line15: 97.5,
    line25: 102.5,
    reboundDays: null,
    entrySignal: "early",
  };
}

function card(overrides: Record<string, unknown> = {}, close: number | null = 100) {
  const pick = parseTeamPicks([raw(overrides)])[0] as TeamPick;
  return buildPickCard(pick, close == null ? null : quote(close), close == null ? "日足がまだない" : null, TODAY);
}

describe("team picks", () => {
  it("loads the committed picks", () => {
    const picks = loadTeamPicks();
    assert.deepEqual(
      picks.map((pick) => pick.ticker),
      ["GOOGL", "AMZN", "CEG", "AKAM", "VRSK", "EOG", "MO", "GEHC", "MDT"],
    );
    assert.equal(picks.every((pick) => pick.asOf === picks[0]?.asOf), true);
    assert.match(picks[0]?.asOf ?? "", /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(picks.every((pick) => pick.recommendedBy === "Alex/Sarah/Nova/Colin"), true);
    assert.equal(picks.some((pick) => pick.ticker === "DLR"), false);
    assert.equal(picks.find((pick) => pick.ticker === "VRSK")?.thesisFacts.includes("箱16.5%"), true);
    assert.deepEqual(parseTeamPicks([]), []);
    assert.equal(TEAM_PICKS_EMPTY, "チームの推奨は朝に更新されます");
    assert.equal(PICK_ENTRY_BADGE, "エントリー圏");
    assert.equal(PICK_WATCH_BADGE, "監視のみ");
    assert.equal(PICK_EARNINGS_BADGE, "決算前・新規は避けて");
  });

  it("reads the committed fields and uppercases the ticker", () => {
    const [pick] = parseTeamPicks([raw()]);
    assert.equal(pick?.ticker, "VRT");
    assert.equal(pick?.thesisFacts, "受注残がある");
    assert.equal(pick?.entryLine, 100);
    assert.equal(pick?.earningsDate, null);
    assert.equal(pick?.status, "候補");
  });

  it("rejects a file that is not the expected shape", () => {
    assert.throws(() => parseTeamPicks({}), /配列/);
    assert.throws(() => parseTeamPicks([raw({ status: "買い" })]), /status/);
    assert.throws(() => parseTeamPicks([raw({ earnings_date: "10/08" })]), /earnings_date/);
    assert.throws(() => parseTeamPicks([raw({ entry_line: 0 })]), /entry_line/);
    assert.throws(() => parseTeamPicks([raw({ ticker: "" })]), /ticker/);
  });

  it("measures the percent from each line to the close", () => {
    assert.equal(lineDistancePct(90, 100), -10);
    assert.equal(lineDistancePct(125, 100), 25);
    assert.equal(lineDistancePct(null, 100), null);
    assert.equal(lineDistancePct(0, 100), null);
    const at = card({}, 90);
    assert.equal(at.entryDistancePct, -10);
    assert.equal(at.reviewDistancePct, (90 - 150) / 150 * 100);
  });

  it("marks entry zone at or below the entry line", () => {
    assert.equal(card({}, 100).entryZone, true);
    assert.equal(card({}, 90).entryZone, true);
    assert.equal(card({}, 100.01).entryZone, false);
    assert.equal(card({}, null).entryZone, false);
  });

  it("marks watch-only from status or a close above $450", () => {
    assert.equal(card({ status: "監視のみ" }, 100).watchOnly, true);
    assert.equal(card({}, 450).watchOnly, false);
    assert.equal(card({}, 451).watchOnly, true);
    assert.equal(card({ status: "監視のみ" }, null).watchOnly, true);
    assert.equal(card({}, null).watchOnly, false);
  });

  it("warns when earnings fall within five trading days", () => {
    assert.equal(card({ earnings_date: "2026-10-08" }).earningsWarn, true);
    assert.equal(card({ earnings_date: "2026-10-01" }).earningsWarn, true);
    assert.equal(card({ earnings_date: "2026-10-09" }).earningsWarn, false);
    assert.equal(card({ earnings_date: "2026-09-30" }).earningsWarn, false);
    assert.equal(card({ earnings_date: null }).earningsWarn, false);
  });
});
