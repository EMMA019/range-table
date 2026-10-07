import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { yahooSymbol, yahooSymbolCandidates } from "./yahoo-symbol";

describe("yahoo share-class symbols", () => {
  it("asks Yahoo for the hyphen form of dotted class shares", () => {
    assert.equal(yahooSymbol("brk.b"), "BRK-B");
    assert.equal(yahooSymbol("BF.B"), "BF-B");
    assert.equal(yahooSymbol("AAPL"), "AAPL");
    assert.equal(yahooSymbol("^VIX"), "^VIX");
  });

  it("tries the other separator only after a 404 on the first form", () => {
    assert.deepEqual(yahooSymbolCandidates("BRK.B"), ["BRK-B", "BRK.B"]);
    assert.deepEqual(yahooSymbolCandidates("AAPL"), ["AAPL"]);
  });
});
