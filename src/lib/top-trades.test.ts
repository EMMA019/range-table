import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dedupeFills, exitLabel, profitLabel, topByPnl } from "./top-trades";

describe("top trade labels", () => {
  it("names a gap-through stop only when the planned fill is at the open", () => {
    assert.equal(exitLabel("stop", "open", true), "gap-through-stop");
    assert.equal(exitLabel("stop", "close", true), "stop");
    assert.equal(exitLabel("target", "intraday", true), "take-profit");
    assert.equal(exitLabel("timeout", "close", true), "timeout");
    assert.equal(exitLabel("stop", "open", false), "window");
  });

  it("maps the F1 status onto profit, loss, and unknown", () => {
    assert.equal(profitLabel("nonnegative"), "profit");
    assert.equal(profitLabel("negative"), "loss");
    assert.equal(profitLabel("unknown"), "unknown");
  });

  it("keeps one copy of the same fill and lists every universe it appeared in", () => {
    const rows = dedupeFills([
      { ticker: "AAA", entryDate: "2024-01-02", exitDate: "2024-01-04", pnlUsd: 10, seenIn: ["pit/oos"] },
      { ticker: "AAA", entryDate: "2024-01-02", exitDate: "2024-01-04", pnlUsd: 10, seenIn: ["adv/oos"] },
      { ticker: "AAA", entryDate: "2024-01-02", exitDate: "2024-01-04", pnlUsd: 9, seenIn: ["pit/in"] },
    ]);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0]?.seenIn, ["pit/oos", "adv/oos"]);
  });

  it("ranks winners by P&L descending", () => {
    const top = topByPnl(
      [
        { ticker: "B", entryDate: "2024-01-02", pnlUsd: 5 },
        { ticker: "A", entryDate: "2024-01-02", pnlUsd: 5 },
        { ticker: "C", entryDate: "2024-01-03", pnlUsd: 1 },
      ],
      2,
      "winner",
    );
    assert.deepEqual(top.map((row) => row.ticker), ["A", "B"]);
  });
});
