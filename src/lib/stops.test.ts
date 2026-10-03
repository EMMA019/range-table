import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classStop } from "./stops";

describe("stop comparison", () => {
  it("keeps the box low for names outside the semiconductor class", () => {
    assert.equal(classStop("pct5", false, 100, 4), 100);
    assert.equal(classStop("pct10", false, 100, 4), 100);
    assert.equal(classStop("atr15", false, 100, 4), 100);
    assert.equal(classStop("low", true, 100, 4), 100);
  });

  it("lowers only the class stop by the locked amount", () => {
    assert.equal(classStop("pct5", true, 100, 4), 95);
    assert.equal(classStop("pct10", true, 100, 4), 90);
    assert.equal(classStop("atr15", true, 100, 4), 94);
  });
});
