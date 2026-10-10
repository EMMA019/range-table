/**
 * Suggested ETF sleeve. Rules plus an optional forecast tilt.
 * The page and the API only describe trades. They never place them.
 * Caps and the equity band were written down before any live backtest, not fit to it.
 */

export const ROBO_DISCLAIMER = "発注・推奨ではありません。最終判断はご自身で。";

export const ROBO_STORAGE_KEY = "rt.robo.v1";

export const DEFAULT_BUDGET = 1000;
export const NO_TRADE_BAND = 0.03;
export const MIN_TRADE_USD = 25;
export const COMMISSION_USD = 0.35;
export const SLIPPAGE = 0.0001;

export const QQQ_CAP = 0.12;
export const NAME_CAP = 0.22;
export const GOLD_CAP = 0.08;
export const IEF_CAP = 0.08;
export const TLT_CAP = 0.05;
export const EQUITY_FLOOR = 0.22;
export const EQUITY_CEILING = 0.78;
export const ML_TILT_BAND = 0.06;

const BASE_EQUITY = { risk_on: 0.68, risk_caution: 0.48, risk_off: 0.28 } as const;
const CUSHION_SHARE = { risk_on: 0.22, risk_caution: 0.42, risk_off: 0.55 } as const;

export type SleeveGroup = "equity" | "cushion" | "gold" | "bond" | "short" | "tbill";

export type UniverseAsset = {
  ticker: string;
  name: string;
  group: SleeveGroup;
};

export const ROBO_UNIVERSE: readonly UniverseAsset[] = [
  { ticker: "SPY", name: "米国株（大型）", group: "equity" },
  { ticker: "QQQ", name: "米国株（成長）", group: "equity" },
  { ticker: "IWM", name: "米国株（小型）", group: "equity" },
  { ticker: "EFA", name: "先進国株（米国以外）", group: "equity" },
  { ticker: "EEM", name: "新興国株", group: "equity" },
  { ticker: "XLP", name: "生活必需品", group: "cushion" },
  { ticker: "XLV", name: "ヘルスケア", group: "cushion" },
  { ticker: "XLE", name: "エネルギー", group: "cushion" },
  { ticker: "XLF", name: "金融", group: "cushion" },
  { ticker: "VNQ", name: "不動産", group: "equity" },
  { ticker: "GLD", name: "金", group: "gold" },
  { ticker: "IEF", name: "米国債（7〜10年）", group: "bond" },
  { ticker: "TLT", name: "米国債（長期）", group: "bond" },
  { ticker: "SHY", name: "米国債（1〜3年）", group: "short" },
  { ticker: "SGOV", name: "超短期国債", group: "tbill" },
  { ticker: "BIL", name: "超短期国債（代わり）", group: "tbill" },
] as const;

const STOCK_TICKERS = ROBO_UNIVERSE.filter((asset) => asset.group === "equity" || asset.group === "cushion").map((asset) => asset.ticker);
const BROAD_TICKERS = ROBO_UNIVERSE.filter((asset) => asset.group === "equity").map((asset) => asset.ticker);
const CUSHION_TICKERS = ROBO_UNIVERSE.filter((asset) => asset.group === "cushion").map((asset) => asset.ticker);
const SHORT_TICKERS = ["SHY", "SGOV", "BIL"];
const NAME_BY_TICKER = new Map(ROBO_UNIVERSE.map((asset) => [asset.ticker, asset]));

export function assetByTicker(ticker: string): UniverseAsset | null {
  return NAME_BY_TICKER.get(ticker) ?? null;
}

export type Regime = "risk_on" | "risk_caution" | "risk_off";
export type Direction = "up" | "flat" | "down";
export type Confidence = "high" | "mid" | "low";
export type MlShift = "up" | "down" | "same";

export type AssetFactor = {
  ticker: string;
  price: number | null;
  trendUp: boolean;
  mom12: number | null;
  vol60: number | null;
  distSma: number | null;
  forecast: number | null;
  ridge: number | null;
  gbm: number | null;
};

export type LiveFactors = {
  asOf: string;
  regime: Regime;
  cashTicker: "SGOV" | "BIL";
  shyOk: boolean;
  assets: AssetFactor[];
  spyForecast: number | null;
  spyRidge: number | null;
  spyGbm: number | null;
  spyVolForecast: number | null;
  /** Median of past realized monthly vol. The vol forecast is "high" above this. */
  volCut: number | null;
  modelReady: boolean;
  trainMonths: number;
};

export type Allocation = {
  weights: Record<string, number>;
  equityFraction: number;
  stockFraction: number;
  shortFraction: number;
  mlShift: MlShift;
  modelReady: boolean;
};

export function priceRegime(input: { above200: boolean; drawdown: number; highVol: boolean }): Regime {
  const { above200, drawdown, highVol } = input;
  if ((!above200 && drawdown <= -0.08) || drawdown <= -0.15 || (highVol && !above200)) return "risk_off";
  if (!above200 || drawdown <= -0.08 || highVol) return "risk_caution";
  return "risk_on";
}

