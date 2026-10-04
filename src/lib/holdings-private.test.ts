import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { reviewAlerts, reviewBreakStart } from "./alerts-review";
import { parseHoldingsJson, type HoldingsConfig } from "./holdings";
import { buildHoldingsView, type QuoteInput } from "./holdings-view";
import { nextTradeDate, precheck } from "./precheck";
import { bearerOk, configuredPasscode, createLoginLimiter, signSession, verifySession } from "./private-auth";
import type { Bar, Quote } from "./types";

function quote(partial: Partial<Quote> = {}): Quote {
  return {
    close: 100,
    closeDate: "2026-10-01",
    ma20: 100,
    devPct: 0,
    low20: 90,
    high20: 120,
    priorHigh20: 120,
    boxPct: 33,
    atr14: 4,
    shares10: 3,
    cost10: 300,
    brokeHigh: false,
    gapWarning: false,
    maSlopePct: 0,
    volume: 1,
    avgVolume20: 1,
    volumeRatio: 1,
    avgDollarVolume20: 1,
    line15: 94.5,
    line25: 97.5,
    line35: 100.5,
    reboundDays: 2,
    entrySignal: "in_ok",
    ...partial,
  };
}

const q = (partial: Partial<Quote> = {}): QuoteInput => ({ quote: quote(partial), stale: false, error: null });

/** Synthetic holdings only. */
const CONFIG: HoldingsConfig = parseHoldingsJson(
  JSON.stringify({
    holdings: [
      { ticker: "AAA", shares: 3, avgCost: 90, reviewLine: 96 },
      { ticker: "BBB", shares: 2, avgCost: 60, reviewLine: 40 },
      { ticker: "CCC", shares: 1 },
      { ticker: "ONDS", shares: 50, reviewLine: 1 },
    ],
    cash: { usdSettled: 100, usdUnsettled: [{ amountUsd: 200, settleDate: "2026-10-06" }], jpy: 10_000 },
    defenseLineJpy: 50_000,
  }),
);

function view(config: HoldingsConfig = CONFIG) {
  return buildHoldingsView({
    config,
    quotes: { AAA: q({ close: 100, atr14: 4 }), BBB: q({ close: 50, atr14: 2.5 }), CCC: { quote: null, stale: false, error: "日足が無い" } },
    earnings: {},
    usdJpy: { rate: 150, date: "2026-10-01" },
    today: "2026-10-02",
  });
}

describe("private auth", () => {
  it("needs a passcode of 8+ characters", () => {
    assert.equal(configuredPasscode({}), null);
    assert.equal(configuredPasscode({ HOLDINGS_PASSCODE: "short" }), null);
    assert.equal(configuredPasscode({ HOLDINGS_PASSCODE: " long-enough " }), "long-enough");
  });

  it("verifies its own session and rejects tampering, expiry and a changed passcode", () => {
    const now = Date.UTC(2026, 9, 2);
    const cookie = signSession("passcode-one", now);
    assert.equal(verifySession(cookie, "passcode-one", now + 1000), true);
    assert.equal(verifySession(cookie, "passcode-two", now + 1000), false);
    assert.equal(verifySession(cookie, "passcode-one", now + 31 * 86_400_000), false);
    const [v, exp, sig] = cookie.split(".");
    assert.equal(verifySession(`${v}.${Number(exp) + 86_400_000}.${sig}`, "passcode-one", now), false);
    assert.equal(verifySession(`${v}.${exp}.${sig.slice(0, -2)}xx`, "passcode-one", now), false);
    assert.equal(verifySession(undefined, "passcode-one", now), false);
    assert.equal(verifySession(cookie, null, now), false);
  });

  it("accepts the bearer token only when it is long enough and matches", () => {
    const env = { ALERTS_TOKEN: "0123456789abcdef-token" };
    assert.equal(bearerOk("Bearer 0123456789abcdef-token", env), true);
    assert.equal(bearerOk("bearer 0123456789abcdef-token", env), true);
    assert.equal(bearerOk("Bearer wrong", env), false);
    assert.equal(bearerOk(null, env), false);
    assert.equal(bearerOk("Bearer short", { ALERTS_TOKEN: "short" }), false);
  });

  it("pauses a client after repeated wrong passcodes", () => {
    const limiter = createLoginLimiter(3, 1000);
    for (let i = 0; i < 3; i++) limiter.fail("x", 0);
    assert.equal(limiter.blocked("x", 10), true);
    assert.equal(limiter.blocked("y", 10), false);
    assert.equal(limiter.blocked("x", 1001), false);
  });
});

