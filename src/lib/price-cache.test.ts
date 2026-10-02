import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { closeIsProvisional, etWallTimeMs, minutesEt } from "./calendar";
import { CACHE_TTL_MS, ERROR_RETRY_MS } from "./constants";
import { dueSymbols, isDue, isStale, mergeOutcome, missingSymbols, oldestOkAt, type CacheBody } from "./price-cache";
import type { Bar } from "./types";

const bar = (date: string, c = 10): Bar => ({ date, o: c, h: c, l: c, c, v: 1 });
const ET_NOON_OCT1 = Date.parse("2026-10-01T16:00:00Z");

describe("price cache", () => {
  it("keeps the last good bars when a refetch fails", () => {
    const good = mergeOutcome(undefined, { bars: [bar("2026-09-30")], droppedPartial: false }, ET_NOON_OCT1);
    const failed = mergeOutcome(good, { error: "HTTP 429" }, ET_NOON_OCT1 + CACHE_TTL_MS);
    assert.deepEqual(failed.bars, good.bars);
    assert.equal(failed.error, "HTTP 429");
    assert.equal(failed.okAt, good.okAt);
    assert.equal(isStale(failed), true);
    assert.equal(isStale(good), false);
    assert.equal(isStale(mergeOutcome(undefined, { error: "x" }, 0)), false);
  });

  it("retries errors after two minutes, not the full TTL", () => {
    const failed = mergeOutcome(undefined, { error: "HTTP 500" }, ET_NOON_OCT1);
    assert.equal(isDue(failed, ET_NOON_OCT1 + ERROR_RETRY_MS - 1), false);
    assert.equal(isDue(failed, ET_NOON_OCT1 + ERROR_RETRY_MS), true);
    const good = mergeOutcome(undefined, { bars: [bar("2026-09-30")], droppedPartial: false }, ET_NOON_OCT1);
    assert.equal(isDue(good, ET_NOON_OCT1 + ERROR_RETRY_MS), false);
    assert.equal(isDue(good, ET_NOON_OCT1 + CACHE_TTL_MS), true);
    assert.equal(isDue(undefined, 0), true);
  });

  it("refetches a provisional close once it is final at 16:20 ET", () => {
    const fetchedAt = Date.parse("2026-10-01T20:05:00Z");
    const entry = mergeOutcome(undefined, { bars: [bar("2026-10-01")], droppedPartial: false }, fetchedAt);
    const final = Date.parse("2026-10-01T20:20:00Z");
    assert.equal(entry.refreshAfter, final);
    assert.equal(isDue(entry, final - 1), false);
    assert.equal(isDue(entry, final), true);
    const later = mergeOutcome(undefined, { bars: [bar("2026-10-01")], droppedPartial: false }, final + 60_000);
    assert.equal(later.refreshAfter, undefined);
  });

  it("lists due and missing symbols and the oldest successful fetch", () => {
    const cache: CacheBody = {
      v: 4,
      version: 1,
      series: {
        AAA: mergeOutcome(undefined, { bars: [bar("2026-09-30")], droppedPartial: false }, 1_000),
        BBB: mergeOutcome(undefined, { bars: [bar("2026-09-30")], droppedPartial: false }, 5_000),
        CCC: mergeOutcome(undefined, { error: "x" }, 5_000),
      },
    };
    assert.deepEqual(dueSymbols(cache, ["AAA", "BBB", "CCC", "DDD"], 5_000 + ERROR_RETRY_MS), ["CCC", "DDD"]);
    assert.deepEqual(missingSymbols(cache, ["AAA", "DDD"]), ["DDD"]);
    assert.equal(oldestOkAt(cache, ["AAA", "BBB", "CCC"], 0), 1_000);
    assert.equal(oldestOkAt(cache, ["CCC"], 42), 42);
    assert.deepEqual(dueSymbols(null, ["AAA"], 0), ["AAA"]);
  });
});

describe("Eastern time helpers", () => {
  it("converts ET wall time across daylight saving", () => {
    assert.equal(etWallTimeMs("2026-10-01", 16 * 60), Date.parse("2026-10-01T20:00:00Z"));
    assert.equal(etWallTimeMs("2026-12-01", 16 * 60), Date.parse("2026-12-01T21:00:00Z"));
    assert.equal(minutesEt(new Date("2026-12-01T21:20:00Z")), 16 * 60 + 20);
  });

  it("treats today's bar as provisional until 16:20 ET", () => {
    assert.equal(closeIsProvisional("2026-10-01", new Date("2026-10-01T20:10:00Z")), true);
    assert.equal(closeIsProvisional("2026-10-01", new Date("2026-10-01T20:20:00Z")), false);
    assert.equal(closeIsProvisional("2026-09-30", new Date("2026-10-01T20:10:00Z")), false);
    assert.equal(closeIsProvisional(null), false);
  });
});
