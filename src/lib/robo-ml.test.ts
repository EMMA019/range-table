import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fitEnsemble, walkForward, type Row } from "./robo-ml";

describe("robo ensemble", () => {
  it("ridge recovers a straight line", () => {
    const rows = [];
    for (let i = 0; i < 30; i++) {
      const x = i - 15;
      rows.push({ x: [x, 0], y: 0.5 * x });
    }
    const model = fitEnsemble(rows, { trees: 0, lambdas: [0.01] });
    const pred = model.predict([10, 0]);
    assert.ok(Math.abs(pred.ridge - 5) < 0.15, `ridge ${pred.ridge}`);
    assert.equal(model.ridgeAbs.length, 2);
    assert.ok(model.ridgeAbs[0] > model.ridgeAbs[1]);
  });

  it("boosts a step without negative importance", () => {
    const rows = [];
    for (let i = 0; i < 40; i++) {
      const x = i < 20 ? -1 : 1;
      rows.push({ x: [x, i / 40], y: x });
    }
    const model = fitEnsemble(rows, { trees: 8, lambdas: [1], learningRate: 0.3, thresholds: 4 });
    const high = model.predict([1, 0.5]).y;
    const low = model.predict([-1, 0.5]).y;
    assert.ok(high > low);
    assert.ok(model.gbmGain.every((value) => value >= 0));
    assert.ok(model.gbmGain[0] >= model.gbmGain[1]);
  });

  it("walk-forward training never sees an unfinished label", () => {
    const rows: Row[] = [];
    for (let i = 0; i < 12; i++) rows.push({ x: [i], y: i * 0.01, labelEnd: (i + 1) * 10 });
    const seen: number[][] = [];
    walkForward(rows, [{ index: 40, x: [1] }, { index: 70, x: [2] }], {
      minTrain: 2,
      trees: 2,
      lambdas: [1],
      onTrain(index, labelEnds) {
        seen.push(labelEnds);
        assert.ok(labelEnds.every((end) => end <= index), `${labelEnds} at ${index}`);
      },
    });
    assert.equal(seen[0]?.length, 4);
    assert.equal(seen[1]?.length, 7);
  });

  it("a later label does not change an earlier forecast", () => {
    const rows: Row[] = [];
    for (let i = 0; i < 15; i++) rows.push({ x: [i - 7], y: (i - 7) * 0.02, labelEnd: i + 1 });
    const opts = { minTrain: 5, trees: 3, lambdas: [1], thresholds: 3 };
    const first = walkForward(rows, [{ index: 8, x: [1] }], opts).get(8);
    rows[14].y = 50;
    const second = walkForward(rows, [{ index: 8, x: [1] }], opts).get(8);
    assert.ok(first && second);
    assert.equal(first.y, second.y);
  });
});
