import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { causalMomentum, studyRobo, summarizePath, type RoboPanel } from "./robo-backtest";
import { scaleYield } from "./robo-feed";
import { roboHoldingsFromEnv } from "./robo-holdings";
import {
  DEFAULT_BUDGET,
  ROBO_DISCLAIMER,
  ROBO_UNIVERSE,
  alignTo,
  buildPlan,
  decideShares,
  hitSentence,
  loadRoboLocal,
  priceRegime,
  recordHit,
  sanitizePositions,
  saveRoboLocal,
  sleeveCushion,
  verdictLine,
  weightsFor,
  emptyHit,
  type AssetFactor,
  type LiveFactors,
} from "./robo-model";

function baseFactors(patch: Partial<LiveFactors> = {}, assetPatch: (asset: AssetFactor) => AssetFactor = (asset) => asset): LiveFactors {
  const assets = ROBO_UNIVERSE.map((asset) =>
    assetPatch({
      ticker: asset.ticker,
      price: 100,
      trendUp: asset.group === "equity" || asset.group === "cushion",
      mom12: asset.group === "equity" || asset.group === "cushion" ? 0.08 : -0.02,
      vol60: 0.1,
      distSma: asset.group === "equity" || asset.group === "cushion" ? 0.04 : -0.04,
      forecast: null,
      ridge: null,
      gbm: null,
    }),
  );
  return {
    asOf: "2024-01-31",
    regime: "risk_on",
    cashTicker: "BIL",
    shyOk: true,
    assets,
    spyForecast: null,
    spyRidge: null,
    spyGbm: null,
    spyVolForecast: null,
    volCut: null,
    modelReady: false,
    trainMonths: 0,
    ...patch,
  };
}

function sumWeights(weights: Record<string, number>): number {
  return Object.values(weights).reduce((sum, weight) => sum + weight, 0);
}

