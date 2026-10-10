/**
 * Monthly walk-forward study. A forecast at month t is fit only on labels that
 * have already finished by t, then judged on the next month, which was not in the fit.
 */

import { combinedImportance, walkForward, type Ensemble, type FitOptions, type Row } from "./robo-ml";
import {
  ASSUMPTIONS,
  COMMISSION_USD,
  FEATURES,
  LIMITATIONS,
  ROBO_DISCLAIMER,
  ROBO_UNIVERSE,
  SLIPPAGE,
  alignTo,
  classifyForecast,
  comparisonSentence,
  cushionText,
  decideShares,
  emptyHit,
  featureLabel,
  feeSentence,
  hitSentence,
  mlNote,
  priceRegime,
  recordHit,
  regimeText,
  sanitizeBudget,
  verdictLine,
  weightsFor,
  type AssetFactor,
  type FeatureKey,
  type LiveFactors,
  type Perf,
  type Regime,
} from "./robo-model";

export type CloseBar = { date: string; c: number };

export type RoboPanel = {
  prices: Record<string, CloseBar[]>;
  vix?: CloseBar[];
  /** 10-year yield in percent, not the Yahoo ×10 quote. */
  tnx?: CloseBar[];
  /** 13-week yield in percent. */
  irx?: CloseBar[];
};

export type StudyOptions = FitOptions & {
  /** Calendar day the study is viewed on (YYYY-MM-DD). Completes a trailing month-end. */
  today?: string;
  /** Ignore bars after this date. Live and tests use it to keep the decision causal. */
  throughDate?: string;
  budgets?: number[];
  minTrain?: number;
};

export type ImportanceRow = { key: string; label: string; share: number };

export type BudgetResult = {
  budget: number;
  ml: Perf;
  rule: Perf;
  spy: Perf;
  sixtyForty: Perf;
  sentence: string;
  feeNote: string;
};

export type RoboStudy = {
  disclaimer: string;
  asOf: string;
  warnings: string[];
  factors: LiveFactors;
  verdict: string;
  regimeText: string;
  mlNoteText: string;
  cushionNote: string;
  hit: ReturnType<typeof emptyHit>;
  hitText: string;
  importance: ImportanceRow[];
  byBudget: BudgetResult[];
  assumptions: readonly string[];
  limitations: readonly string[];
};

const MIN_INDEX = 252;