export function classifyForecast(forecast: number | null, ridge: number | null, gbm: number | null): { direction: Direction; confidence: Confidence } {
  if (forecast == null || !Number.isFinite(forecast)) return { direction: "flat", confidence: "low" };
  const clipped = clamp(forecast, -0.08, 0.08);
  if (Math.abs(clipped) < 0.004) return { direction: "flat", confidence: "low" };
  const direction: Direction = clipped > 0 ? "up" : "down";
  const disagree = ridge != null && gbm != null && Number.isFinite(ridge) && Number.isFinite(gbm) ? Math.abs(ridge - gbm) : 0.02;
  let confidence: Confidence = "low";
  if (disagree <= 0.004 && Math.abs(clipped) >= 0.01) confidence = "high";
  else if (disagree <= 0.01 && Math.abs(clipped) >= 0.005) confidence = "mid";
  return { direction, confidence };
}

export function directionLabel(direction: Direction): string {
  if (direction === "up") return "上昇";
  if (direction === "down") return "下落";
  return "横ばい";
}

export function confidenceLabel(confidence: Confidence): string {
  if (confidence === "high") return "自信は高い";
  if (confidence === "mid") return "自信は中くらい";
  return "自信は低い";
}

export function forecastText(forecast: number | null, ridge: number | null, gbm: number | null): string {
  const { direction, confidence } = classifyForecast(forecast, ridge, gbm);
  return `${directionLabel(direction)}（${confidenceLabel(confidence)}）`;
}

export function regimeText(regime: Regime): string {
  if (regime === "risk_on") return "米国株は200日平均より上で、落ち込みも大きくない。";
  if (regime === "risk_off") return "米国株は200日平均を下回り、落ち込みか大きな値動きがある。守りを厚くする。";
  return "米国株は様子見。平均を下回るか、落ち込みか、値動きが大きい。";
}

export function mlNote(shift: MlShift, modelReady: boolean): string {
  if (!modelReady) return "AIの学習月数がまだ足りないので、今月の比率はルールだけ。";
  if (shift === "down") return "AIの来月見通しが弱いので、ルールより株を減らして短期債を増やしている。";
  if (shift === "up") return "AIの来月見通しが強いので、ルールより株を少し増やしている。";
  return "AIの来月見通しは中立で、株と短期債の比率はルールに近い。";
}

export function weightsFor(factors: LiveFactors, cushion: number | null): Allocation {
  const by = new Map(factors.assets.map((asset) => [asset.ticker, asset]));
  let equity: number = BASE_EQUITY[factors.regime];
  if (cushion == null || cushion < 0.05) equity *= 0.8;
  else if (cushion >= 0.2) equity *= 1.12;
  const ml = applyMlRisk(equity, factors);
  equity = clamp(ml.equity, EQUITY_FLOOR, EQUITY_CEILING);

  const caps = capsFor();
  const rule = allocateRisky(by, factors.regime, equity, false);
  const tilted = factors.modelReady ? allocateRisky(by, factors.regime, equity, true) : rule;
  const blended = blendToBudget(rule.weights, tilted.weights, rule.allocated, caps);

  const gold = goldWeight(by.get("GLD"), factors.modelReady);
  const stockBudget = Math.max(0, equity - gold);
  const stocks = project(blended, stockBudget, caps);
  if (gold > 0) stocks.GLD = gold;

  let defensive = Math.max(0, 1 - sumRecord(stocks));
  const ief = altBondWeight(by.get("IEF"), factors.modelReady, defensive, IEF_CAP, 0.2, 0.12);
  defensive -= ief;
  const tlt =
    ief > 0 ? altBondWeight(by.get("TLT"), factors.modelReady, Math.min(defensive, ief * 0.5), TLT_CAP, 1, 1) : 0;
  const tltW = Math.min(tlt, TLT_CAP, defensive);
  defensive -= tltW;
  if (ief > 0) stocks.IEF = ief;
  if (tltW > 0) stocks.TLT = tltW;

  const shyW = factors.shyOk ? defensive * 0.35 : 0;
  const cashW = defensive - shyW;
  if (shyW > 0) stocks.SHY = shyW;
  stocks[factors.cashTicker] = (stocks[factors.cashTicker] ?? 0) + cashW;

  applyVolTarget(stocks, by, factors);
  moveDustToCash(stocks, factors.cashTicker);
  enforceHardCaps(stocks, factors.cashTicker);
  const weights = roundToCash(stocks, factors.cashTicker);
  const stockFraction = sumTickers(weights, STOCK_TICKERS);
  const shortFraction = sumTickers(weights, SHORT_TICKERS);
  return {
    weights,
    equityFraction: stockFraction + (weights.GLD ?? 0),
    stockFraction,
    shortFraction,
    mlShift: ml.shift,
    modelReady: factors.modelReady,
  };
}

