import { IGNORED_TICKERS } from "./constants";

/**
 * Private holdings. The public repo never carries them: the default source is the
 * HOLDINGS_JSON secret on Render. Another source (a database) can implement HoldingsSource.
 */
export type Holding = {
  ticker: string;
  shares: number;
  /** Average cost per share in USD. Null when not entered. */
  avgCost: number | null;
  /** Close under this is the review signal. Null when not entered. */
  reviewLine: number | null;
  note: string | null;
};

export type UnsettledCash = {
  amountUsd: number;
  settleDate: string;
};

export type HoldingsConfig = {
  holdings: Holding[];
  cash: {
    usdSettled: number | null;
    usdUnsettled: UnsettledCash[];
    jpy: number | null;
  };
  defenseLineJpy: number | null;
  /** Problems found while reading. Shown on the private pages, never the values themselves. */
  warnings: string[];
};

export type HoldingsSource = {
  id: string;
  load(): HoldingsConfig;
  /** Changes whenever the stored holdings change, so derived payloads can be memoized. */
  stamp(): string;
};

export const HOLDINGS_ENV = "HOLDINGS_JSON";

const TICKER_RE = /^[A-Z][A-Z0-9.\-=^]{0,11}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const IGNORED = new Set<string>(IGNORED_TICKERS);

export function emptyHoldings(warnings: string[] = []): HoldingsConfig {
  return {
    holdings: [],
    cash: { usdSettled: null, usdUnsettled: [], jpy: null },
    defenseLineJpy: null,
    warnings,
  };
}

export function isIgnoredTicker(ticker: string): boolean {
  return IGNORED.has(ticker.trim().toUpperCase());
}

/**
 * Accepts either `{ "holdings": [...], "cash": {...}, "defenseLineJpy": n }` or a bare holdings array.
 * Bad rows are skipped with a warning instead of failing the whole page.
 */
export function parseHoldingsJson(text: string | undefined | null): HoldingsConfig {
  if (text == null || text.trim() === "") return emptyHoldings();
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return emptyHoldings([`${HOLDINGS_ENV} がJSONとして読めない`]);
  }
  const root: Record<string, unknown> = Array.isArray(doc)
    ? { holdings: doc }
    : doc && typeof doc === "object"
      ? (doc as Record<string, unknown>)
      : {};
  const warnings: string[] = [];
  const rows = Array.isArray(root.holdings) ? root.holdings : [];
  if (!Array.isArray(root.holdings) && !Array.isArray(doc)) warnings.push("holdings が配列ではない");

  const byTicker = new Map<string, Holding>();
  rows.forEach((raw, index) => {
    if (!raw || typeof raw !== "object") {
      warnings.push(`holdings[${index}] がオブジェクトではない`);
      return;
    }
    const row = raw as Record<string, unknown>;
    const ticker = typeof row.ticker === "string" ? row.ticker.trim().toUpperCase() : "";
    if (!TICKER_RE.test(ticker)) {
      warnings.push(`holdings[${index}].ticker が不正`);
      return;
    }
    if (IGNORED.has(ticker)) return;
    const shares = positive(row.shares);
    if (shares == null) {
      warnings.push(`${ticker} の shares は正の数`);
      return;
    }
    if (byTicker.has(ticker)) warnings.push(`${ticker} が重複。後の行を使う`);
    byTicker.set(ticker, {
      ticker,
      shares,
      avgCost: positive(row.avgCost),
      reviewLine: positive(row.reviewLine),
      note: typeof row.note === "string" && row.note.trim() ? row.note.trim() : null,
    });
  });

  const cashRaw = root.cash && typeof root.cash === "object" ? (root.cash as Record<string, unknown>) : {};
  const unsettled: UnsettledCash[] = [];
  if (Array.isArray(cashRaw.usdUnsettled)) {
    for (const item of cashRaw.usdUnsettled) {
      if (!item || typeof item !== "object") continue;
      const entry = item as Record<string, unknown>;
      const amount = nonNegative(entry.amountUsd);
      const date = typeof entry.settleDate === "string" && DATE_RE.test(entry.settleDate) ? entry.settleDate : null;
      if (amount == null || !date) {
        warnings.push("cash.usdUnsettled の行は amountUsd と settleDate(YYYY-MM-DD)");
        continue;
      }
      unsettled.push({ amountUsd: amount, settleDate: date });
    }
  }

  return {
    holdings: [...byTicker.values()],
    cash: {
      usdSettled: nonNegative(cashRaw.usdSettled),
      usdUnsettled: unsettled,
      jpy: nonNegative(cashRaw.jpy),
    },
    defenseLineJpy: positive(root.defenseLineJpy),
    warnings,
  };
}

export function envHoldingsSource(env: Record<string, string | undefined> = process.env): HoldingsSource {
  let memo: { raw: string; config: HoldingsConfig } | null = null;
  const raw = () => env[HOLDINGS_ENV] ?? "";
  return {
    id: "env",
    load() {
      const text = raw();
      if (memo?.raw === text) return memo.config;
      const config = parseHoldingsJson(text);
      if (config.warnings.length > 0) console.error(`[range] holdings: ${config.warnings.join(" / ")}`);
      memo = { raw: text, config };
      return config;
    },
    stamp() {
      return String(hash(raw()));
    },
  };
}

let source: HoldingsSource = envHoldingsSource();

export function holdingsSource(): HoldingsSource {
  return source;
}

/** Tests and a future database source swap the default here. */
export function setHoldingsSource(next: HoldingsSource): void {
  source = next;
}

function positive(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function nonNegative(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
