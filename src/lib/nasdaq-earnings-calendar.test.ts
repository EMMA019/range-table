import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseNasdaqCalendarDay } from "./nasdaq-earnings-calendar";

describe("nasdaq earnings calendar", () => {
  it("parses symbol rows", () => {
    const json = {
      data: {
        rows: [{ symbol: "ORCL" }, { symbol: "nke" }, { name: "no symbol" }],
      },
    };
    assert.deepEqual(parseNasdaqCalendarDay(json), ["ORCL", "NKE"]);
  });
});