export function studyRobo(panel: RoboPanel, options: StudyOptions = {}): RoboStudy | { error: string } {
  if (options.throughDate) {
    const cut = options.throughDate;
    const slice = (series: CloseBar[] | undefined) => series?.filter((bar) => bar.date <= cut);
    panel = {
      prices: Object.fromEntries(Object.entries(panel.prices).map(([ticker, bars]) => [ticker, slice(bars) ?? []])),
      vix: slice(panel.vix),
      tnx: slice(panel.tnx),
      irx: slice(panel.irx),
    };
  }
  const spyBars = panel.prices.SPY;
  if (!spyBars || spyBars.length < MIN_INDEX + 40) return { error: "SPYの日足が短く、学習も200日平均も作れない。" };
  const calendar = spyBars.map((bar) => bar.date);
  const aligned: Record<string, (number | null)[]> = {};
  for (const asset of ROBO_UNIVERSE) aligned[asset.ticker] = alignTo(calendar, panel.prices[asset.ticker] ?? []);
  const vix = alignTo(calendar, panel.vix ?? []);
  const tnx = alignTo(calendar, panel.tnx ?? []);
  const irx = alignTo(calendar, panel.irx ?? []);
  const spy = aligned.SPY;
  const n = calendar.length;
  const today = options.today ?? calendar[n - 1];
  const ends = completedMonthEnds(calendar, today);
  if (ends.length < 3) return { error: "月末が足りない。" };

  const warnings: string[] = [];
  if (vix.every((value) => value == null)) warnings.push("恐怖指数が取れないので、その材料は外した。");
  if (tnx.every((value) => value == null) || irx.every((value) => value == null)) warnings.push("金利が取れないので、長短金利の材料は外した。");
  if ((aligned.BIL[n - 1] == null || aligned.BIL.filter((value) => value != null).length < 60) && aligned.SGOV[n - 1] == null) {
    return { error: "超短期国債（SGOVかBIL）の日足が無い。" };
  }

  const spyVol20 = volSeries(spy, 20);
  const marketAt = new Map<number, Partial<Record<FeatureKey, number>>>();
  const assetAt = new Map<string, Map<number, Partial<Record<FeatureKey, number>>>>();
  for (const asset of ROBO_UNIVERSE) assetAt.set(asset.ticker, new Map());

  const featureDays = new Set<number>(ends.filter((index) => index >= MIN_INDEX));
  featureDays.add(n - 1);
  for (const index of featureDays) {
    if (index < MIN_INDEX) continue;
    marketAt.set(index, marketFeatures(index, spy, vix, tnx, irx, spyVol20));
    for (const asset of ROBO_UNIVERSE) {
      assetAt.get(asset.ticker)?.set(index, assetFeatures(index, aligned[asset.ticker], spy, marketAt.get(index) ?? {}));
    }
  }

  const keys = activeKeys(ends, assetAt.get("SPY") ?? new Map());
  if (!keys.includes("mom12") || !keys.includes("vol60")) return { error: "勢いと値動きの材料が足りない。" };

  const minTrain = options.minTrain ?? 36;
  const fit: FitOptions = {
    trees: options.trees,
    learningRate: options.learningRate,
    lambdas: options.lambdas,
    thresholds: options.thresholds,
  };
  const points = [...featureDays].filter((index) => index >= MIN_INDEX).sort((a, b) => a - b);
  const densePoints = points.map((index) => ({ index, x: vector(assetAt.get("SPY")?.get(index), keys) })).filter((point): point is { index: number; x: number[] } => point.x != null);

  const importance = new Array(keys.length).fill(0);
  let importanceN = 0;
  const predictions = new Map<string, Map<number, { y: number; ridge: number; gbm: number }>>();
  let trainMonths = 0;

  for (const asset of ROBO_UNIVERSE) {
    const rows = monthRows(ends, aligned[asset.ticker], assetAt.get(asset.ticker) ?? new Map(), keys, "return");
    const ownPoints = points
      .map((index) => ({ index, x: vector(assetAt.get(asset.ticker)?.get(index), keys) }))
      .filter((point): point is { index: number; x: number[] } => point.x != null);
    const fitted = walkForward(rows, ownPoints, {
      ...fit,
      minTrain,
      onTrain(index, labelEnds) {
        if (asset.ticker === "SPY" && index === n - 1) trainMonths = labelEnds.length;
      },
      onModel(_index, model: Ensemble) {
        const part = combinedImportance(model);
        for (let i = 0; i < part.length; i++) importance[i] += part[i] ?? 0;
        importanceN += 1;
      },
    });
    predictions.set(asset.ticker, fitted);
  }

  const volRows = monthRows(ends, spy, assetAt.get("SPY") ?? new Map(), keys, "vol");
  const volPred = walkForward(volRows, densePoints, { ...fit, minTrain });
  const volLabels = volRows.map((row) => ({ labelEnd: row.labelEnd, y: row.y }));

  const hit = emptyHit();
  for (const asset of ROBO_UNIVERSE) {
    const px = aligned[asset.ticker];
    const fitted = predictions.get(asset.ticker);
    for (let k = 0; k < ends.length - 1; k++) {
      const i0 = ends[k];
      const i1 = ends[k + 1];
      const pred = fitted?.get(i0);
      if (!pred || px[i0] == null || px[i1] == null || px[i0] === 0) continue;
      const realized = (px[i1] as number) / (px[i0] as number) - 1;
      const view = classifyForecast(pred.y, pred.ridge, pred.gbm);
      recordHit(hit, asset.ticker, view.direction, realized, asset.group);
    }
  }

  const factors = buildFactors(n - 1, calendar, aligned, spy, spyVol20, predictions, volPred, volLabels, trainMonths);
  if (!factors) return { error: "直近の比率を作る材料が足りない。" };
  if (factors.cashTicker === "BIL") warnings.push("SGOVの履歴が短いので、超短期国債はBILにしている。");
  const allocation = weightsFor(factors, null);
  const budgets = (options.budgets ?? [1000, 10000]).map((budget) => sanitizeBudget(budget));
  const readySignals = ends.filter((index) => index >= MIN_INDEX && predictions.get("SPY")?.has(index) && index + 1 < n);
  const byBudget: BudgetResult[] = [];

  function factorsAtSignal(index: number): LiveFactors | null {
    const months = index === n - 1 ? trainMonths : predictions.get("SPY")?.has(index) ? minTrain : 0;
    return buildFactors(index, calendar, aligned, spy, spyVol20, predictions, volPred, volLabels, Math.max(months, minTrain));
  }

  if (readySignals.length > 0) {
    const startSignal = readySignals[0];
    for (const budget of budgets) {
      const ml = simulate(calendar, aligned, factorsAtSignal, startSignal, budget, "ml");
      const rule = simulate(calendar, aligned, factorsAtSignal, startSignal, budget, "rule");
      const spyPerf = simulate(calendar, aligned, factorsAtSignal, startSignal, budget, "spy");
      const mix = simulate(calendar, aligned, factorsAtSignal, startSignal, budget, "sixty");
      byBudget.push({
        budget,
        ml,
        rule,
        spy: spyPerf,
        sixtyForty: mix,
        sentence: comparisonSentence(ml, rule, spyPerf),
        feeNote: feeSentence(ml),
      });
    }
  } else {
    warnings.push("学習月数が足りないので、過去の成績はまだ出さない。");
  }

  const ranked = rankImportance(keys, importance, importanceN);
  return {
    disclaimer: ROBO_DISCLAIMER,
    asOf: calendar[n - 1],
    warnings,
    factors,
    verdict: verdictLine(allocation.weights),
    regimeText: regimeText(factors.regime),
    mlNoteText: mlNote(allocation.mlShift, allocation.modelReady),
    cushionNote: cushionText(null),
    hit,
    hitText: hitSentence(hit),
    importance: ranked,
    byBudget,
    assumptions: ASSUMPTIONS,
    limitations: LIMITATIONS,
  };
}

