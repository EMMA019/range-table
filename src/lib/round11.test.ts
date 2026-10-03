import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CRYPTO_EXCLUDE,
  LARGE_LOSS,
  NUCLEAR_EXCLUDE,
  SOLAR_EXCLUDE,
  dropReason,
  etfExitPrice,
  largeLoss,
  listsMatchRound7b,
  namedStat,
  themeExcluded,
  winsLost,
  type SleeveFill,
} from "./round11";

describe("stop-width filter", () => {
  const base = { ticker: "AAA", entry: 100, stop: 80, inWindow: true, voided: false } as const;

  it("skips only a fraction strictly above X and keeps an equal fraction", () => {
    assert.equal(dropReason({ ...base, mode: { kind: "width", x: 0.1 } }), "width");
    assert.equal(dropReason({ ...base, stop: 90, mode: { kind: "width", x: 0.1 } }), "keep");
    assert.equal(dropReason({ ...base, stop: 88, mode: { kind: "width", x: 0.12 } }), "keep");
    assert.equal(dropReason({ ...base, stop: 85, mode: { kind: "width", x: 0.15 } }), "keep");
    assert.equal(dropReason({ ...base, stop: 84.99, mode: { kind: "width", x: 0.15 } }), "width");
  });

  it("does not skip a flat or negative distance, a void, or a date outside the window", () => {
    assert.equal(dropReason({ ...base, stop: 100, mode: { kind: "width", x: 0.1 } }), "keep");
    assert.equal(dropReason({ ...base, stop: 110, mode: { kind: "width", x: 0.1 } }), "keep");
    assert.equal(dropReason({ ...base, voided: true, mode: { kind: "width", x: 0.1 } }), "keep");
    assert.equal(dropReason({ ...base, inWindow: false, mode: { kind: "width", x: 0.1 } }), "keep");
    assert.equal(dropReason({ ...base, mode: { kind: "baseline" } }), "keep");
  });

  it("throws when a width test has no stop", () => {
    assert.throws(() => dropReason({ ...base, stop: null, mode: { kind: "width", x: 0.1 } }), /損切りがない/);
    assert.throws(() => dropReason({ ...base, entry: 0, mode: { kind: "width", x: 0.12 } }), /損切りがない/);
  });
});

describe("hindsight exclusion", () => {
  it("uses the round-7b nuclear list, the mining descriptions, and no solar names", () => {
    assert.equal(listsMatchRound7b(), true);
    assert.deepEqual([...NUCLEAR_EXCLUDE], ["CEG", "TLN", "OKLO", "SMR", "CCJ", "LEU"]);
    assert.deepEqual([...CRYPTO_EXCLUDE], ["IREN", "CIFR", "WULF"]);
    assert.deepEqual([...SOLAR_EXCLUDE], []);
    assert.equal(themeExcluded("CEG"), true);
    assert.equal(themeExcluded("IREN"), true);
    assert.equal(themeExcluded("APLD"), false);
    assert.equal(themeExcluded("CORZ"), false);
    assert.equal(themeExcluded("BE"), false);
    assert.equal(themeExcluded("NVDA"), false);
    assert.equal(themeExcluded("SPCX"), false);
  });

  it("drops a theme name only when it is in the window and not voided", () => {
    assert.equal(dropReason({ ticker: "OKLO", entry: 10, stop: 9, inWindow: true, voided: false, mode: { kind: "theme" } }), "theme");
    assert.equal(dropReason({ ticker: "SPCX", entry: 10, stop: 1, inWindow: true, voided: false, mode: { kind: "theme" } }), "keep");
    assert.equal(dropReason({ ticker: "WULF", entry: 10, stop: null, inWindow: false, voided: false, mode: { kind: "theme" } }), "keep");
    assert.equal(dropReason({ ticker: "CIFR", entry: 10, stop: null, inWindow: true, voided: true, mode: { kind: "theme" } }), "keep");
  });
});

describe("round-11 comparisons", () => {
  const base: SleeveFill[] = [
    { ticker: "NBIS", entryDate: "a", pnlUsd: 12, sleeve: "stock" },
    { ticker: "NBIS", entryDate: "b", pnlUsd: -70, sleeve: "stock" },
    { ticker: "ENPH", entryDate: "a", pnlUsd: -61, sleeve: "stock" },
    { ticker: "SOXX", entryDate: "c", pnlUsd: 5, sleeve: "etf" },
    { ticker: "SOXX", entryDate: "d", pnlUsd: -71.65, sleeve: "etf" },
  ];
  const next: SleeveFill[] = [
    { ticker: "NBIS", entryDate: "a", pnlUsd: 12, sleeve: "stock" },
    { ticker: "SOXX", entryDate: "c", pnlUsd: 5, sleeve: "etf" },
    { ticker: "SOXX", entryDate: "e", pnlUsd: 8, sleeve: "etf" },
  ];

  it("counts a lost win by ticker and entry date", () => {
    assert.equal(winsLost(base, next, "stock"), 0);
    assert.equal(winsLost(base, base, "stock"), 0);
    assert.equal(winsLost([{ ticker: "CRDO", entryDate: "a", pnlUsd: 4, sleeve: "stock" }], next, "stock"), 1);
    assert.equal(winsLost(base, next, "etf"), 0);
    assert.equal(winsLost([{ ticker: "SOXX", entryDate: "c", pnlUsd: 5, sleeve: "etf" }], [], "etf"), 1);
  });

  it("sums losses at or below -$60 and keeps a ticker that was not filled", () => {
    assert.equal(LARGE_LOSS, -60);
    assert.deepEqual(largeLoss(base), { n: 3, usd: -202.65 });
    assert.deepEqual(largeLoss([{ pnlUsd: -60 }, { pnlUsd: -59.99 }]), { n: 1, usd: -60 });
    const nbis = namedStat(base, next, "NBIS");
    assert.equal(nbis.n, 1);
    assert.equal(nbis.pnlUsd, 12);
    assert.equal(nbis.removedN, 1);
    assert.equal(nbis.removedUsd, -70);
    assert.equal(nbis.removedLossUsd, -70);
    const enph = namedStat(base, next, "ENPH");
    assert.equal(enph.n, 0);
    assert.equal(enph.removedN, 1);
    assert.equal(enph.removedLossUsd, -61);
    assert.equal(namedStat(base, next, "CVNA").n, 0);
    assert.equal(namedStat(base, next, "CVNA").removedN, 0);
  });

  it("sells an ETF stop at the open when that open is through the box low", () => {
    assert.equal(etfExitPrice({ reason: "stop", entryDate: "a", exitDate: "b", open: 9, close: 11, stop: 10, target: 20 }), 9);
    assert.equal(etfExitPrice({ reason: "stop", entryDate: "a", exitDate: "b", open: 10, close: 11, stop: 10, target: 20 }), 11);
    assert.equal(etfExitPrice({ reason: "target", entryDate: "a", exitDate: "b", open: 21, close: 19, stop: 10, target: 20 }), 21);
    assert.equal(etfExitPrice({ reason: "target", entryDate: "a", exitDate: "b", open: 19, close: 22, stop: 10, target: 20 }), 20);
    assert.equal(etfExitPrice({ reason: "window", entryDate: "a", exitDate: "b", open: 1, close: 8, stop: 10, target: 20 }), 8);
    assert.equal(etfExitPrice({ reason: "preempted", entryDate: "a", exitDate: "b", open: 7, close: 8, stop: 10, target: 20 }), 7);
  });
});