describe("robo allocation", () => {
  it("names a defensive and an offensive month in one line", () => {
    assert.equal(priceRegime({ above200: false, drawdown: -0.12, highVol: true }), "risk_off");
    assert.equal(priceRegime({ above200: true, drawdown: -0.02, highVol: false }), "risk_on");
    const defensive = weightsFor(baseFactors({ regime: "risk_off" }), null);
    const offensive = weightsFor(baseFactors({ regime: "risk_on" }), 0.3);
    assert.ok(defensive.stockFraction < offensive.stockFraction);
    assert.match(verdictLine(defensive.weights), /^今月は守り寄り：/);
    assert.match(verdictLine(offensive.weights), /^今月は(攻め寄り|中立)：/);
    assert.ok(Math.abs(sumWeights(defensive.weights) - 1) < 1e-4);
    assert.ok(defensive.weights.QQQ == null || defensive.weights.QQQ <= 0.1201);
    assert.ok((defensive.weights.GLD ?? 0) <= 0.0801);
    assert.ok((defensive.weights.IEF ?? 0) <= 0.0801);
    assert.ok((defensive.weights.TLT ?? 0) <= 0.0501);
  });

  it("caps QQQ and keeps a missing cushion defensive", () => {
    const capped = weightsFor(
      baseFactors({}, (asset) => ({ ...asset, mom12: asset.ticker === "QQQ" ? 3 : asset.mom12 })),
      0.25,
    );
    assert.ok((capped.weights.QQQ ?? 0) <= 0.1201);
    const thin = weightsFor(baseFactors({ regime: "risk_on" }), null);
    const thick = weightsFor(baseFactors({ regime: "risk_on" }), 0.3);
    assert.ok(thin.stockFraction < thick.stockFraction);
  });

  it("cuts equity when the SPY forecast is down, and allows a small gold sleeve only near the average", () => {
    const calm = weightsFor(baseFactors(), null);
    const down = weightsFor(
      baseFactors({
        modelReady: true,
        spyForecast: -0.04,
        spyRidge: -0.04,
        spyGbm: -0.04,
      }),
      null,
    );
    assert.equal(down.mlShift, "down");
    assert.ok(down.equityFraction < calm.equityFraction);

    const gold = weightsFor(
      baseFactors({ modelReady: true }, (asset) =>
        asset.ticker === "GLD"
          ? { ...asset, trendUp: false, mom12: -0.01, distSma: -0.01, forecast: 0.02, ridge: 0.02, gbm: 0.019 }
          : asset,
      ),
      0.1,
    );
    assert.ok((gold.weights.GLD ?? 0) > 0);
    assert.ok((gold.weights.GLD ?? 0) <= 0.08);

    const blocked = weightsFor(
      baseFactors({ modelReady: true }, (asset) =>
        asset.ticker === "GLD"
          ? { ...asset, trendUp: false, mom12: -0.2, distSma: -0.1, forecast: 0.05, ridge: 0.05, gbm: 0.05 }
          : asset,
      ),
      0.1,
    );
    assert.equal(blocked.weights.GLD ?? 0, 0);
  });

  it("skips a small drift and still exits a closed target", () => {
    assert.equal(decideShares({ price: 100, currentShares: 5, targetWeight: 0.51, budget: 1000 }).action, "hold");
    const open = decideShares({ price: 100, currentShares: 0, targetWeight: 0.4, budget: 1000 });
    assert.equal(open.action, "buy");
    assert.equal(open.shares, 4);
    const exit = decideShares({ price: 50, currentShares: 3, targetWeight: 0, budget: 1000 });
    assert.equal(exit.action, "sell");
    assert.equal(exit.shares, 0);
    const plan = buildPlan({
      weights: { SPY: 0.4, BIL: 0.6 },
      prices: { SPY: 100, BIL: 100 },
      budget: 1000,
      positions: [],
    });
    assert.equal(plan.orders, 2);
    assert.equal(plan.commissionUsd, 0.7);
    assert.equal(plan.lines.find((line) => line.ticker === "SPY")?.nextShares, 4);
  });

  it("keeps sleeve inputs on this device and drops anything that is not an ETF row", () => {
    const memory = new Map<string, string>();
    const storage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => memory.set(key, value),
      removeItem: (key: string) => memory.delete(key),
    };
    saveRoboLocal({ budget: 2500, positions: [{ ticker: "spy", shares: 1.5, avgCost: 400 }, { ticker: "ONDS", shares: 9, avgCost: 1 }] }, storage);
    const loaded = loadRoboLocal(storage);
    assert.equal(loaded.budget, 2500);
    assert.deepEqual(loaded.positions, [{ ticker: "SPY", shares: 1.5, avgCost: 400 }]);
    assert.equal(sanitizePositions([{ ticker: "ZZZZ", shares: 1 }, { ticker: "SHY", shares: 2 }]).map((row) => row.ticker).join(), "SHY");
    assert.equal(sleeveCushion(loaded.positions, { SPY: 420 }), 420 / 400 - 1);
    assert.equal(sleeveCushion([], {}), null);
    assert.equal(DEFAULT_BUDGET, 1000);
    assert.deepEqual(
      roboHoldingsFromEnv({
        ROBO_HOLDINGS_JSON: JSON.stringify({
          holdings: [
            { ticker: "SPY", shares: 2, avgCost: 400 },
            { ticker: "NVDA", shares: 1 },
          ],
        }),
      }),
      [{ ticker: "SPY", shares: 2, avgCost: 400 }],
    );
    assert.equal(scaleYield([{ date: "2020-01-02", c: 45 }])[0]?.c, 4.5);
    assert.equal(scaleYield([{ date: "2020-01-02", c: 4.5 }])[0]?.c, 4.5);
    assert.match(ROBO_DISCLAIMER, /発注・推奨ではありません/);
    assert.match(ROBO_DISCLAIMER, /最終判断はご自身/);
  });

  it("does not look backward when aligning a late print", () => {
    const aligned = alignTo(["2024-01-02", "2024-01-03", "2024-01-04"], [{ date: "2024-01-04", c: 30 }]);
    assert.deepEqual(aligned, [null, null, 30]);
    const filled = alignTo(["2024-01-02", "2024-01-03", "2024-01-04"], [
      { date: "2024-01-02", c: 10 },
      { date: "2024-01-04", c: 30 },
    ]);
    assert.equal(filled[1], 10);
  });

  it("states a coin-flip hit rate as not something to trust", () => {
    const hit = emptyHit();
    for (let i = 0; i < 40; i++) recordHit(hit, i % 2 === 0 ? "SPY" : "EFA", i % 2 === 0 ? "up" : "down", i % 2 === 0 ? 0.01 : 0.02);
    assert.ok((hit.rate ?? 0) < 0.53);
    assert.match(hitSentence(hit), /頼れない/);
  });
});