export function summarizePath(input: { budget: number; curve: { date: string; equity: number }[]; orders: number; commissionUsd: number; tradedNotional: number }): Perf {
  const { budget, curve, orders, commissionUsd, tradedNotional } = input;
  const ending = curve.length > 0 ? curve[curve.length - 1].equity : budget;
  const start = curve[0]?.date ?? "";
  const end = curve[curve.length - 1]?.date ?? "";
  const years = start && end ? Math.max(0, (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000 / 365.25) : 0;
  const returns: number[] = [];
  let prev = budget;
  for (const point of curve) {
    if (prev > 0 && point.equity > 0) returns.push(point.equity / prev - 1);
    prev = point.equity;
  }
  let peak = budget;
  let maxDrawdown = 0;
  for (const point of curve) {
    if (point.equity > peak) peak = point.equity;
    if (peak > 0) maxDrawdown = Math.min(maxDrawdown, point.equity / peak - 1);
  }
  const vol = stdev(returns);
  const volatility = vol == null ? null : vol * Math.sqrt(252);
  const sharpe = vol != null && vol > 1e-12 ? (mean(returns) / vol) * Math.sqrt(252) : null;
  const worstMonth = worstMonthReturn(curve, budget);
  const avg = curve.length > 0 ? mean(curve.map((point) => point.equity)) : budget;
  const turnover = years > 0 && avg > 0 ? (0.5 * tradedNotional) / (avg * years) : null;
  const cagr = years > 1 / 365 && budget > 0 && ending > 0 ? (ending / budget) ** (1 / years) - 1 : null;
  return {
    budget,
    start,
    end,
    years,
    cagr,
    maxDrawdown: curve.length > 0 ? maxDrawdown : null,
    volatility,
    sharpe,
    worstMonth,
    turnover,
    orders,
    commissionUsd,
    endingUsd: ending,
  };
}

function simulate(
  calendar: string[],
  aligned: Record<string, (number | null)[]>,
  factorsAt: (index: number) => LiveFactors | null,
  startSignal: number,
  budget: number,
  mode: "ml" | "rule" | "spy" | "sixty",
): Perf {
  const n = calendar.length;
  const startDay = startSignal + 1;
  const rebalance = new Set<number>();
  for (let index = startSignal; index + 1 < n; index++) {
    if (index === startSignal || isMonthEnd(calendar, index)) rebalance.add(index + 1);
  }
  const shares: Record<string, number> = {};
  let cash = budget;
  let traded = 0;
  let orders = 0;
  let commission = 0;
  const curve: { date: string; equity: number }[] = [];
  for (let day = startDay; day < n; day++) {
    const prices = pricesAt(aligned, day);
    if (rebalance.has(day)) {
      const equity = mark(shares, cash, prices);
      const target = targetWeights(mode, factorsAt, day - 1, equity / budget - 1, prices);
      const fill = rebalanceBook(shares, cash, prices, target, equity);
      cash = fill.cash;
      traded += fill.notional;
      orders += fill.orders;
      commission += fill.commission;
    }
    curve.push({ date: calendar[day], equity: mark(shares, cash, prices) });
  }
  return summarizePath({ budget, curve, orders, commissionUsd: commission, tradedNotional: traded });
}

function targetWeights(
  mode: "ml" | "rule" | "spy" | "sixty",
  factorsAt: (index: number) => LiveFactors | null,
  signal: number,
  cushion: number,
  prices: Record<string, number>,
): Record<string, number> {
  if (mode === "spy") return { SPY: 1 };
  if (mode === "sixty") return prices.IEF != null ? { SPY: 0.6, IEF: 0.4 } : { SPY: 0.6, SHY: 0.4 };
  const factors = factorsAt(signal);
  if (!factors) return { [prices.BIL != null ? "BIL" : "SGOV"]: 1 };
  const used = mode === "rule" ? { ...factors, modelReady: false, spyForecast: null, spyVolForecast: null } : factors;
  return weightsFor(used, cushion).weights;
}

function rebalanceBook(
  shares: Record<string, number>,
  cash: number,
  prices: Record<string, number>,
  weights: Record<string, number>,
  equity: number,
): { cash: number; notional: number; orders: number; commission: number } {
  const orders: { ticker: string; price: number; prev: number; next: number }[] = [];
  const tickers = new Set([...Object.keys(shares), ...Object.keys(weights)]);
  for (const ticker of tickers) {
    const price = prices[ticker];
    if (price == null || !(price > 0)) continue;
    const prev = shares[ticker] ?? 0;
    const decision = decideShares({ price, currentShares: prev, targetWeight: weights[ticker] ?? 0, budget: equity });
    if (decision.action === "hold") continue;
    orders.push({ ticker, price, prev, next: decision.shares });
  }
  let notional = 0;
  const sells = orders.filter((order) => order.next < order.prev);
  const buys = orders.filter((order) => order.next > order.prev);
  for (const order of [...sells, ...buys]) {
    const qty = order.next - order.prev;
    cash -= qty * order.price;
    shares[order.ticker] = order.next;
    if (shares[order.ticker] <= 1e-10) delete shares[order.ticker];
    notional += Math.abs(qty) * order.price;
  }
  const commission = orders.length * COMMISSION_USD;
  const slip = notional * SLIPPAGE;
  cash -= commission + slip;
  const fund = prices.SGOV != null ? "SGOV" : prices.BIL != null ? "BIL" : prices.SHY != null ? "SHY" : null;
  if (cash < -1e-6 && fund != null) {
    const price = prices[fund];
    const have = shares[fund] ?? 0;
    const qty = Math.min(have, -cash / price);
    if (qty > 0) {
      shares[fund] = have - qty;
      if (shares[fund] <= 1e-10) delete shares[fund];
      cash += qty * price;
      notional += qty * price;
    }
  }
  if (cash < -1e-4) {
    const gross = mark(shares, 0, prices);
    if (gross > -cash) {
      const scale = (gross + cash) / gross;
      for (const ticker of Object.keys(shares)) shares[ticker] *= scale;
      cash = 0;
    }
  }
  return { cash, notional, orders: orders.length, commission };
}

function mark(shares: Record<string, number>, cash: number, prices: Record<string, number>): number {
  let total = cash;
  for (const [ticker, qty] of Object.entries(shares)) {
    const price = prices[ticker];
    if (price != null) total += qty * price;
  }
  return total;
}

function pricesAt(aligned: Record<string, (number | null)[]>, day: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const asset of ROBO_UNIVERSE) {
    const price = aligned[asset.ticker]?.[day];
    if (price != null && price > 0) out[asset.ticker] = price;
  }
  return out;
}

