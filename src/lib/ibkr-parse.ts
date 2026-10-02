import { etWallTimeMs, todayEt } from "./calendar";
import { IGNORED_TICKERS } from "./constants";
import { column, parseCsv, parseNumber, readSections, type Section } from "./ibkr-csv";

/**
 * One execution (or one order, when the statement aggregates them). Only these fields are kept in
 * the browser; account numbers and the raw CSV are never stored.
 */
export type Fill = {
  /** Same fill → same id across re-imports and across both export formats. */
  id: string;
  source: "activity" | "history";
  symbol: string;
  /** UTC ISO when the statement has a time of day. */
  tradeAt: string | null;
  /** US session date (ET). */
  tradeDate: string;
  side: "BUY" | "SELL";
  qty: number;
  price: number;
  /** USD, zero or negative. */
  commission: number;
  /** IBKR's own realized P/L on sells (fees included), for reconciliation. */
  ibkrRealized: number | null;
};

export type ParseReport = {
  format: "activity" | "history" | null;
  fills: Fill[];
  skipped: Array<{ reason: string; count: number }>;
  warnings: string[];
};

const A = {
  discriminator: ["DataDiscriminator"],
  asset: ["Asset Category", "資産カテゴリ", "資産区分"],
  currency: ["Currency", "通貨"],
  symbol: ["Symbol", "銘柄コード", "シンボル"],
  dateTime: ["Date/Time", "日時", "日付/時間"],
  quantity: ["Quantity", "数量"],
  price: ["T. Price", "約定価格", "取引価格"],
  commission: ["Comm/Fee", "Comm in USD", "手数料・費用", "手数料"],
  realized: ["Realized P/L", "実現損益"],
};

const H = {
  date: ["Date", "日付"],
  type: ["Transaction Type", "取引タイプ", "取引種別"],
  symbol: ["Symbol", "シンボル", "銘柄コード"],
  quantity: ["Quantity", "数量"],
  price: ["Price", "価格"],
  priceCurrency: ["Price Currency", "価格通貨"],
  commission: ["Commission", "手数料"],
};

const STOCK_ASSETS = new Set(["stocks", "stock", "株式", "株"]);
const NON_STOCK_ASSET_RE = /forex|外国為替|為替|fx|option|オプション|future|先物|bond|債券|crypto|暗号|cfd|warrant|ワラント/i;
const STOCK_SYMBOL_RE = /^[A-Z][A-Z0-9]{0,5}(\.[A-Z])?$/;
const IGNORED = new Set<string>(IGNORED_TICKERS);

function normalizeSymbol(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, ".");
}

/** "2026-09-29, 10:31:45" / "2026-09-29;10:31:45" / "20260929;103145" / "2026/09/29". */
export function splitDateTime(raw: string): { date: string; minutes: number | null; seconds: number } | null {
  const match = /^(\d{4})[-/]?(\d{2})[-/]?(\d{2})(?:[,;\sT]+(\d{1,2}):?(\d{2}):?(\d{2})?)?/.exec(raw.trim());
  if (!match) return null;
  const [, y, m, d, hh, mm, ss] = match;
  return {
    date: `${y}-${m}-${d}`,
    minutes: hh != null ? Number(hh) * 60 + Number(mm) : null,
    seconds: ss != null ? Number(ss) : 0,
  };
}

/**
 * Statements print times in the account's zone. US regular hours are 09:30–16:00 ET, which is
 * 22:30–06:00 in Tokyo, so the clock times themselves tell which zone was used.
 */
export function guessZone(minutes: number[]): "ET" | "JST" {
  let et = 0;
  let tokyo = 0;
  for (const value of minutes) {
    if (value >= 9 * 60 + 30 && value <= 16 * 60) et += 1;
    if (value >= 22 * 60 + 30 || value <= 6 * 60) tokyo += 1;
  }
  return tokyo > et ? "JST" : "ET";
}

function instant(date: string, minutes: number, seconds: number, zone: "ET" | "JST"): number {
  if (zone === "ET") return etWallTimeMs(date, minutes) + seconds * 1000;
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d, 0, minutes, seconds) - 9 * 3_600_000;
}

class Counter {
  private counts = new Map<string, number>();
  add(reason: string) {
    this.counts.set(reason, (this.counts.get(reason) ?? 0) + 1);
  }
  list() {
    return [...this.counts.entries()].map(([reason, count]) => ({ reason, count }));
  }
}

/** Occurrence-numbered ids: two identical fills on one day stay two fills, a re-import maps onto them. */
function assignIds(fills: Omit<Fill, "id">[]): Fill[] {
  const seen = new Map<string, number>();
  return fills.map((fill) => {
    const key = `${fill.symbol}:${fill.tradeDate}:${fill.side}:${fill.qty}:${fill.price.toFixed(4)}`;
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    return { ...fill, id: `${key}:${n}` };
  });
}

function isStockTrades(section: Section): boolean {
  const h = section.header;
  return [A.symbol, A.dateTime, A.quantity, A.price, A.commission, A.realized].every((aliases) => column(h, aliases) >= 0);
}

function isHistory(section: Section): boolean {
  const h = section.header;
  return [H.date, H.type, H.symbol, H.quantity, H.price].every((aliases) => column(h, aliases) >= 0);
}

