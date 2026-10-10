/**
 * Small walk-forward ensemble: two ridge penalties averaged with a stump booster.
 * Training rows are whatever the caller passes. The walker drops any row whose
 * label is not yet known at the decision date, so a later month cannot train an earlier one.
 */

export type Row = {
  x: number[];
  y: number;
  /** Index of the bar that completes the label. Known only at that bar and after. */
  labelEnd: number;
};

export type DensePoint = {
  /** Decision bar. Training may use rows with labelEnd <= index. */
  index: number;
  x: number[];
};

export type Prediction = {
  y: number;
  ridge: number;
  gbm: number;
};

export type Ensemble = {
  predict(x: number[]): Prediction;
  /** Absolute standardized ridge coefficients, intercept excluded. */
  ridgeAbs: number[];
  /** Squared-error reduction by feature across stumps. */
  gbmGain: number[];
};

export type FitOptions = {
  trees?: number;
  learningRate?: number;
  lambdas?: number[];
  thresholds?: number;
};

export const PRODUCTION_FIT: Required<FitOptions> = {
  trees: 12,
  learningRate: 0.1,
  lambdas: [1, 30],
  thresholds: 4,
};

export function fitEnsemble(rows: { x: number[]; y: number }[], options: FitOptions = {}): Ensemble {
  const trees = options.trees ?? PRODUCTION_FIT.trees;
  const learningRate = options.learningRate ?? PRODUCTION_FIT.learningRate;
  const lambdas = options.lambdas ?? PRODUCTION_FIT.lambdas;
  const thresholds = options.thresholds ?? PRODUCTION_FIT.thresholds;
  const raw = rows.map((row) => row.x);
  const y = rows.map((row) => row.y);
  const scale = standardize(raw);
  const zRows = scale.z;
  const ridges = lambdas.map((lambda) => fitRidge(zRows, y, lambda));
  const gbm = trees > 0 ? fitGbm(zRows, y, trees, learningRate, thresholds) : emptyGbm(scale.dim, mean(y));
  const ridgeAbs = averageVectors(ridges.map((model) => model.beta.slice(1).map((value) => Math.abs(value))));
  return {
    predict(x: number[]): Prediction {
      const z = applyScale(x, scale);
      const ridgePreds = ridges.map((model) => dot(model.beta, [1, ...z]));
      const ridge = mean(ridgePreds);
      const gbmY = predictGbm(gbm, z);
      return { y: (ridge + gbmY) / 2, ridge, gbm: gbmY };
    },
    ridgeAbs,
    gbmGain: gbm.gain,
  };
}

export type WalkOptions = FitOptions & {
  minTrain: number;
  onTrain?: (index: number, labelEnds: number[]) => void;
  onModel?: (index: number, model: Ensemble) => void;
};

/** Fit a new ensemble at each decision point using only labels already finished. */
export function walkForward(rows: Row[], points: DensePoint[], options: WalkOptions): Map<number, Prediction> {
  const out = new Map<number, Prediction>();
  const sorted = [...rows].sort((a, b) => a.labelEnd - b.labelEnd || 0);
  const ordered = [...points].sort((a, b) => a.index - b.index);
  const train: Row[] = [];
  let cursor = 0;
  for (const point of ordered) {
    while (cursor < sorted.length && sorted[cursor].labelEnd <= point.index) {
      train.push(sorted[cursor]);
      cursor += 1;
    }
    options.onTrain?.(
      point.index,
      train.map((row) => row.labelEnd),
    );
    if (train.length < options.minTrain || point.x.length === 0) continue;
    const model = fitEnsemble(train, options);
    options.onModel?.(point.index, model);
    out.set(point.index, model.predict(point.x));
  }
  return out;
}

/** Average of L1-normalized ridge and booster importance. Length matches the feature axis. */
export function combinedImportance(model: Ensemble): number[] {
  return averageVectors([l1(model.ridgeAbs), l1(model.gbmGain)]);
}

type Scale = { mean: number[]; std: number[]; z: number[][]; dim: number };