export function verdictLine(weights: Record<string, number>): string {
  const buckets = [
    { key: "株", w: sumTickers(weights, STOCK_TICKERS) },
    { key: "短期債", w: sumTickers(weights, SHORT_TICKERS) },
    { key: "長期債", w: (weights.IEF ?? 0) + (weights.TLT ?? 0) },
    { key: "金", w: weights.GLD ?? 0 },
  ];
  const rounded = roundBuckets(buckets.map((bucket) => bucket.w));
  const stock = rounded[0] ?? 0;
  const stance = stock >= 62 ? "攻め寄り" : stock <= 42 ? "守り寄り" : "中立";
  const parts = buckets
    .map((bucket, index) => ({ key: bucket.key, pct: rounded[index] ?? 0 }))
    .filter((bucket) => bucket.pct >= 1)
    .map((bucket) => `${bucket.key}${bucket.pct}%`);
  return `今月は${stance}：${parts.join("・")}`;
}

export function cushionText(cushion: number | null): string {
  if (cushion == null) return "取得単価が無いので、含み益の余裕はゼロとして守りを厚くしている。";
  const shown = `${cushion > 0 ? "+" : ""}${(cushion * 100).toFixed(1)}%`;
  if (cushion < 0.05) return `含み益は${shown}。余裕が薄いので守りを厚くしている。`;
  if (cushion >= 0.2) return `含み益は${shown}。余裕があるので株を少し厚くしている。`;
  return `含み益は${shown}。守りも株も、基本の比率のまま。`;
}

export type SleevePosition = {
  ticker: string;
  shares: number;
  avgCost: number | null;
};

export type TradeAction = "buy" | "sell" | "hold";

export type PlanLine = {
  ticker: string;
  name: string;
  group: SleeveGroup;
  price: number | null;
  weight: number;
  currentShares: number;
  nextShares: number;
  currentUsd: number;
  targetUsd: number;
  action: TradeAction;
};

export type RoboPlan = {
  budget: number;
  lines: PlanLine[];
  orders: number;
  commissionUsd: number;
  currentUsd: number;
  targetInvestedUsd: number;
  cashLeftUsd: number;
};

export function describeSleeve(factors: LiveFactors, budget: number, positions: SleevePosition[]): {
  allocation: Allocation;
  verdict: string;
  note: string;
  cushionNote: string;
  cushion: number | null;
  plan: RoboPlan;
} {
  const prices = Object.fromEntries(factors.assets.map((asset) => [asset.ticker, asset.price]));
  const cushion = sleeveCushion(positions, prices);
  const allocation = weightsFor(factors, cushion);
  return {
    allocation,
    verdict: verdictLine(allocation.weights),
    note: mlNote(allocation.mlShift, allocation.modelReady),
    cushionNote: cushionText(cushion),
    cushion,
    plan: buildPlan({ weights: allocation.weights, prices, budget, positions }),
  };
}

export function sleeveCushion(positions: SleevePosition[], prices: Record<string, number | null | undefined>): number | null {
  let cost = 0;
  let market = 0;
  let any = false;
  for (const position of positions) {
    if (position.avgCost == null || !(position.shares > 0)) continue;
    const price = prices[position.ticker];
    if (price == null || !(price > 0)) continue;
    any = true;
    cost += position.avgCost * position.shares;
    market += price * position.shares;
  }
  if (!any || !(cost > 0)) return null;
  return market / cost - 1;
}

export function decideShares(input: { price: number; currentShares: number; targetWeight: number; budget: number }): { shares: number; action: TradeAction } {
  const { price, budget } = input;
  const currentShares = Number.isFinite(input.currentShares) ? Math.max(0, input.currentShares) : 0;
  const targetWeight = clamp(input.targetWeight, 0, 1);
  if (!(price > 0) || !(budget > 0)) return { shares: currentShares, action: "hold" };
  const currentUsd = currentShares * price;
  const targetUsd = targetWeight * budget;
  const currentW = currentUsd / budget;
  const exit = targetWeight < 0.005 && currentShares > 0;
  const open = currentShares <= 1e-8 && targetUsd >= MIN_TRADE_USD;
  const outside = Math.abs(targetWeight - currentW) >= NO_TRADE_BAND && Math.abs(targetUsd - currentUsd) >= MIN_TRADE_USD;
  if (!exit && !open && !outside) return { shares: currentShares, action: "hold" };
  const next = exit ? 0 : roundShares(targetUsd / price);
  const deltaUsd = Math.abs(next - currentShares) * price;
  if (!exit && deltaUsd < MIN_TRADE_USD) return { shares: currentShares, action: "hold" };
  if (next > currentShares + 1e-8) return { shares: next, action: "buy" };
  if (next < currentShares - 1e-8) return { shares: next, action: "sell" };
  return { shares: currentShares, action: "hold" };
}