function parseActivity(sections: Section[], skipped: Counter, warnings: string[]): Omit<Fill, "id">[] {
  type Row = { symbol: string; date: string; minutes: number | null; seconds: number; qty: number; price: number; commission: number; realized: number | null };
  const picked: Row[] = [];
  for (const section of sections) {
    const h = section.header;
    const col = Object.fromEntries(Object.entries(A).map(([key, aliases]) => [key, column(h, aliases)])) as Record<keyof typeof A, number>;
    const kinds = new Set(section.rows.map((row) => (col.discriminator >= 0 ? row[col.discriminator]?.trim() : "")));
    const wanted = kinds.has("Order") ? "Order" : null;
    for (const row of section.rows) {
      const kind = col.discriminator >= 0 ? row[col.discriminator]?.trim() ?? "" : "";
      if (kind === "ClosedLot" || (wanted && kind !== wanted)) continue;
      const asset = col.asset >= 0 ? row[col.asset]?.trim() ?? "" : "";
      const symbol = normalizeSymbol(row[col.symbol] ?? "");
      const currency = col.currency >= 0 ? row[col.currency]?.trim().toUpperCase() ?? "" : "USD";
      if (NON_STOCK_ASSET_RE.test(asset) || (!STOCK_ASSETS.has(asset.toLowerCase()) && !STOCK_SYMBOL_RE.test(symbol))) {
        skipped.add(`株以外（${asset || "資産カテゴリなし"}）`);
        continue;
      }
      if (currency !== "USD") {
        skipped.add(`USD以外（${currency}）`);
        continue;
      }
      if (IGNORED.has(symbol)) {
        skipped.add(`対象外（${symbol}）`);
        continue;
      }
      const when = splitDateTime(row[col.dateTime] ?? "");
      const qty = parseNumber(row[col.quantity]);
      const price = parseNumber(row[col.price]);
      if (!when || qty == null || qty === 0 || price == null || price <= 0 || !STOCK_SYMBOL_RE.test(symbol)) {
        skipped.add("読めない行");
        continue;
      }
      picked.push({
        symbol,
        date: when.date,
        minutes: when.minutes,
        seconds: when.seconds,
        qty,
        price,
        commission: -Math.abs(parseNumber(row[col.commission]) ?? 0),
        realized: parseNumber(row[col.realized]),
      });
    }
  }
  const zone = guessZone(picked.flatMap((row) => (row.minutes != null ? [row.minutes] : [])));
  if (zone === "JST") warnings.push("約定時刻を日本時間として読んだ（米国の取引日に直して集計）");
  return picked.map((row) => {
    const at = row.minutes != null ? instant(row.date, row.minutes, row.seconds, zone) : null;
    return {
      source: "activity" as const,
      symbol: row.symbol,
      tradeAt: at != null ? new Date(at).toISOString() : null,
      tradeDate: at != null ? todayEt(new Date(at)) : row.date,
      side: row.qty > 0 ? ("BUY" as const) : ("SELL" as const),
      qty: Math.abs(row.qty),
      price: row.price,
      commission: row.commission,
      ibkrRealized: row.qty < 0 ? row.realized : null,
    };
  });
}

function parseHistory(sections: Section[], skipped: Counter): Omit<Fill, "id">[] {
  const out: Omit<Fill, "id">[] = [];
  for (const section of sections) {
    const h = section.header;
    const col = Object.fromEntries(Object.entries(H).map(([key, aliases]) => [key, column(h, aliases)])) as Record<keyof typeof H, number>;
    for (const row of section.rows) {
      const type = row[col.type]?.trim() ?? "";
      const side = /buy|買/i.test(type) ? "BUY" : /sell|売/i.test(type) ? "SELL" : null;
      if (!side) {
        skipped.add(`売買以外（${type || "種別なし"}）`);
        continue;
      }
      const currency = col.priceCurrency >= 0 ? row[col.priceCurrency]?.trim().toUpperCase() ?? "" : "USD";
      if (currency && currency !== "USD") {
        skipped.add(`USD以外（${currency}）`);
        continue;
      }
      const symbol = normalizeSymbol(row[col.symbol] ?? "");
      const when = splitDateTime(row[col.date] ?? "");
      const qty = parseNumber(row[col.quantity]);
      const price = parseNumber(row[col.price]);
      if (!STOCK_SYMBOL_RE.test(symbol)) {
        skipped.add("株以外（シンボル）");
        continue;
      }
      if (IGNORED.has(symbol)) {
        skipped.add(`対象外（${symbol}）`);
        continue;
      }
      if (!when || qty == null || qty === 0 || price == null || price <= 0) {
        skipped.add("読めない行");
        continue;
      }
      out.push({
        source: "history",
        symbol,
        tradeAt: null,
        tradeDate: when.date,
        side,
        qty: Math.abs(qty),
        price,
        commission: col.commission >= 0 ? -Math.abs(parseNumber(row[col.commission]) ?? 0) : 0,
        ibkrRealized: null,
      });
    }
  }
  return out;
}

/** Reads either an Activity Statement (English or Japanese) or a Transaction History export. */
export function parseIbkrStatement(text: string): ParseReport {
  const sections = readSections(parseCsv(text));
  const skipped = new Counter();
  const warnings: string[] = [];
  const trades = sections.filter(isStockTrades);
  if (trades.length > 0) {
    return { format: "activity", fills: assignIds(parseActivity(trades, skipped, warnings)), skipped: skipped.list(), warnings };
  }
  const history = sections.filter(isHistory);
  if (history.length > 0) {
    warnings.push("取引履歴は時刻が無いので、同じ日の買いは売りより先として計算");
    return { format: "history", fills: assignIds(parseHistory(history, skipped)), skipped: skipped.list(), warnings };
  }
  return { format: null, fills: [], skipped: [], warnings: ["取引の表が見つからない。IBKRのアクティビティ・ステートメントか取引履歴のCSVを選ぶ"] };
}