function buildFactors(
  index: number,
  calendar: string[],
  aligned: Record<string, (number | null)[]>,
  spy: (number | null)[],
  spyVol20: (number | null)[],
  predictions: Map<string, Map<number, { y: number; ridge: number; gbm: number }>>,
  volPred: Map<number, { y: number; ridge: number; gbm: number }>,
  volLabels: { labelEnd: number; y: number }[],
  trainMonths: number,
): LiveFactors | null {
  if (index < MIN_INDEX || spy[index] == null) return null;
  const snap = spySnapshot(spy, spyVol20, index);
  if (snap == null) return null;
  const sgovBars = aligned.SGOV.slice(0, index + 1).filter((value) => value != null).length;
  const cashTicker = sgovBars >= 60 && aligned.SGOV[index] != null ? "SGOV" : aligned.BIL[index] != null ? "BIL" : "SGOV";
  const assets: AssetFactor[] = ROBO_UNIVERSE.map((asset) => {
    const px = aligned[asset.ticker];
    const pred = predictions.get(asset.ticker)?.get(index);
    const own = assetSnapshot(px, index);
    return {
      ticker: asset.ticker,
      price: px[index],
      trendUp: own.trendUp,
      mom12: own.mom12,
      vol60: own.vol60,
      distSma: own.distSma,
      forecast: pred?.y ?? null,
      ridge: pred?.ridge ?? null,
      gbm: pred?.gbm ?? null,
    };
  });
  const knownVol = volLabels.filter((row) => row.labelEnd <= index).map((row) => row.y);
  const volForecast = volPred.get(index)?.y ?? null;
  const spyPred = predictions.get("SPY")?.get(index);
  return {
    asOf: calendar[index],
    regime: snap.regime,
    cashTicker,
    shyOk: aligned.SHY[index] != null,
    assets,
    spyForecast: spyPred?.y ?? null,
    spyRidge: spyPred?.ridge ?? null,
    spyGbm: spyPred?.gbm ?? null,
    spyVolForecast: volForecast,
    volCut: knownVol.length >= 12 ? median(knownVol) : null,
    modelReady: spyPred != null,
    trainMonths: spyPred != null ? trainMonths : 0,
  };
}