describe("robo walk-forward study", () => {
  const panel = syntheticPanel(520);

  it("ignores prices after the decision date", () => {
    const through = panel.prices.SPY[430].date;
    const opts = { throughDate: through, today: through, minTrain: 4, trees: 2, thresholds: 3, budgets: [1000] };
    const base = studyRobo(panel, opts);
    const crashed: RoboPanel = {
      prices: Object.fromEntries(Object.entries(panel.prices).map(([ticker, bars]) => [ticker, bars.map((bar) => (bar.date > through ? { ...bar, c: bar.c * 0.4 } : bar))])),
      vix: panel.vix?.map((bar) => (bar.date > through ? { ...bar, c: 80 } : bar)),
      tnx: panel.tnx,
      irx: panel.irx,
    };
    const other = studyRobo(crashed, opts);
    assert.ok(!("error" in base), "error" in base ? base.error : "");
    assert.ok(!("error" in other), "error" in other ? other.error : "");
    if ("error" in base || "error" in other) return;
    assert.equal(base.asOf, through);
    assert.equal(other.asOf, through);
    assert.deepEqual(
      base.factors.assets.map((asset) => asset.forecast),
      other.factors.assets.map((asset) => asset.forecast),
    );
    assert.equal(base.verdict, other.verdict);
    assert.equal(base.disclaimer, ROBO_DISCLAIMER);
  });

  it("reports out-of-sample hits and a costed path against SPY and 60/40", () => {
    const today = "2030-01-01";
    const study = studyRobo(panel, { today, minTrain: 4, trees: 2, thresholds: 3, budgets: [1000] });
    assert.ok(!("error" in study), "error" in study ? study.error : "");
    if ("error" in study) return;
    assert.ok(study.byBudget.length === 1);
    const row = study.byBudget[0];
    assert.equal(row.ml.start, row.rule.start);
    assert.equal(row.ml.start, row.spy.start);
    assert.equal(row.ml.start, row.sixtyForty.start);
    assert.ok(row.ml.orders > 0);
    assert.ok(row.ml.commissionUsd > 0);
    assert.ok(row.spy.cagr != null && row.ml.cagr != null);
    assert.ok((row.ml.maxDrawdown ?? 0) <= 0);
    assert.ok(study.hit.n > 0);
    assert.ok((study.hit.rate ?? -1) >= 0 && (study.hit.rate ?? 2) <= 1);
    assert.ok(study.importance.length > 0);
    assert.match(study.hitText, /学習に使っていない/);
    assert.match(study.verdict, /^今月は/);
  });
});

describe("path stats", () => {
  it("reads a known rise and a known drop", () => {
    const perf = summarizePath({
      budget: 100,
      curve: [
        { date: "2020-01-02", equity: 100 },
        { date: "2021-01-02", equity: 110 },
      ],
      orders: 1,
      commissionUsd: 0.35,
      tradedNotional: 100,
    });
    assert.ok(perf.cagr != null && perf.cagr > 0.05 && perf.cagr < 0.15);
    assert.equal(perf.maxDrawdown, 0);
    const dropped = summarizePath({
      budget: 100,
      curve: [
        { date: "2020-01-02", equity: 100 },
        { date: "2020-06-01", equity: 80 },
        { date: "2020-12-31", equity: 90 },
      ],
      orders: 0,
      commissionUsd: 0,
      tradedNotional: 0,
    });
    assert.ok((dropped.maxDrawdown ?? 0) < -0.19);
    assert.ok((dropped.worstMonth ?? 0) < 0);
  });
});

describe("causal momentum", () => {
  it("stays put when only a future close changes", () => {
    const px = Array.from({ length: 300 }, (_, index) => 100 + index * 0.1);
    const before = causalMomentum(px, 280);
    px[290] = 1;
    assert.equal(causalMomentum(px, 280), before);
    px[280 - 21] = 50;
    assert.notEqual(causalMomentum(px, 280), before);
  });
});

function syntheticPanel(n: number): RoboPanel {
  const dates = weekdays(n);
  const rand = mulberry(7);
  const spy: number[] = [];
  let price = 100;
  for (let i = 0; i < n; i++) {
    price *= 1 + 0.0004 + (rand() - 0.48) * 0.01;
    spy.push(price);
  }
  const prices: Record<string, { date: string; c: number }[]> = {};
  ROBO_UNIVERSE.forEach((asset, index) => {
    let level = asset.group === "tbill" || asset.group === "short" ? 100 : 50 + index;
    prices[asset.ticker] = dates.map((date, i) => {
      const shock = asset.group === "tbill" || asset.group === "short" ? (rand() - 0.5) * 0.0004 : (rand() - 0.48) * 0.012;
      const beta = asset.group === "equity" || asset.group === "cushion" ? 0.6 : 0.05;
      const spyRet = i === 0 ? 0 : spy[i] / spy[i - 1] - 1;
      level *= 1 + beta * spyRet + shock;
      return { date, c: level };
    });
  });
  prices.SPY = dates.map((date, i) => ({ date, c: spy[i] }));
  return {
    prices,
    vix: dates.map((date, i) => ({ date, c: 16 + 4 * Math.sin(i / 15) + rand() })),
    tnx: dates.map((date, i) => ({ date, c: 2.5 + Math.sin(i / 40) * 0.4 })),
    irx: dates.map((date, i) => ({ date, c: 0.8 + Math.sin(i / 50) * 0.2 })),
  };
}

function weekdays(n: number): string[] {
  const out: string[] = [];
  let cursor = Date.UTC(2012, 0, 3);
  while (out.length < n) {
    const date = new Date(cursor);
    const day = date.getUTCDay();
    if (day !== 0 && day !== 6) out.push(date.toISOString().slice(0, 10));
    cursor += 86400000;
  }
  return out;
}

function mulberry(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