export function buildPlan(input: { weights: Record<string, number>; prices: Record<string, number | null | undefined>; budget: number; positions: SleevePosition[] }): RoboPlan {
  const budget = sanitizeBudget(input.budget);
  const held = new Map(input.positions.map((position) => [position.ticker, position]));
  const lines: PlanLine[] = [];
  for (const asset of ROBO_UNIVERSE) {
    const price = input.prices[asset.ticker];
    const weight = input.weights[asset.ticker] ?? 0;
    const currentShares = held.get(asset.ticker)?.shares ?? 0;
    const usablePrice = price != null && price > 0 ? price : null;
    let nextShares = currentShares;
    let action: TradeAction = "hold";
    if (usablePrice != null) {
      const decision = decideShares({ price: usablePrice, currentShares, targetWeight: weight, budget });
      nextShares = decision.shares;
      action = decision.action;
    }
    const currentUsd = usablePrice != null ? currentShares * usablePrice : 0;
    lines.push({
      ticker: asset.ticker,
      name: asset.name,
      group: asset.group,
      price: usablePrice,
      weight,
      currentShares,
      nextShares,
      currentUsd,
      targetUsd: weight * budget,
      action,
    });
  }
  const orders = lines.filter((line) => line.action !== "hold").length;
  const currentUsd = lines.reduce((sum, line) => sum + line.currentUsd, 0);
  const targetInvestedUsd = lines.reduce((sum, line) => sum + (line.price != null ? line.nextShares * line.price : 0), 0);
  return {
    budget,
    lines,
    orders,
    commissionUsd: orders * COMMISSION_USD,
    currentUsd,
    targetInvestedUsd,
    cashLeftUsd: budget - targetInvestedUsd,
  };
}

export function actionLabel(action: TradeAction): string {
  if (action === "buy") return "買う";
  if (action === "sell") return "売る";
  return "そのまま";
}

export type Perf = {
  budget: number;
  start: string;
  end: string;
  years: number;
  cagr: number | null;
  maxDrawdown: number | null;
  volatility: number | null;
  sharpe: number | null;
  worstMonth: number | null;
  turnover: number | null;
  orders: number;
  commissionUsd: number;
  endingUsd: number;
};

export function comparisonSentence(ml: Perf, rule: Perf, spy: Perf): string {
  const paceSpy = paceWord(ml.cagr, spy.cagr);
  const dropSpy = dropWord(ml.maxDrawdown, spy.maxDrawdown);
  const paceRule = paceWord(ml.cagr, rule.cagr);
  const dropRule = dropWord(ml.maxDrawdown, rule.maxDrawdown);
  return `AI枠はSPYより増えるペースが${paceSpy}、落ち込みは${dropSpy}。ルールだけと比べると増えるペースは${paceRule}、落ち込みは${dropRule}。過去の結果で、これから同じになるわけではない。`;
}

export type HitSummary = {
  n: number;
  hits: number;
  rate: number | null;
  spyN: number;
  spyHits: number;
  spyRate: number | null;
  /** Stocks, sector cushions, and gold. Bills and bonds are left out so a steady coupon does not look like skill. */
  equityN: number;
  equityHits: number;
  equityRate: number | null;
};

export function emptyHit(): HitSummary {
  return { n: 0, hits: 0, rate: null, spyN: 0, spyHits: 0, spyRate: null, equityN: 0, equityHits: 0, equityRate: null };
}

export function recordHit(summary: HitSummary, ticker: string, direction: Direction, realized: number, group: SleeveGroup = "equity"): void {
  if (direction === "flat" || !Number.isFinite(realized)) return;
  const hit = (direction === "up" && realized > 0) || (direction === "down" && realized < 0);
  summary.n += 1;
  if (hit) summary.hits += 1;
  if (ticker === "SPY") {
    summary.spyN += 1;
    if (hit) summary.spyHits += 1;
  }
  if (group === "equity" || group === "cushion" || group === "gold") {
    summary.equityN += 1;
    if (hit) summary.equityHits += 1;
  }
  summary.rate = summary.n > 0 ? summary.hits / summary.n : null;
  summary.spyRate = summary.spyN > 0 ? summary.spyHits / summary.spyN : null;
  summary.equityRate = summary.equityN > 0 ? summary.equityHits / summary.equityN : null;
}