function monthRows(
  ends: number[],
  px: (number | null)[],
  features: Map<number, Partial<Record<FeatureKey, number>>>,
  keys: FeatureKey[],
  kind: "return" | "vol",
): Row[] {
  const rows: Row[] = [];
  for (let k = 0; k < ends.length - 1; k++) {
    const i0 = ends[k];
    const i1 = ends[k + 1];
    if (i0 < MIN_INDEX) continue;
    const x = vector(features.get(i0), keys);
    if (x == null || px[i0] == null || px[i0] === 0) continue;
    const y = kind === "return" ? forwardReturn(px, i0, i1) : forwardVol(px, i0, i1);
    if (y == null) continue;
    rows.push({ x, y, labelEnd: i1 });
  }
  return rows;
}

function activeKeys(ends: number[], spyFeatures: Map<number, Partial<Record<FeatureKey, number>>>): FeatureKey[] {
  const usable = ends.filter((index) => index >= MIN_INDEX);
  const counts = new Map<FeatureKey, number>();
  for (const feature of FEATURES) counts.set(feature.key, 0);
  for (const index of usable) {
    const row = spyFeatures.get(index);
    if (!row) continue;
    for (const feature of FEATURES) {
      if (row[feature.key] != null) counts.set(feature.key, (counts.get(feature.key) ?? 0) + 1);
    }
  }
  const need = Math.max(8, Math.floor(usable.length * 0.85));
  return FEATURES.map((feature) => feature.key).filter((key) => (counts.get(key) ?? 0) >= need);
}

