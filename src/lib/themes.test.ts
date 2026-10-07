import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadWatchlist } from "./watchlist";
import { CRYPTO, SPACE, SOLAR, THEME_KEEP, themeOf } from "./themes";

describe("themes", () => {
  it("keeps SPCX and classifies space, crypto, and quantum edge cases", () => {
    assert.equal(themeOf("SPCX"), null);
    assert.equal(themeOf("ASTS"), "space");
    assert.equal(themeOf("RDW"), "space");
    assert.equal(themeOf("CORZ"), "crypto");
    assert.equal(themeOf("HOOD"), "crypto");
    assert.equal(themeOf("COIN"), "crypto");
    assert.equal(themeOf("APLD"), null);
    assert.equal(themeOf("EQIX"), null);
    assert.equal(themeOf("VSAT"), "space");
    assert.equal(themeOf("IRDM"), "space");
    assert.equal(themeOf("GSAT"), "space");
    assert.equal(themeOf("IONQ"), "quantum");
    assert.equal(themeOf("QMCO"), null);
  });

  it("covers every watchlist space ticker except SPCX", () => {
    const watch = loadWatchlist();
    for (const group of watch.groups) {
      if (group.id !== "space") continue;
      for (const row of group.tickers) {
        const t = row.ticker;
        if (t === THEME_KEEP) {
          assert.equal(themeOf(t), null);
          continue;
        }
        assert.equal(themeOf(t), "space", `${t} should be space theme`);
      }
    }
  });

  it("lists CORZ on crypto and has no duplicate solar tickers", () => {
    assert.ok(CRYPTO.includes("CORZ"));
    assert.ok(CRYPTO.includes("HOOD"));
    assert.equal(new Set(SOLAR).size, SOLAR.length);
    assert.equal(new Set(SPACE).size, SPACE.length);
  });
});