export function hitSentence(hit: HitSummary): string {
  if (hit.equityN < 24 || hit.equityRate == null) return `株と金で方向を出したのが${hit.equityN}回で、まだ少ない。的中率は出さない。`;
  const pct = Math.round(hit.equityRate * 100);
  const spy = hit.spyRate == null ? "" : `米国株（SPY）だけは${hit.spyN}回中${Math.round(hit.spyRate * 100)}%。`;
  const all = hit.rate == null ? "" : `債券を含めた全体は${hit.n}回中${Math.round(hit.rate * 100)}%。`;
  const note =
    hit.equityRate < 0.53 ? "半分に近く、方向の当てには頼れない。" : hit.equityRate < 0.58 ? "コインより少し高い程度で、大きくは頼れない。" : "この期間は方向が半分より多かった。これからも当たるとは限らない。";
  return `学習に使っていない月で、株と金について上昇か下落と言った${hit.equityN}回のうち当たったのは${pct}%。${spy}${all}${note}`;
}

export function feeSentence(perf: Perf): string {
  if (!(perf.years > 0) || !(perf.budget > 0)) return "";
  const annual = perf.commissionUsd / perf.years / perf.budget;
  const perYear = Math.round(perf.orders / perf.years);
  return `手数料はおおよそ年${(annual * 100).toFixed(1)}%（売買代金の0.01%は別）。注文は1年におおよそ${perYear}件。小さなずれは見送るが、銘柄の出入りは残る。元手が小さいと手数料の比率が大きくなる。`;
}

export const FEATURES = [
  { key: "mom1", label: "1か月の値動き" },
  { key: "mom3", label: "3か月の値動き" },
  { key: "mom6", label: "6か月の値動き" },
  { key: "mom12", label: "12か月の勢い（直近1か月を除く）" },
  { key: "vol20", label: "ここ20日の値動きの大きさ" },
  { key: "vol60", label: "ここ60日の値動きの大きさ" },
  { key: "dd", label: "高値からの落ち込み" },
  { key: "sma", label: "200日平均からの離れ" },
  { key: "spyMom", label: "米国株全体の6か月の勢い" },
  { key: "spyDd", label: "米国株全体の落ち込み" },
  { key: "spyTrend", label: "米国株が200日平均より上か" },
  { key: "vix", label: "恐怖指数（VIX）の高さ" },
  { key: "vixChg", label: "恐怖指数の1か月の変化" },
  { key: "curve", label: "長短金利の差" },
  { key: "curveChg", label: "長短金利の差の3か月変化" },
  { key: "rate", label: "10年金利の高さ" },
  { key: "corrSpy", label: "米国株との連動" },
  { key: "relMom", label: "米国株に対する相対的な勢い" },
] as const;

export type FeatureKey = (typeof FEATURES)[number]["key"];

export function featureLabel(key: string): string {
  return FEATURES.find((feature) => feature.key === key)?.label ?? key;
}

export const LIMITATIONS: readonly string[] = [
  "発注でも推奨でもない。売買するかどうかは自分で決める。証券口座にはつながっていない。",
  "的中率と過去の成績は、学習に使っていない月だけ。学習中の当ては見せない。",
  "過去の並びは、これからを示さない。悪い年はまた来る。",
  "価格は配当を含んだ終値。売買の想定は、合図の翌営業日の終値。実際の約定とはずれる。",
  "手数料は1回0.35ドル。過去検証はその上に売買代金の0.01%を引いている。元手1,000ドルでは手数料の比率が大きい。",
  "AIは、正規化線形回帰を2つの強さで平均し、深さ1の勾配ブースティングとさらに平均したもの。来月のリターンを学ぶ。魔法ではない。",
  "係数は過去の成績を見ていじっていない。良く見えるように選んではいない。",
  "恐怖指数と金利が取れない月は、その材料を外す。",
  "この枠は個別株の売買とは別。QQQは最大12%で、半導体のトレードと重ねすぎないようにしている。",
  "金と長期債は上限付き。200日平均をはっきり下回っているときは、見通しが良くても入れない。",
];

export const ASSUMPTIONS: readonly string[] = [
  "見直しは月に1回。直近の終値で比率を出し、売買は帯の外だけ。",
  "目標との差が3ポイント未満、または25ドル未満なら売買しない。",
  "短期債はSGOVを優先する。履歴が短いあいだはBIL。",
  "株数は端数。口座にある端株のイメージで、この画面は注文を作らない。",
  "含み益は、この画面に入れた取得単価だけを見る。空なら余裕ゼロとして守りを厚くする。",
];

export type RoboLocal = {
  budget: number;
  positions: SleevePosition[];
};

export function sanitizeBudget(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_BUDGET;
  return Math.min(1_000_000, Math.max(100, Math.round(value)));
}

export function sanitizePositions(value: unknown): SleevePosition[] {
  if (!Array.isArray(value)) return [];
  const byTicker = new Map<string, SleevePosition>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const ticker = typeof row.ticker === "string" ? row.ticker.trim().toUpperCase() : "";
    if (!NAME_BY_TICKER.has(ticker)) continue;
    const shares = typeof row.shares === "number" && Number.isFinite(row.shares) && row.shares > 0 ? row.shares : 0;
    const avgCost = typeof row.avgCost === "number" && Number.isFinite(row.avgCost) && row.avgCost > 0 ? row.avgCost : null;
    if (shares <= 0) continue;
    byTicker.set(ticker, { ticker, shares, avgCost });
  }
  return [...byTicker.values()];
}