function standardize(raw: number[][]): Scale {
  const n = raw.length;
  const dim = raw[0]?.length ?? 0;
  const meanV = new Array(dim).fill(0);
  for (const row of raw) {
    for (let j = 0; j < dim; j++) meanV[j] += row[j] ?? 0;
  }
  for (let j = 0; j < dim; j++) meanV[j] = n > 0 ? meanV[j] / n : 0;
  const std = new Array(dim).fill(0);
  for (const row of raw) {
    for (let j = 0; j < dim; j++) {
      const d = (row[j] ?? 0) - meanV[j];
      std[j] += d * d;
    }
  }
  for (let j = 0; j < dim; j++) {
    const s = n > 1 ? Math.sqrt(std[j] / (n - 1)) : 0;
    std[j] = s > 1e-8 ? s : 1;
  }
  const z = raw.map((row) => applyScale(row, { mean: meanV, std }));
  return { mean: meanV, std, z, dim };
}

function applyScale(row: number[], scale: Pick<Scale, "mean" | "std">): number[] {
  return scale.mean.map((mu, j) => ((row[j] ?? 0) - mu) / scale.std[j]);
}

type RidgeModel = { beta: number[] };

function fitRidge(z: number[][], y: number[], lambda: number): RidgeModel {
  const n = z.length;
  const dim = z[0]?.length ?? 0;
  const p = dim + 1;
  const xtx: number[][] = Array.from({ length: p }, () => new Array(p).fill(0));
  const xty = new Array(p).fill(0);
  for (let i = 0; i < n; i++) {
    const row = [1, ...z[i]];
    for (let a = 0; a < p; a++) {
      xty[a] += row[a] * y[i];
      for (let b = a; b < p; b++) xtx[a][b] += row[a] * row[b];
    }
  }
  for (let a = 0; a < p; a++) {
    for (let b = 0; b < a; b++) xtx[a][b] = xtx[b][a];
  }
  for (let j = 1; j < p; j++) xtx[j][j] += lambda;
  return { beta: solve(xtx, xty) };
}

type Gbm = {
  meanY: number;
  trees: Stump[];
  gain: number[];
  learningRate: number;
};

type Stump = { feature: number; threshold: number; left: number; right: number };

function emptyGbm(dim: number, meanY: number): Gbm {
  return { meanY, trees: [], gain: new Array(dim).fill(0), learningRate: 0 };
}

function fitGbm(z: number[][], y: number[], trees: number, learningRate: number, thresholds: number): Gbm {
  const n = z.length;
  const dim = z[0]?.length ?? 0;
  const order: number[][] = [];
  for (let j = 0; j < dim; j++) {
    const idx = z.map((_, i) => i);
    idx.sort((a, b) => z[a][j] - z[b][j] || a - b);
    order.push(idx);
  }
  const cuts: number[][] = order.map((idx, j) => quantileCuts(idx.map((i) => z[i][j]), thresholds));
  const pred = new Array(n).fill(mean(y));
  const residual = y.map((value, i) => value - pred[i]);
  const gain = new Array(dim).fill(0);
  const stumps: Stump[] = [];
  for (let t = 0; t < trees; t++) {
    let best: Stump | null = null;
    let bestSse = Infinity;
    let bestGain = 0;
    const total = sseOf(residual);
    for (let j = 0; j < dim; j++) {
      const stump = bestStump(z, residual, order[j], j, cuts[j]);
      if (!stump) continue;
      if (stump.sse < bestSse - 1e-15 || (Math.abs(stump.sse - bestSse) <= 1e-15 && (best == null || j < best.feature))) {
        bestSse = stump.sse;
        bestGain = total - stump.sse;
        best = stump.stump;
      }
    }
    if (!best || bestGain <= 0) break;
    gain[best.feature] += bestGain;
    stumps.push(best);
    for (let i = 0; i < n; i++) {
      const leaf = z[i][best.feature] <= best.threshold ? best.left : best.right;
      residual[i] -= learningRate * leaf;
    }
  }
  return { meanY: mean(y), trees: stumps, gain, learningRate };
}

