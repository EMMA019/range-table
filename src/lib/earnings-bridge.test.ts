import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { entryBeforeEarnings } from "./round2";
import { entryAfterEarnings, exitBarBeforeReaction, reactionDaysFrom } from "./earnings-bridge";

const sessions = ["2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05", "2024-01-08", "2024-01-09", "2024-01-10", "2024-01-11", "2024-01-12"];

describe("earnings window around the reaction day", () => {
  it("puts the reaction day on the after side and keeps five sessions on each side", () => {
    const reaction = ["2024-01-08"];
    assert.equal(entryBeforeEarnings("2024-01-02", reaction, sessions), true);
    assert.equal(entryBeforeEarnings("2024-01-05", reaction, sessions), true);
    assert.equal(entryBeforeEarnings("2024-01-08", reaction, sessions), false);
    assert.equal(entryAfterEarnings("2024-01-05", reaction, sessions), false);
    assert.equal(entryAfterEarnings("2024-01-08", reaction, sessions), true);
    assert.equal(entryAfterEarnings("2024-01-12", reaction, sessions), true);
    assert.equal(entryAfterEarnings("2024-01-12", ["2024-01-04"], sessions), false);
  });

  it("caps a hold on the session before the next reaction day", () => {
    const bars = sessions.map((date) => ({ date }));
    assert.equal(exitBarBeforeReaction(bars, "2024-01-03", ["2024-01-08"], sessions), "2024-01-05");
    assert.equal(exitBarBeforeReaction(bars, "2024-01-08", ["2024-01-08", "2024-01-12"], sessions), "2024-01-11");
    assert.equal(exitBarBeforeReaction(bars, "2024-01-12", ["2024-01-08"], sessions), null);
  });

  it("ignores an Item 2.02 filing that has no acceptance timestamp", () => {
    const parsed = reactionDaysFrom(
      [
        {
          form: ["8-K", "8-K", "8-K/A"],
          items: ["2.02", "2.02", "2.02"],
          acceptanceDateTime: ["2024-01-08T21:30:00.000Z", "", "2024-01-04T21:30:00.000Z"],
        },
      ],
      sessions,
    );
    assert.deepEqual(parsed.days, ["2024-01-09"]);
    assert.equal(parsed.undated, 1);
  });
});