export function hasRoboLocal(storage: Pick<Storage, "getItem"> | null): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(ROBO_STORAGE_KEY) != null;
  } catch {
    return false;
  }
}

export function loadRoboLocal(storage: Pick<Storage, "getItem"> | null): RoboLocal {
  if (!storage) return { budget: DEFAULT_BUDGET, positions: [] };
  try {
    const text = storage.getItem(ROBO_STORAGE_KEY);
    if (!text) return { budget: DEFAULT_BUDGET, positions: [] };
    const parsed = JSON.parse(text) as { budget?: unknown; positions?: unknown };
    const budget = typeof parsed.budget === "number" ? sanitizeBudget(parsed.budget) : DEFAULT_BUDGET;
    return { budget, positions: sanitizePositions(parsed.positions) };
  } catch {
    return { budget: DEFAULT_BUDGET, positions: [] };
  }
}

export function saveRoboLocal(state: RoboLocal, storage: Pick<Storage, "setItem" | "removeItem">): void {
  const payload = {
    budget: sanitizeBudget(state.budget),
    positions: sanitizePositions(state.positions),
  };
  storage.setItem(ROBO_STORAGE_KEY, JSON.stringify(payload));
}

export function alignTo(calendar: string[], series: { date: string; c: number }[]): (number | null)[] {
  const idx = new Map(calendar.map((date, index) => [date, index]));
  const out: (number | null)[] = new Array(calendar.length).fill(null);
  for (const bar of series) {
    const index = idx.get(bar.date);
    if (index != null && bar.c > 0 && Number.isFinite(bar.c)) out[index] = bar.c;
  }
  let last: number | null = null;
  let lastIndex = -999;
  for (let i = 0; i < out.length; i++) {
    if (out[i] != null) {
      last = out[i];
      lastIndex = i;
    } else if (last != null && i - lastIndex <= 5 && i - lastIndex > 0) {
      out[i] = last;
    }
  }
  return out;
}

export function roundShares(shares: number): number {
  if (!Number.isFinite(shares) || shares <= 0) return 0;
  return Math.round(shares * 10000) / 10000;
}

export function formatShares(shares: number): string {
  if (!Number.isFinite(shares)) return "—";
  const rounded = Math.round(shares * 10000) / 10000;
  if (Math.abs(rounded - Math.round(rounded)) < 1e-9) return String(Math.round(rounded));
  return rounded.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

export function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const sign = value < 0 ? "−" : "";
  const body = Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return `${sign}$${body}`;
}

export function formatPct(fraction: number | null, digits = 1): string {
  if (fraction == null || !Number.isFinite(fraction)) return "—";
  const shown = (fraction * 100).toFixed(digits);
  if (shown.startsWith("-")) return `−${shown.slice(1)}%`;
  return `${shown}%`;
}

function applyMlRisk(equity: number, factors: LiveFactors): { equity: number; shift: MlShift } {
  if (!factors.modelReady || factors.spyForecast == null) return { equity, shift: "same" };
  const pred = clamp(factors.spyForecast, -0.08, 0.08);
  const volHigh = factors.spyVolForecast != null && factors.volCut != null && factors.spyVolForecast > factors.volCut;
  if (pred <= -0.01 || (pred < 0 && volHigh)) return { equity: equity * 0.75, shift: "down" };
  if (pred >= 0.01 && !volHigh) return { equity: equity * 1.08, shift: "up" };
  return { equity, shift: "same" };
}

function allocateRisky(by: Map<string, AssetFactor>, regime: Regime, equity: number, useMl: boolean): { weights: Record<string, number>; allocated: number } {
  const caps = capsFor();
  const cushionBudget = equity * CUSHION_SHARE[regime];
  const cushionNames = CUSHION_TICKERS.filter((ticker) => eligible(by.get(ticker)));
  const cushion = allocateByScore(by, cushionNames, cushionBudget, useMl, caps);
  const broadBudget = Math.max(0, equity - cushion.allocated);
  const broadNames = BROAD_TICKERS.filter((ticker) => eligible(by.get(ticker)));
  const broad = allocateByScore(by, broadNames, broadBudget, useMl, caps);
  return { weights: { ...cushion.weights, ...broad.weights }, allocated: cushion.allocated + broad.allocated };
}

function eligible(asset: AssetFactor | undefined): asset is AssetFactor {
  return !!asset && asset.price != null && asset.price > 0 && asset.trendUp && asset.mom12 != null && asset.mom12 > 0 && asset.vol60 != null && asset.vol60 > 0;
}

