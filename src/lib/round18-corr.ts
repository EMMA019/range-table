import { applySectorCaps, type Round18Meta } from "./round18-portfolio";

export const ROUND18_CORR_LOOKBACK = 252;
export const ROUND18_CORR_MIN_OBS = 126;
export const ROUND18_CORR_PAIR_MAX = 0.7;

export type CorrPickVariant = "corrdiverse" | "corrdiverse_volprune";

function tradingDayIndex(calendar: string[], date: string): number {
  let lo = 0;
  let hi = calendar.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (calendar[mid] <= date) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/** Log returns aligned to calendar[endIdx-lookback+1 .. endIdx] (inclusive). */
export function trailingLogReturns(
  calendar: string[],
  closes: Map<string, number>,
  date: string,
  lookback = ROUND18_CORR_LOOKBACK,
): number[] | null {
  const endIdx = tradingDayIndex(calendar, date);
  if (endIdx < lookback - 1) return null;
  const rets: number[] = [];
  for (let i = endIdx - lookback + 1; i <= endIdx; i += 1) {
    const p0 = closes.get(calendar[i - 1]);
    const p1 = closes.get(calendar[i]);
    if (p0 == null || p1 == null || p0 <= 0 || p1 <= 0) return null;
    rets.push(Math.log(p1 / p0));
  }
  return rets.length === lookback ? rets : null;
}

export function annualizedVolFromReturns(rets: number[]): number {
  if (rets.length < 2) return Infinity;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const var_ = rets.reduce((a, r) => a + (r - mean) ** 2, 0) / rets.length;
  return Math.sqrt(var_) * Math.sqrt(252);
}

export function pearsonCorrelation(a: number[], b: number[]): number | null {
  if (a.length !== b.length || a.length < 2) return null;
  const n = a.length;
  const ma = a.reduce((s, x) => s + x, 0) / n;
  const mb = b.reduce((s, x) => s + x, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i += 1) {
    const xa = a[i] - ma;
    const xb = b[i] - mb;
    num += xa * xb;
    da += xa * xa;
    db += xb * xb;
  }
  const den = Math.sqrt(da * db);
  if (!(den > 0)) return null;
  return num / den;
}

export type CorrInputs = {
  tickers: string[];
  returns: Map<string, number[]>;
  vol: Map<string, number>;
};

export function buildCorrInputs(
  tickers: string[],
  calendar: string[],
  closeHistory: Map<string, Map<string, number>>,
  date: string,
): CorrInputs | null {
  const returns = new Map<string, number[]>();
  const vol = new Map<string, number>();
  const ok: string[] = [];
  for (const t of tickers) {
    const hist = closeHistory.get(t);
    if (!hist) continue;
    const rets = trailingLogReturns(calendar, hist, date);
    if (!rets || rets.length < ROUND18_CORR_MIN_OBS) continue;
    returns.set(t, rets);
    vol.set(t, annualizedVolFromReturns(rets));
    ok.push(t);
  }
  if (ok.length < 2) return null;
  ok.sort((a, b) => a.localeCompare(b));
  return { tickers: ok, returns, vol };
}

export function correlationMatrix(inputs: CorrInputs): Map<string, Map<string, number>> {
  const { tickers, returns } = inputs;
  const out = new Map<string, Map<string, number>>();
  for (const a of tickers) {
    const row = new Map<string, number>();
    row.set(a, 1);
    const ra = returns.get(a)!;
    for (const b of tickers) {
      if (a === b) continue;
      const rb = returns.get(b)!;
      const c = pearsonCorrelation(ra, rb);
      row.set(b, c ?? 0);
    }
    out.set(a, row);
  }
  return out;
}

function avgCorrToUniverse(ticker: string, universe: string[], corr: Map<string, Map<string, number>>): number {
  if (universe.length <= 1) return 0;
  let sum = 0;
  let n = 0;
  const row = corr.get(ticker);
  if (!row) return Infinity;
  for (const other of universe) {
    if (other === ticker) continue;
    sum += row.get(other) ?? 0;
    n += 1;
  }
  return n > 0 ? sum / n : Infinity;
}

export function pruneHighCorrPairs(
  tickers: string[],
  corr: Map<string, Map<string, number>>,
  vol: Map<string, number>,
): string[] {
  let pool = [...tickers].sort((a, b) => a.localeCompare(b));
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < pool.length; i += 1) {
      for (let j = i + 1; j < pool.length; j += 1) {
        const a = pool[i];
        const b = pool[j];
        const c = corr.get(a)?.get(b) ?? 0;
        if (c <= ROUND18_CORR_PAIR_MAX) continue;
        const va = vol.get(a) ?? Infinity;
        const vb = vol.get(b) ?? Infinity;
        let drop: string;
        if (va > vb) drop = a;
        else if (vb > va) drop = b;
        else drop = a.localeCompare(b) > 0 ? a : b;
        pool = pool.filter((t) => t !== drop);
        changed = true;
        break;
      }
      if (changed) break;
    }
  }
  return pool;
}

/** Primary greedy correlation-diverse pick (up to `slots` names). */
export function pickCorrGreedy(
  pool: string[],
  corr: Map<string, Map<string, number>>,
  slots: number,
): string[] {
  const universe = [...pool].sort((a, b) => a.localeCompare(b));
  const order = [...universe].sort((a, b) => {
    const aa = avgCorrToUniverse(a, universe, corr);
    const bb = avgCorrToUniverse(b, universe, corr);
    if (aa !== bb) return aa - bb;
    return a.localeCompare(b);
  });
  const chosen: string[] = [];
  for (const c of order) {
    if (chosen.length >= slots) break;
    let ok = true;
    for (const s of chosen) {
      const pair = corr.get(c)?.get(s) ?? 0;
      if (pair > ROUND18_CORR_PAIR_MAX) {
        ok = false;
        break;
      }
    }
    if (ok) chosen.push(c);
  }
  return chosen;
}

