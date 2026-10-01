import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computePe, formatPe, isRecovering, parseQuoteSummary, peView } from "./pe";

const aapl = {
  quoteSummary: {
    result: [
      {
        defaultKeyStatistics: {
          trailingEps: { raw: 8.83, fmt: "8.83" },
          forwardEps: { raw: 9.58285, fmt: "9.58" },
          pegRatio: { raw: 2.64, fmt: "2.64" },
        },
        financialData: {
          trailingEps: { raw: 1, fmt: "1.00" },
          forwardEps: { raw: 1, fmt: "1.00" },
        },
      },
    ],
    error: null,
  },
};

describe("parseQuoteSummary", () => {
  it("reads trailing and forward EPS from defaultKeyStatistics", () => {
    assert.deepEqual(parseQuoteSummary(aapl), {
      trailingEps: 8.83,
      forwardEps: 9.58285,
    });
  });

  it("falls back to financialData and accepts a bare number", () => {
    assert.deepEqual(
      parseQuoteSummary({
        quoteSummary: {
          result: [
            {
              defaultKeyStatistics: { trailingEps: {} },
              financialData: { trailingEps: { fmt: "1.50" }, forwardEps: 2 },
            },
          ],
        },
      }),
      { trailingEps: 1.5, forwardEps: 2 },
    );
  });

  it("returns an empty snapshot when the modules have no EPS", () => {
    assert.deepEqual(parseQuoteSummary({ quoteSummary: { result: [{}] } }), {
      trailingEps: null,
      forwardEps: null,
    });
  });

  it("returns null when the payload has no result", () => {
    assert.equal(parseQuoteSummary(null), null);
    assert.equal(parseQuoteSummary({ quoteSummary: { result: null, error: { code: "Not Found" } } }), null);
    assert.equal(parseQuoteSummary({ finance: { error: {} } }), null);
  });
});

describe("P/E from price and cached EPS", () => {
  it("divides the latest close by EPS and rounds to one decimal", () => {
    assert.equal(computePe(332.96, 8.83), 332.96 / 8.83);
    assert.equal(formatPe(332.96, 8.83), "37.7");
    assert.equal(formatPe(332.96, 9.58285), "34.7");
  });

  it("shows 赤字 for negative EPS and a dash when price or EPS is missing", () => {
    assert.equal(formatPe(120.21, -2.16), "赤字");
    assert.equal(formatPe(120.21, 2.06208), "58.3");
    assert.equal(formatPe(null, 2), "—");
    assert.equal(formatPe(10, null), "—");
    assert.equal(formatPe(10, 0), "—");
    assert.equal(formatPe(0, 2), "—");
    assert.equal(computePe(10, -1), null);
  });

  it("flags a trailing P/E at least twice the forward P/E", () => {
    const recovering = peView(200, { trailingEps: 2, forwardEps: 8 });
    assert.equal(recovering.trailingPe, 100);
    assert.equal(recovering.forwardPe, 25);
    assert.equal(recovering.recovering, true);
    assert.equal(isRecovering(20, 10), true);
    assert.equal(isRecovering(19.99, 10), false);

    const loss = peView(120.21, { trailingEps: -2.16, forwardEps: 2.06208 });
    assert.equal(loss.trailingPe, null);
    assert.equal(loss.forwardPe, 120.21 / 2.06208);
    assert.equal(loss.recovering, false);
    assert.equal(formatPe(120.21, loss.trailingEps), "赤字");
    assert.equal(peView(null, null).recovering, false);
  });
});