function scoreOf(asset: AssetFactor, useMl: boolean): number {
  const base = (asset.mom12 as number) / Math.max(asset.vol60 as number, 0.06);
  if (!useMl || asset.forecast == null || !Number.isFinite(asset.forecast)) return base;
  return base * Math.exp(clamp(asset.forecast, -0.08, 0.08) / 0.04);
}

function allocateByScore(
  by: Map<string, AssetFactor>,
  tickers: string[],
  budget: number,
  useMl: boolean,
  caps: Record<string, number>,
): { weights: Record<string, number>; allocated: number } {
  if (!(budget > 0)) return { weights: {}, allocated: 0 };
  const scored = tickers
    .map((ticker) => ({ ticker, score: scoreOf(by.get(ticker) as AssetFactor, useMl) }))
    .filter((row) => row.score > 0);
  const total = scored.reduce((sum, row) => sum + row.score, 0);
  if (!(total > 0)) return { weights: {}, allocated: 0 };
  const raw: Record<string, number> = {};
  for (const row of scored) raw[row.ticker] = (budget * row.score) / total;
  const weights = project(raw, budget, caps);
  return { weights, allocated: sumRecord(weights) };
}

function blendToBudget(rule: Record<string, number>, ml: Record<string, number>, budget: number, caps: Record<string, number>): Record<string, number> {
  const keys = new Set([...Object.keys(rule), ...Object.keys(ml)]);
  const raw: Record<string, number> = {};
  for (const key of keys) {
    const base = rule[key] ?? 0;
    const tilted = ml[key] ?? 0;
    raw[key] = clamp(tilted, base - ML_TILT_BAND, base + ML_TILT_BAND);
  }
  return project(raw, budget, caps);
}

function project(raw: Record<string, number>, budget: number, caps: Record<string, number>): Record<string, number> {
  const weights: Record<string, number> = {};
  for (const [ticker, weight] of Object.entries(raw)) {
    if (weight > 0) weights[ticker] = weight;
  }
  for (let pass = 0; pass < 6; pass++) {
    for (const ticker of Object.keys(weights)) {
      const cap = caps[ticker] ?? NAME_CAP;
      if (weights[ticker] > cap) weights[ticker] = cap;
    }
    const total = sumRecord(weights);
    if (total <= 1e-12) return {};
    if (Math.abs(total - budget) < 1e-8) break;
    const room = Object.keys(weights).filter((ticker) => weights[ticker] < (caps[ticker] ?? NAME_CAP) - 1e-8);
    if (total > budget) {
      const factor = budget / total;
      for (const ticker of Object.keys(weights)) weights[ticker] *= factor;
      continue;
    }
    if (room.length === 0) break;
    const gap = budget - total;
    const roomSum = room.reduce((sum, ticker) => sum + weights[ticker], 0);
    if (roomSum <= 0) break;
    for (const ticker of room) weights[ticker] += gap * (weights[ticker] / roomSum);
  }
  for (const ticker of Object.keys(weights)) {
    if (weights[ticker] <= 1e-8) delete weights[ticker];
  }
  return weights;
}

function goldWeight(asset: AssetFactor | undefined, modelReady: boolean): number {
  if (!asset || asset.price == null || !(asset.price > 0)) return 0;
  const trendOk = asset.trendUp && (asset.mom12 ?? -1) > 0;
  if (trendOk) return Math.min(GOLD_CAP, 0.06);
  if (modelReady && justifyAlt(asset)) return Math.min(GOLD_CAP, 0.05);
  return 0;
}

function altBondWeight(asset: AssetFactor | undefined, modelReady: boolean, room: number, cap: number, trendShare: number, mlShare: number): number {
  if (!asset || asset.price == null || !(asset.price > 0) || room <= 0) return 0;
  const trendOk = asset.trendUp && (asset.mom12 ?? -1) > 0;
  if (trendOk) return Math.min(cap, room * trendShare);
  if (modelReady && justifyAlt(asset)) return Math.min(cap, room * mlShare);
  return 0;
}

function justifyAlt(asset: AssetFactor): boolean {
  const view = classifyForecast(asset.forecast, asset.ridge, asset.gbm);
  if (view.direction !== "up" || view.confidence === "low") return false;
  if (asset.distSma == null || asset.distSma < -0.03) return false;
  return true;
}

function applyVolTarget(weights: Record<string, number>, by: Map<string, AssetFactor>, factors: LiveFactors): void {
  const est = estimateVol(weights, by);
  if (!(est > 0.12)) return;
  const factor = 0.1 / est;
  const floating = Object.keys(weights).filter((ticker) => !SHORT_TICKERS.includes(ticker));
  for (const ticker of floating) weights[ticker] *= factor;
  let riskSum = floating.reduce((sum, ticker) => sum + (weights[ticker] ?? 0), 0);
  if (riskSum > EQUITY_CEILING) {
    const scale = EQUITY_CEILING / riskSum;
    for (const ticker of floating) weights[ticker] *= scale;
    riskSum = EQUITY_CEILING;
  }
  for (const ticker of SHORT_TICKERS) delete weights[ticker];
  const defensive = Math.max(0, 1 - riskSum);
  const shyW = factors.shyOk ? defensive * 0.35 : 0;
  if (shyW > 0) weights.SHY = shyW;
  weights[factors.cashTicker] = defensive - shyW;
}