describe("holdings view", () => {
  it("drops ONDS, weights to 100%, and sorts by ATRs left to the review line", () => {
    const v = view();
    assert.deepEqual(
      v.rows.map((row) => row.ticker),
      ["AAA", "BBB", "CCC"],
    );
    const weights = v.rows.reduce((sum, row) => sum + (row.weight ?? 0), 0);
    assert.ok(Math.abs(weights - 1) < 1e-9);
    const aaa = v.rows[0];
    assert.equal(aaa.toReviewAtr, 1);
    assert.equal(aaa.toReviewPct, 4);
    assert.equal(aaa.dollarsPerAtr, 12);
    assert.equal(aaa.unrealizedUsd, 30);
    assert.deepEqual(v.account.unpriced, ["CCC"]);
  });

  it("goes negative under the line", () => {
    const v = buildHoldingsView({ config: CONFIG, quotes: { AAA: q({ close: 94, atr14: 4 }) }, earnings: {}, usdJpy: null, today: "2026-10-02" });
    assert.equal(v.rows[0].toReviewAtr, -0.5);
    assert.ok(v.warnings.some((line) => line.includes("ドル円")));
    assert.equal(v.account.accountJpy, null);
  });

  it("values the account in yen with the defense-line cushion, now and at the review lines", () => {
    const { account } = view();
    assert.equal(account.stockUsd, 400);
    assert.equal(account.accountJpy, (400 + 100 + 200) * 150 + 10_000);
    assert.equal(account.cushionJpy, 115_000 - 50_000);
    assert.equal(account.atReviewJpy, (3 * 96 + 2 * 40 + 300) * 150 + 10_000);
    assert.equal(account.cushionAtReviewJpy, account.atReviewJpy! - 50_000);
    assert.deepEqual(account.unsettled, [{ amountUsd: 200, settleDate: "2026-10-06", settled: false }]);
  });
});

function trendBars(n: number, step: (i: number) => number): Bar[] {
  const bars: Bar[] = [];
  let c = 50;
  for (let i = 0; i < n; i++) {
    c *= 1 + step(i);
    const d = new Date(Date.UTC(2026, 5, 1 + i)).toISOString().slice(0, 10);
    bars.push({ date: d, o: c, h: c, l: c, c, v: 1 });
  }
  return bars;
}