function rankImportance(keys: string[], sum: number[], models: number): ImportanceRow[] {
  if (models <= 0) return [];
  const avg = sum.map((value) => value / models);
  const total = avg.reduce((acc, value) => acc + Math.max(0, value), 0);
  if (!(total > 0)) return [];
  return keys
    .map((key, index) => ({ key, label: featureLabel(key), share: Math.max(0, avg[index] ?? 0) / total }))
    .sort((a, b) => b.share - a.share || a.key.localeCompare(b.key))
    .slice(0, 8);
}

function marketFeatures(
  index: number,
  spy: (number | null)[],
  vix: (number | null)[],
  tnx: (number | null)[],
  irx: (number | null)[],
  spyVol20: (number | null)[],
): Partial<Record<FeatureKey, number>> {
  const out: Partial<Record<FeatureKey, number>> = {};
  const px = spy[index];
  const sma = rollingSma(spy, index, 200);
  if (px != null && sma != null && sma > 0) {
    out.sma = px / sma - 1;
    out.spyTrend = px > sma ? 1 : 0;
  }
  const dd = rollingDd(spy, index, 252);
  if (dd != null) {
    out.dd = dd;
    out.spyDd = dd;
  }
  const mom1 = rollingRet(spy, index, 21);
  const mom3 = rollingRet(spy, index, 63);
  const mom6 = rollingRet(spy, index, 126);
  const mom12 = delayedRet(spy, index, 252, 21);
  if (mom1 != null) out.mom1 = mom1;
  if (mom3 != null) out.mom3 = mom3;
  if (mom6 != null) {
    out.mom6 = mom6;
    out.spyMom = mom6;
  }
  if (mom12 != null) out.mom12 = mom12;
  if (spyVol20[index] != null) out.vol20 = spyVol20[index] as number;
  const vol60 = rollingVol(spy, index, 60);
  if (vol60 != null) out.vol60 = vol60;
  if (vix[index] != null) {
    out.vix = (vix[index] as number) / 100;
    if (index >= 21 && vix[index - 21] != null) out.vixChg = (vix[index] as number) / 100 - (vix[index - 21] as number) / 100;
  }
  if (tnx[index] != null && irx[index] != null) {
    out.rate = tnx[index] as number;
    out.curve = (tnx[index] as number) - (irx[index] as number);
    if (index >= 63 && tnx[index - 63] != null && irx[index - 63] != null) {
      out.curveChg = (tnx[index] as number) - (irx[index] as number) - ((tnx[index - 63] as number) - (irx[index - 63] as number));
    }
  }
  return out;
}