function bestStump(
  z: number[][],
  residual: number[],
  order: number[],
  feature: number,
  cuts: number[],
): { stump: Stump; sse: number } | null {
  const n = order.length;
  if (n < 4) return null;
  const prefix = new Array(n + 1).fill(0);
  const prefixSq = new Array(n + 1).fill(0);
  for (let i = 0; i < n; i++) {
    const value = residual[order[i]];
    prefix[i + 1] = prefix[i] + value;
    prefixSq[i + 1] = prefixSq[i] + value * value;
  }
  let bestSse = Infinity;
  let best: Stump | null = null;
  for (const threshold of cuts) {
    let leftCount = 0;
    while (leftCount < n && z[order[leftCount]][feature] <= threshold) leftCount += 1;
    if (leftCount < 2 || n - leftCount < 2) continue;
    const sse = segmentSse(prefix, prefixSq, 0, leftCount) + segmentSse(prefix, prefixSq, leftCount, n);
    if (sse < bestSse) {
      bestSse = sse;
      const left = (prefix[leftCount] - prefix[0]) / leftCount;
      const right = (prefix[n] - prefix[leftCount]) / (n - leftCount);
      best = { feature, threshold, left, right };
    }
  }
  return best ? { stump: best, sse: bestSse } : null;
}

function predictGbm(model: Gbm, z: number[]): number {
  let y = model.meanY;
  for (const tree of model.trees) {
    y += model.learningRate * (z[tree.feature] <= tree.threshold ? tree.left : tree.right);
  }
  return y;
}

function quantileCuts(sorted: number[], buckets: number): number[] {
  const cuts: number[] = [];
  const n = sorted.length;
  for (let q = 1; q < buckets; q++) {
    const idx = Math.min(n - 1, Math.max(0, Math.floor((n * q) / buckets)));
    const value = sorted[idx];
    if (cuts.length === 0 || value > cuts[cuts.length - 1] + 1e-12) cuts.push(value);
  }
  return cuts;
}

function segmentSse(prefix: number[], prefixSq: number[], from: number, to: number): number {
  const count = to - from;
  if (count <= 0) return 0;
  const sum = prefix[to] - prefix[from];
  const sumSq = prefixSq[to] - prefixSq[from];
  return Math.max(0, sumSq - (sum * sum) / count);
}

function sseOf(values: number[]): number {
  const mu = mean(values);
  let sse = 0;
  for (const value of values) {
    const d = value - mu;
    sse += d * d;
  }
  return sse;
}

function solve(matrix: number[][], vector: number[]): number[] {
  const n = vector.length;
  const m = matrix.map((row, i) => [...row, vector[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row;
    }
    const hold = m[col];
    m[col] = m[pivot];
    m[pivot] = hold;
    const div = m[col][col];
    if (Math.abs(div) < 1e-12) continue;
    for (let c = col; c <= n; c++) m[col][c] /= div;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = m[row][col];
      if (factor === 0) continue;
      for (let c = col; c <= n; c++) m[row][c] -= factor * m[col][c];
    }
  }
  return m.map((row) => row[n]);
}

function dot(beta: number[], row: number[]): number {
  let sum = 0;
  for (let i = 0; i < beta.length; i++) sum += beta[i] * (row[i] ?? 0);
  return sum;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

function l1(values: number[]): number[] {
  const sum = values.reduce((acc, value) => acc + Math.max(0, value), 0);
  if (sum <= 0) return values.map(() => 0);
  return values.map((value) => Math.max(0, value) / sum);
}

function averageVectors(rows: number[][]): number[] {
  const dim = rows[0]?.length ?? 0;
  const out = new Array(dim).fill(0);
  if (rows.length === 0) return out;
  for (const row of rows) {
    for (let i = 0; i < dim; i++) out[i] += row[i] ?? 0;
  }
  for (let i = 0; i < dim; i++) out[i] /= rows.length;
  return out;
}