describe("pre-buy check", () => {
  const wave = (i: number) => Math.sin(i * 1.7) * 0.02;
  const profit = { status: "profit" as const, source: "test", ttmNetIncome: null, trailingEps: 1 };
  const base = {
    quote: quote({ close: 100, low20: 90, atr14: 4 }),
    profitability: profit,
    bars: trendBars(70, wave),
    holdingBars: { AAA: trendBars(70, wave), BBB: trendBars(70, (i) => -wave(i)) },
    config: CONFIG,
    earnings: null,
    sectorId: "semi",
    tradeDate: "2026-10-09",
    today: "2026-10-02",
  };

  it("adds the buy to the weights and prices the fall to the 20-day low in yen", () => {
    const result = precheck({ ...base, ticker: "NEW", shares: 1, view: view() });
    const total = result.postWeights.reduce((sum, row) => sum + row.weight, 0);
    assert.ok(Math.abs(total - 1) < 1e-9);
    assert.equal(result.cost, 100);
    assert.equal(result.lossToLow20.usd, 10);
    assert.equal(result.lossToLow20.jpy, 1500);
    assert.equal(result.lossToLow20.cushionAfterJpy, 65_000 - 1500);
    assert.deepEqual(result.flags, ["corrHigh"], "AAA moves exactly like the candidate");
  });

  it("flags correlation above 0.6, but not a negative one", () => {
    const result = precheck({ ...base, ticker: "NEW", shares: 1, view: view() });
    const aaa = result.corr.find((row) => row.ticker === "AAA");
    const bbb = result.corr.find((row) => row.ticker === "BBB");
    assert.equal(aaa?.high, true);
    assert.ok(aaa?.value != null && aaa.value > 0.99);
    assert.equal(bbb?.high, false);
    assert.ok(bbb?.value != null && bbb.value < 0);
  });

  it("treats $450 as the edge for price and cost", () => {
    const at = precheck({ ...base, ticker: "NEW", shares: 1, price: 450, quote: quote({ close: 450, low20: 440, atr14: 20 }), view: view() });
    assert.ok(!at.flags.includes("priceOver450"));
    assert.ok(!at.flags.includes("costOver450"));
    const over = precheck({ ...base, ticker: "NEW", shares: 1, price: 450.01, quote: quote({ close: 450.01, low20: 440, atr14: 20 }), view: view() });
    assert.ok(over.flags.includes("priceOver450"));
  });

  it("warns about good-faith violations when unsettled money pays for the buy", () => {
    const result = precheck({ ...base, ticker: "NEW", shares: 2, view: view() });
    assert.ok(result.flags.includes("usesUnsettled"));
    assert.equal(result.settlement.fundsSettleBy, "2026-10-06");
    assert.match(result.settlement.note ?? "", /2026-10-06 より前に.*GFV/);
    const short = precheck({ ...base, ticker: "NEW", shares: 4, view: view() });
    assert.ok(short.flags.includes("cashShort"));
  });

  it("settles a Friday trade on Tuesday over Columbus Day", () => {
    const result = precheck({ ...base, ticker: "NEW", shares: 1, view: view() });
    assert.equal(result.settlement.settleDate, "2026-10-13");
  });

  it("stops on earnings within five days and on a breach of the defense line", () => {
    const earnings = { date: "2026-10-05", status: "confirmed" as const, state: "upcoming" as const, tradingDays: 1, warn: true };
    assert.ok(precheck({ ...base, ticker: "NEW", shares: 1, earnings, view: view() }).flags.includes("earnings5d"));
    const tight = { ...CONFIG, defenseLineJpy: 114_000 };
    const deep = precheck({ ...base, ticker: "NEW", shares: 1, quote: quote({ close: 100, low20: 50, atr14: 4 }), view: view(tight), config: tight });
    assert.equal(deep.lossToLow20.cushionAfterJpy, 1000 - 7500);
    assert.ok(deep.flags.includes("belowDefense"));
  });

  it("knows which session an order placed now fills in", () => {
    assert.equal(nextTradeDate(new Date("2026-10-02T14:00:00Z")), "2026-10-02", "Friday 10:00 ET");
    assert.equal(nextTradeDate(new Date("2026-10-02T21:00:00Z")), "2026-10-05", "Friday after the close");
    assert.equal(nextTradeDate(new Date("2026-10-03T15:00:00Z")), "2026-10-05", "Saturday");
  });
});

describe("review-line alerts", () => {
  const bars = (closes: number[]): Bar[] =>
    closes.map((c, i) => ({ date: `2026-09-${String(10 + i).padStart(2, "0")}`, o: c, h: c + 1, l: c - 1, c, v: 1 }));

  it("dates the break from the first close of the current run under the line", () => {
    assert.deepEqual(reviewBreakStart(bars([100, 94, 97, 95, 94]), 96), { start: "2026-09-13", days: 2, ongoing: false });
    assert.equal(reviewBreakStart(bars([100, 94, 97]), 96), null);
  });

  it("builds a stable review:{T}:{start} id, skips holdings without a line and ONDS", () => {
    const series = { AAA: bars([100, 98, 95, 94]), BBB: bars([50, 30, 20, 10]), ONDS: bars([1, 0.5, 0.4, 0.3]) };
    const now = new Date("2026-10-02T12:00:00Z");
    const items = reviewAlerts(CONFIG.holdings, series, now);
    assert.deepEqual(
      items.map((item) => item.id),
      ["review:AAA:2026-09-12", "review:BBB:2026-09-11"],
    );
    const later = reviewAlerts(CONFIG.holdings, { AAA: bars([100, 98, 95, 94, 93]) }, now);
    assert.equal(later[0].id, "review:AAA:2026-09-12");
    assert.equal(later[0].kind, "review_break");
  });

  it("keeps one id when the run is older than the stored bars", () => {
    const now = new Date("2026-10-02T12:00:00Z");
    const first = reviewAlerts(CONFIG.holdings, { AAA: bars([95, 94, 93]) }, now);
    const next = reviewAlerts(CONFIG.holdings, { AAA: bars([95, 94, 93, 92]).slice(1) }, now);
    assert.equal(first[0].id, "review:AAA:96-ongoing");
    assert.equal(next[0].id, first[0].id);
  });
});
