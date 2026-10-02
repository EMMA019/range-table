import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EPS_FAIL_TTL_MS, EPS_RATE_LIMIT_TTL_MS, EPS_TIMEOUT_TTL_MS } from "./constants";
import { computePe, epsIsFresh, epsTtlMs, formatPe, hasEpsValue, isRecovering, parseQuotePage, parseQuoteSummary, parseV7Quotes, peView, pickEpsBatch } from "./pe";

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
      error: null,
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
      { trailingEps: 1.5, forwardEps: 2, error: null },
    );
  });

  it("returns an empty snapshot when the modules have no EPS", () => {
    assert.deepEqual(parseQuoteSummary({ quoteSummary: { result: [{}] } }), {
      trailingEps: null,
      forwardEps: null,
      error: null,
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
    const recovering = peView(200, { trailingEps: 2, forwardEps: 8, error: null });
    assert.equal(recovering.trailingPe, 100);
    assert.equal(recovering.forwardPe, 25);
    assert.equal(recovering.recovering, true);
    assert.equal(isRecovering(20, 10), true);
    assert.equal(isRecovering(19.99, 10), false);

    const loss = peView(120.21, { trailingEps: -2.16, forwardEps: 2.06208, error: null });
    assert.equal(loss.trailingPe, null);
    assert.equal(loss.forwardPe, 120.21 / 2.06208);
    assert.equal(loss.recovering, false);
    assert.equal(formatPe(120.21, loss.trailingEps), "赤字");
    assert.equal(peView(null, null).recovering, false);
    assert.equal(peView(null, null).error, "EPSを取得中");
  });

  it("reads v7 quote EPS and keeps a failed read retryable", () => {
    const parsed = parseV7Quotes({
      quoteResponse: {
        result: [
          { symbol: "vrt", epsTrailingTwelveMonths: 4.43, epsForward: 9.12236 },
          { symbol: "ONDS", epsTrailingTwelveMonths: -0.03, epsForward: -0.02 },
          { symbol: "NONE", epsTrailingTwelveMonths: null, epsForward: null },
        ],
        error: null,
      },
    });
    assert.equal(parsed[0]?.ticker, "VRT");
    assert.equal(parsed[0]?.trailingEps, 4.43);
    assert.equal(hasEpsValue(parsed[2]), false);

    const now = 1_700_000_000_000;
    const empty = { trailingEps: null, forwardEps: null, fetchedAt: now - 11 * 60 * 1000 };
    const filled = { trailingEps: 4.43, forwardEps: 9.12, fetchedAt: now - 11 * 60 * 1000 };
    assert.equal(epsIsFresh(empty, now), false);
    assert.equal(epsIsFresh(filled, now), true);
    assert.equal(epsIsFresh({ ...filled, fetchedAt: now - 25 * 60 * 60 * 1000 }, now), false);
    assert.equal(EPS_FAIL_TTL_MS, 10 * 60 * 1000);
    assert.equal(EPS_TIMEOUT_TTL_MS, 60 * 1000);
    assert.equal(EPS_RATE_LIMIT_TTL_MS, 3 * 60 * 1000);

    const recentTimeout = { trailingEps: null, forwardEps: null, fetchedAt: now - 30_000, error: "timeout" };
    const oldTimeout = { trailingEps: null, forwardEps: null, fetchedAt: now - 90_000, error: "timeout" };
    const recentLimit = { trailingEps: null, forwardEps: null, fetchedAt: now - 60_000, error: "quote page HTTP 429" };
    assert.equal(epsTtlMs(recentTimeout), EPS_TIMEOUT_TTL_MS);
    assert.equal(epsIsFresh(recentTimeout, now), true);
    assert.equal(epsIsFresh(oldTimeout, now), false);
    assert.equal(epsIsFresh(recentLimit, now), true);
    assert.equal(epsIsFresh({ ...recentLimit, fetchedAt: now - 4 * 60 * 1000 }, now), false);

    const quotes = {
      FRESH: { trailingEps: 1, forwardEps: 2, fetchedAt: now - 1000, error: null },
      FAIL: { trailingEps: null, forwardEps: null, fetchedAt: now - 5 * 60 * 1000, error: "HTTP 401" },
      TOUT: recentTimeout,
      OLDTO: oldTimeout,
      OLDFAIL: { trailingEps: null, forwardEps: null, fetchedAt: now - 11 * 60 * 1000, error: "EPSが空" },
    };
    assert.deepEqual(pickEpsBatch(["FRESH", "FAIL", "TOUT", "NEW", "OLDTO", "OLDFAIL"], quotes, now, 10), [
      "NEW",
      "OLDFAIL",
      "OLDTO",
    ]);
    assert.deepEqual(pickEpsBatch(["FRESH", "FAIL", "TOUT", "NEW", "OLDTO", "OLDFAIL"], quotes, now, 2), [
      "NEW",
      "OLDFAIL",
    ]);

    const failed = peView(241.31, { trailingEps: null, forwardEps: null, error: "quoteSummary HTTP 401 Invalid Crumb" });
    assert.equal(failed.trailingPe, null);
    assert.equal(failed.error, "データ元がEPSを返さなかった");
    assert.match(failed.errorDetail ?? "", /HTTP 401/);
    const ok = peView(241.31, { trailingEps: 4.43, forwardEps: 9.12236, error: null });
    assert.equal(ok.error, null);
    assert.equal(ok.trailingPe, 241.31 / 4.43);
  });

  it("reads EPS embedded in a Yahoo quote page", () => {
    const escaped = String.raw`trailingEps\":{\"raw\":4.43,\"fmt\":\"4.43\"},\"forwardEps\":{\"raw\":9.12,\"fmt\":\"9.12\"}`;
    assert.deepEqual(parseQuotePage(escaped), { trailingEps: 4.43, forwardEps: 9.12, error: null });
    const plain = `"trailingEps":{"raw":-2.16,"fmt":"-2.16"},"forwardEps":{"raw":2.06,"fmt":"2.06"}`;
    assert.deepEqual(parseQuotePage(plain), { trailingEps: -2.16, forwardEps: 2.06, error: null });
    assert.equal(parseQuotePage("<html>consent</html>"), null);
  });
});
