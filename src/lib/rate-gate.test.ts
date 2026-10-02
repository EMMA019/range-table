import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createRateGate } from "./rate-gate";

describe("rate gate", () => {
  it("doubles the pause on each 429 up to the cap, and clears on success", async () => {
    let clock = 0;
    const slept: number[] = [];
    const gate = createRateGate({
      baseMs: 1000,
      maxMs: 5000,
      now: () => clock,
      random: () => 0.5,
      sleep: async (ms) => {
        slept.push(ms);
        clock += ms;
      },
    });
    await gate.wait();
    assert.deepEqual(slept, []);
    assert.equal(gate.penalize(), 1000);
    await gate.wait();
    assert.deepEqual(slept, [1000]);
    assert.equal(gate.penalize(), 2000);
    assert.equal(gate.penalize(), 4000);
    assert.equal(gate.penalize(), 5000);
    assert.equal(gate.remainingMs(), 5000);
    gate.ok();
    clock += 5000;
    assert.equal(gate.penalize(), 1000);
  });

  it("adds jitter within ±20%", () => {
    const low = createRateGate({ baseMs: 1000, maxMs: 9000, now: () => 0, random: () => 0 });
    const high = createRateGate({ baseMs: 1000, maxMs: 9000, now: () => 0, random: () => 1 });
    assert.equal(low.penalize(), 800);
    assert.equal(high.penalize(), 1200);
  });
});