export function pickCorrPortfolio(
  eligible: Round18Meta[],
  n: number,
  calendar: string[],
  closeHistory: Map<string, Map<string, number>>,
  date: string,
  variant: CorrPickVariant,
  price: (ticker: string) => number | null,
): string[] {
  const withPrice = eligible.filter((m) => {
    const p = price(m.ticker);
    return p != null && p > 0;
  });
  const inputs = buildCorrInputs(
    withPrice.map((m) => m.ticker),
    calendar,
    closeHistory,
    date,
  );
  if (!inputs) return [];
  const corr = correlationMatrix(inputs);
  let pool = inputs.tickers;
  if (variant === "corrdiverse_volprune") {
    pool = pruneHighCorrPairs(pool, corr, inputs.vol);
  }
  return pickCorrGreedy(pool, corr, n);
}

export function corrEqualWeights(
  picked: string[],
  eligible: Round18Meta[],
): Record<string, number> {
  if (!picked.length) return {};
  const metaBy = new Map(eligible.map((m) => [m.ticker, m]));
  const raw: Record<string, number> = {};
  for (const t of picked) raw[t] = 1 / picked.length;
  return applySectorCaps(raw, metaBy);
}

/** Single-linkage order from distance 1-|rho| (for heatmap labels). */
export function hierarchicalClusterOrder(corr: Map<string, Map<string, number>>, tickers: string[]): string[] {
  const labels = [...tickers];
  if (labels.length <= 2) return labels.sort((a, b) => a.localeCompare(b));

  type Cluster = { id: number; members: string[]; active: boolean };
  const clusters: Cluster[] = labels.map((t, i) => ({ id: i, members: [t], active: true }));
  let nextId = labels.length;

  const dist = (a: string, b: string) => {
    const rho = corr.get(a)?.get(b) ?? 0;
    return 1 - Math.abs(rho);
  };

  const clusterDist = (ca: Cluster, cb: Cluster): number => {
    let best = Infinity;
    for (const a of ca.members) {
      for (const b of cb.members) {
        best = Math.min(best, dist(a, b));
      }
    }
    return best;
  };

  while (clusters.filter((c) => c.active).length > 1) {
    const active = clusters.filter((c) => c.active);
    let bestI = 0;
    let bestJ = 1;
    let bestD = Infinity;
    for (let i = 0; i < active.length; i += 1) {
      for (let j = i + 1; j < active.length; j += 1) {
        const d = clusterDist(active[i], active[j]);
        if (d < bestD) {
          bestD = d;
          bestI = i;
          bestJ = j;
        }
      }
    }
    const ca = active[bestI];
    const cb = active[bestJ];
    ca.active = false;
    cb.active = false;
    clusters.push({
      id: nextId++,
      members: [...ca.members, ...cb.members],
      active: true,
    });
  }
  const final = clusters.find((c) => c.active);
  return final ? final.members : labels.sort((a, b) => a.localeCompare(b));
}

export function listHighCorrPairs(
  tickers: string[],
  corr: Map<string, Map<string, number>>,
  threshold = ROUND18_CORR_PAIR_MAX,
): Array<{ a: string; b: string; rho: number }> {
  const out: Array<{ a: string; b: string; rho: number }> = [];
  const sorted = [...tickers].sort((a, b) => a.localeCompare(b));
  for (let i = 0; i < sorted.length; i += 1) {
    for (let j = i + 1; j < sorted.length; j += 1) {
      const a = sorted[i];
      const b = sorted[j];
      const rho = corr.get(a)?.get(b) ?? 0;
      if (rho > threshold) out.push({ a, b, rho });
    }
  }
  return out.sort((x, y) => y.rho - x.rho || x.a.localeCompare(y.a));
}

/** SDI: survivors first, then fill with corr-greedy from eligible (semi cap). */
export function pickSdiCorrStocks(
  survivors: string[],
  eligible: string[],
  metaBy: Map<string, { semiBucket: boolean }>,
  calendar: string[],
  closeHistory: Map<string, Map<string, number>>,
  date: string,
  variant: CorrPickVariant,
  slots = 15,
  maxSemi = 4,
): string[] {
  const out = [...survivors];
  const semiCount = () => out.filter((t) => metaBy.get(t)?.semiBucket).length;
  const inputs = buildCorrInputs(eligible, calendar, closeHistory, date);
  if (!inputs) return out.slice(0, slots);
  const corr = correlationMatrix(inputs);
  let pool = inputs.tickers.filter((t) => !out.includes(t));
  if (variant === "corrdiverse_volprune") {
    pool = pruneHighCorrPairs(pool, corr, inputs.vol);
  }
  const universe = pool;
  const order = [...universe].sort((a, b) => {
    const aa = avgCorrToUniverse(a, universe, corr);
    const bb = avgCorrToUniverse(b, universe, corr);
    if (aa !== bb) return aa - bb;
    return a.localeCompare(b);
  });
  for (const c of order) {
    if (out.length >= slots) break;
    const meta = metaBy.get(c);
    if (!meta) continue;
    if (meta.semiBucket && semiCount() >= maxSemi) continue;
    let ok = true;
    for (const s of out) {
      if ((corr.get(c)?.get(s) ?? 0) > ROUND18_CORR_PAIR_MAX) {
        ok = false;
        break;
      }
    }
    if (ok) out.push(c);
  }
  return out.slice(0, slots);
}
