import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Feat } from "./backtest-study";
import { loadWatchlist } from "./watchlist";
import { crashBlocksFirstBuy, inLiveBand, passVerdict, stabilizationOk } from "./round17";
import { CRYPTO, SOLAR, SPACE_STATIC, THEME_KEEP, themeExclusionSet } from "./study-theme-lists";

describe("round-17 universe", () => {
  it("keeps SPCX and excludes watchlist space names", () => {
    const watch = loadWatchlist();
    const { set, spaceFromWatchlist } = themeExclusionSet(watch);
    assert.equal(set.has("SPCX"), false);
    assert.equal(set.has("ASTS"), true);
    assert.equal(set.has("RKLB"), true);
    for (const t of spaceFromWatchlist) assert.notEqual(t, THEME_KEEP);
    assert.ok(CRYPTO.includes("CORZ"));
    assert.ok(SPACE_STATIC.includes("BKSY"));
    assert.equal(SOLAR.length, 12);
  });

  it("live band bounds", () => {
    assert.equal(inLiveBand(22.9), false);
    assert.equal(inLiveBand(23), true);
    assert.equal(inLiveBand(37), true);
    assert.equal(inLiveBand(37.1), false);
  });

  it("crash and stabilization filters", () => {
    const mk = (partial: Partial<Feat>): Feat =>
      ({
        date: "2024-01-05",
        o: 10,
        h: 11,
        l: 9,
        c: 10,
        v: 1,
        atr: 1,
        low20: 8,
        high20: 12,
        boxPct: 30,
        gapWarning: false,
        rebound: 0,
        ...partial,
      }) as Feat;
    const feats = [mk({ date: "2024-01-02", h: 15, c: 14 }), mk({ date: "2024-01-03" }), mk({ date: "2024-01-04" }), mk({ date: "2024-01-05", c: 9, h: 12 })];
    assert.equal(crashBlocksFirstBuy(feats, 3, 3), true);
    assert.equal(crashBlocksFirstBuy(feats, 3, 10), false);
    const stab = [mk({ date: "2024-01-03", l: 8, c: 9 }), mk({ date: "2024-01-04", l: 8.5, c: 9.5 }), mk({ date: "2024-01-05", l: 9, c: 10 })];
    assert.equal(stabilizationOk(stab, 2, 2), true);
    assert.equal(stabilizationOk([...stab.slice(0, 2), mk({ date: "2024-01-05", c: 8 })], 2, 2), false);
  });

  it("pass verdict", () => {
    const base = {
      id: "baseline" as const,
      window: "in" as const,
      trades: 100,
      winRate: 0.5,
      totalNet190Usd: 1000,
      avgNet190Usd: 10,
      mtmDdUsd: 200,
      maxConsecLosses: 5,
      stopOutRate: 0.1,
      lowDate: "x",
      lowUsd: 3000,
      engineTotalUsd: 1000,
    };
    const ok = { ...base, id: "stab-2" as const, mtmDdUsd: 180, maxConsecLosses: 4, trades: 80, totalNet190Usd: 900 };
    assert.equal(passVerdict(base, ok).kind, "pass");
    const bad = { ...base, id: "stab-3" as const, trades: 50 };
    assert.equal(passVerdict(base, bad).kind, "fail");
  });
});