function assetFeatures(index: number, px: (number | null)[], spy: (number | null)[], market: Partial<Record<FeatureKey, number>>): Partial<Record<FeatureKey, number>> {
  const out: Partial<Record<FeatureKey, number>> = { ...market };
  const sma = rollingSma(px, index, 200);
  if (px[index] != null && sma != null && sma > 0) out.sma = (px[index] as number) / sma - 1;
  const dd = rollingDd(px, index, 252);
  if (dd != null) out.dd = dd;
  const mom1 = rollingRet(px, index, 21);
  const mom3 = rollingRet(px, index, 63);
  const mom6 = rollingRet(px, index, 126);
  const mom12 = delayedRet(px, index, 252, 21);
  if (mom1 != null) out.mom1 = mom1;
  if (mom3 != null) out.mom3 = mom3;
  if (mom6 != null) out.mom6 = mom6;
  if (mom12 != null) out.mom12 = mom12;
  const vol20 = rollingVol(px, index, 20);
  const vol60 = rollingVol(px, index, 60);
  if (vol20 != null) out.vol20 = vol20;
  if (vol60 != null) out.vol60 = vol60;
  const corr = rollingCorr(px, spy, index, 60);
  if (corr != null) out.corrSpy = corr;
  if (mom6 != null && market.spyMom != null) out.relMom = mom6 - market.spyMom;
  return out;
}

function spySnapshot(spy: (number | null)[], vol20: (number | null)[], index: number): { regime: Regime } | null {
  const px = spy[index];
  const sma = rollingSma(spy, index, 200);
  const dd = rollingDd(spy, index, 252);
  if (px == null || sma == null || dd == null) return null;
  const window: number[] = [];
  for (let k = index - 251; k <= index; k++) {
    if (k < 0 || vol20[k] == null) return { regime: priceRegime({ above200: px > sma, drawdown: dd, highVol: false }) };
    window.push(vol20[k] as number);
  }
  const mid = median(window);
  const highVol = vol20[index] != null && mid != null && (vol20[index] as number) > 1.5 * mid;
  return { regime: priceRegime({ above200: px > sma, drawdown: dd, highVol }) };
}

function assetSnapshot(px: (number | null)[], index: number): Pick<AssetFactor, "trendUp" | "mom12" | "vol60" | "distSma"> {
  const price = px[index];
  const sma = rollingSma(px, index, 200);
  const dist = price != null && sma != null && sma > 0 ? price / sma - 1 : null;
  return {
    trendUp: dist != null && dist > 0,
    mom12: delayedRet(px, index, 252, 21),
    vol60: rollingVol(px, index, 60),
    distSma: dist,
  };
}

function completedMonthEnds(dates: string[], today: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < dates.length - 1; i++) {
    if (dates[i].slice(0, 7) !== dates[i + 1].slice(0, 7)) out.push(i);
  }
  const last = dates.length - 1;
  if (last > 0 && dates[last].slice(0, 7) < today.slice(0, 7) && (out.length === 0 || out[out.length - 1] !== last)) out.push(last);
  return out;
}

function isMonthEnd(dates: string[], index: number): boolean {
  return index + 1 < dates.length && dates[index].slice(0, 7) !== dates[index + 1].slice(0, 7);
}

function vector(row: Partial<Record<FeatureKey, number>> | undefined, keys: FeatureKey[]): number[] | null {
  if (!row) return null;
  const out: number[] = [];
  for (const key of keys) {
    const value = row[key];
    if (value == null || !Number.isFinite(value)) return null;
    out.push(value);
  }
  return out;
}

function forwardReturn(px: (number | null)[], from: number, to: number): number | null {
  if (px[from] == null || px[to] == null || px[from] === 0) return null;
  return (px[to] as number) / (px[from] as number) - 1;
}

function forwardVol(px: (number | null)[], from: number, to: number): number | null {
  const values: number[] = [];
  for (let k = from + 1; k <= to; k++) {
    if (px[k] == null || px[k - 1] == null || px[k - 1] === 0) return null;
    values.push((px[k] as number) / (px[k - 1] as number) - 1);
  }
  if (values.length < 5) return null;
  const vol = stdev(values);
  return vol == null ? null : vol * Math.sqrt(252);
}