export function estimateVol(weights: Record<string, number>, by: Map<string, AssetFactor>): number {
  let sum = 0;
  let sumSq = 0;
  for (const [ticker, weight] of Object.entries(weights)) {
    if (!(weight > 0)) continue;
    const vol = volOf(by.get(ticker), ticker);
    sum += weight * vol;
    sumSq += weight * weight * vol * vol;
  }
  const corr = 0.45;
  return Math.sqrt(Math.max(0, (1 - corr) * sumSq + corr * sum * sum));
}

function volOf(asset: AssetFactor | undefined, ticker: string): number {
  if (asset?.vol60 != null && asset.vol60 > 0) return asset.vol60;
  if (ticker === "SGOV" || ticker === "BIL") return 0.005;
  if (ticker === "SHY") return 0.015;
  return 0.12;
}

function moveDustToCash(weights: Record<string, number>, cash: string): void {
  let dust = 0;
  for (const [ticker, weight] of Object.entries(weights)) {
    if (ticker === cash || ticker === "SHY") continue;
    if (weight < 0.02) {
      dust += weight;
      delete weights[ticker];
    }
  }
  weights[cash] = (weights[cash] ?? 0) + dust;
}

function enforceHardCaps(weights: Record<string, number>, cash: string): void {
  const caps = { ...capsFor(), GLD: GOLD_CAP, IEF: IEF_CAP, TLT: TLT_CAP };
  let extra = 0;
  for (const [ticker, cap] of Object.entries(caps)) {
    const weight = weights[ticker] ?? 0;
    if (weight > cap) {
      extra += weight - cap;
      weights[ticker] = cap;
    }
  }
  weights[cash] = (weights[cash] ?? 0) + extra;
}

function capsFor(): Record<string, number> {
  const caps: Record<string, number> = {};
  for (const asset of ROBO_UNIVERSE) caps[asset.ticker] = asset.ticker === "QQQ" ? QQQ_CAP : NAME_CAP;
  return caps;
}

function roundToCash(weights: Record<string, number>, cash: string): Record<string, number> {
  const out: Record<string, number> = {};
  let sum = 0;
  for (const [ticker, weight] of Object.entries(weights)) {
    if (ticker === cash) continue;
    const rounded = Math.max(0, Math.round(weight * 10000) / 10000);
    if (rounded > 0) {
      out[ticker] = rounded;
      sum += rounded;
    }
  }
  const cashW = Math.round((1 - sum) * 10000) / 10000;
  if (cashW > 0) out[cash] = cashW;
  else if (cashW < -1e-6) {
    const keys = Object.keys(out);
    const total = sum;
    let again = 0;
    for (const key of keys) {
      out[key] = Math.max(0, Math.round(out[key] * (1 / total) * 10000) / 10000);
      again += out[key];
    }
    const fix = Object.keys(out)[0];
    if (fix) out[fix] = Math.round((out[fix] + (1 - again)) * 10000) / 10000;
  }
  return out;
}

function roundBuckets(weights: number[]): number[] {
  const raw = weights.map((weight) => Math.max(0, weight * 100));
  const floors = raw.map((weight) => Math.floor(weight));
  let left = 100 - floors.reduce((sum, weight) => sum + weight, 0);
  const order = raw
    .map((weight, index) => ({ index, frac: weight - Math.floor(weight) }))
    .sort((a, b) => b.frac - a.frac || a.index - b.index);
  const out = [...floors];
  for (let i = 0; i < order.length && left > 0; i++) {
    out[order[i].index] += 1;
    left -= 1;
  }
  if (left > 0 && out.length > 0) out[0] += left;
  return out;
}

function paceWord(left: number | null, right: number | null): string {
  if (left == null || right == null) return "比べられない";
  const gap = left - right;
  if (Math.abs(gap) < 0.01) return "ほぼ同じ";
  return gap > 0 ? "速く" : "遅く";
}

function dropWord(left: number | null, right: number | null): string {
  if (left == null || right == null) return "比べられない";
  const gap = Math.abs(left) - Math.abs(right);
  if (Math.abs(gap) < 0.02) return "ほぼ同じ";
  return gap < 0 ? "小さい" : "大きい";
}

function sumTickers(weights: Record<string, number>, tickers: string[]): number {
  let sum = 0;
  for (const ticker of tickers) sum += weights[ticker] ?? 0;
  return sum;
}

function sumRecord(weights: Record<string, number>): number {
  let sum = 0;
  for (const weight of Object.values(weights)) sum += weight;
  return sum;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}