function rollingRet(px: (number | null)[], index: number, days: number): number | null {
  if (index - days < 0) return null;
  const now = px[index];
  const then = px[index - days];
  if (now == null || then == null || then === 0) return null;
  return now / then - 1;
}

/** 12-1 month momentum. Exported so tests can prove a later price does not move it. */
export function causalMomentum(px: (number | null)[], index: number): number | null {
  return delayedRet(px, index, 252, 21);
}

function delayedRet(px: (number | null)[], index: number, lookback: number, skip: number): number | null {
  if (index - lookback < 0) return null;
  const now = px[index - skip];
  const then = px[index - lookback];
  if (now == null || then == null || then === 0) return null;
  return now / then - 1;
}

function rollingSma(px: (number | null)[], index: number, days: number): number | null {
  if (index - days + 1 < 0) return null;
  let sum = 0;
  for (let k = index - days + 1; k <= index; k++) {
    if (px[k] == null) return null;
    sum += px[k] as number;
  }
  return sum / days;
}

function rollingVol(px: (number | null)[], index: number, days: number): number | null {
  if (index - days < 0) return null;
  const values: number[] = [];
  for (let k = index - days + 1; k <= index; k++) {
    if (px[k] == null || px[k - 1] == null || px[k - 1] === 0) return null;
    values.push((px[k] as number) / (px[k - 1] as number) - 1);
  }
  const vol = stdev(values);
  return vol == null ? null : vol * Math.sqrt(252);
}

function rollingDd(px: (number | null)[], index: number, days: number): number | null {
  if (index - days + 1 < 0 || px[index] == null) return null;
  let high = -Infinity;
  for (let k = index - days + 1; k <= index; k++) {
    if (px[k] == null) return null;
    if ((px[k] as number) > high) high = px[k] as number;
  }
  if (!(high > 0)) return null;
  return (px[index] as number) / high - 1;
}

function rollingCorr(left: (number | null)[], right: (number | null)[], index: number, days: number): number | null {
  if (index - days < 0) return null;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let k = index - days + 1; k <= index; k++) {
    if (left[k] == null || left[k - 1] == null || right[k] == null || right[k - 1] == null) return null;
    if (left[k - 1] === 0 || right[k - 1] === 0) return null;
    xs.push((left[k] as number) / (left[k - 1] as number) - 1);
    ys.push((right[k] as number) / (right[k - 1] as number) - 1);
  }
  const volX = stdev(xs);
  const volY = stdev(ys);
  if (volX == null || volY == null || volX === 0 || volY === 0) return null;
  const mx = mean(xs);
  const my = mean(ys);
  let cov = 0;
  for (let i = 0; i < xs.length; i++) cov += (xs[i] - mx) * (ys[i] - my);
  cov /= xs.length - 1;
  return clamp(cov / (volX * volY), -1, 1);
}

function volSeries(px: (number | null)[], days: number): (number | null)[] {
  return px.map((_, index) => (index >= days ? rollingVol(px, index, days) : null));
}

function worstMonthReturn(curve: { date: string; equity: number }[], budget: number): number | null {
  if (curve.length === 0) return null;
  let month = "";
  let base = budget;
  let last = budget;
  let worst: number | null = null;
  const finish = () => {
    if (!(base > 0)) return;
    const value = last / base - 1;
    if (worst == null || value < worst) worst = value;
  };
  for (const point of curve) {
    const next = point.date.slice(0, 7);
    if (month && next !== month) {
      finish();
      base = last;
    }
    month = next;
    last = point.equity;
  }
  finish();
  return worst;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

function stdev(values: number[]): number | null {
  if (values.length < 2) return null;
  const mu = mean(values);
  let acc = 0;
  for (const value of values) acc += (value - mu) ** 2;
  return Math.sqrt(acc / (values.length - 1));
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}
