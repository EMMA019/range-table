import fs from "fs";
import path from "path";
import { parse } from "yaml";
import type {
  EarningsStatus,
  WatchGroup,
  WatchTicker,
  Watchlist,
} from "./types";

const TICKER_RE = /^[A-Z][A-Z0-9.]{0,9}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^[a-z0-9-]+$/;
const STATUSES = new Set<EarningsStatus>(["confirmed", "estimated"]);

export function watchlistPath(): string {
  return path.join(process.cwd(), "data", "watchlist.yaml");
}

export function loadWatchlist(file = watchlistPath()): Watchlist {
  const text = fs.readFileSync(file, "utf8");
  const doc = parse(text);
  return validateWatchlist(doc);
}

export function validateWatchlist(doc: unknown): Watchlist {
  if (!doc || typeof doc !== "object" || !("groups" in doc) || !Array.isArray(doc.groups)) {
    throw new Error("watchlist.yaml に groups がない");
  }

  const errors: string[] = [];
  const seen = new Set<string>();
  const groups: WatchGroup[] = [];

  doc.groups.forEach((group: unknown, groupIndex: number) => {
    if (!group || typeof group !== "object") {
      errors.push(`groups[${groupIndex}] がオブジェクトではない`);
      return;
    }
    const id = stringField(group, "id");
    const name = stringField(group, "name");
    if (!id || !ID_RE.test(id)) errors.push(`groups[${groupIndex}].id が不正`);
    if (!name) errors.push(`groups[${groupIndex}].name が空`);
    const rawTickers = "tickers" in group && Array.isArray(group.tickers) ? group.tickers : null;
    if (!rawTickers) {
      errors.push(`${id || groupIndex} に tickers がない`);
      return;
    }

    const tickers: WatchTicker[] = [];
    rawTickers.forEach((raw: unknown, tickerIndex: number) => {
      const where = `${id || groupIndex}#${tickerIndex + 1}`;
      if (!raw || typeof raw !== "object") {
        errors.push(`${where} がオブジェクトではない`);
        return;
      }
      const ticker = stringField(raw, "ticker")?.toUpperCase() ?? "";
      const description = stringField(raw, "description") ?? "";
      if (!TICKER_RE.test(ticker)) errors.push(`${where} の ticker が不正 (${ticker || "空"})`);
      if (!description) errors.push(`${ticker || where} の description が空`);
      if (ticker && seen.has(ticker)) errors.push(`${ticker} が重複している`);
      if (ticker) seen.add(ticker);

      const notes = stringField(raw, "notes") ?? "";
      const watchOnly = boolField(raw, "watchOnly");
      const tags = tagsField(raw, ticker, errors);
      const earnings = earningsField(raw, ticker, errors);

      tickers.push({
        ticker,
        description,
        notes,
        tags,
        watchOnly,
        earnings,
      });
    });

    groups.push({ id: id ?? "", name: name ?? "", tickers });
  });

  if (groups.length === 0) errors.push("グループが空");
  if (errors.length > 0) {
    throw new Error(`watchlist.yaml を読めない:\n${errors.join("\n")}`);
  }
  return { groups };
}

function stringField(obj: object, key: string): string | null {
  if (!(key in obj)) return null;
  const value = (obj as Record<string, unknown>)[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function boolField(obj: object, key: string): boolean {
  if (!(key in obj)) return false;
  return (obj as Record<string, unknown>)[key] === true;
}

function tagsField(obj: object, ticker: string, errors: string[]): string[] {
  if (!("tags" in obj) || (obj as Record<string, unknown>).tags == null) return [];
  const value = (obj as Record<string, unknown>).tags;
  if (!Array.isArray(value) || value.some((tag) => typeof tag !== "string" || !tag.trim())) {
    errors.push(`${ticker} の tags が文字列の配列ではない`);
    return [];
  }
  return value.map((tag) => tag.trim());
}

function earningsField(
  obj: object,
  ticker: string,
  errors: string[],
): WatchTicker["earnings"] {
  if (!("earnings" in obj) || (obj as Record<string, unknown>).earnings == null) return null;
  const value = (obj as Record<string, unknown>).earnings;
  if (!value || typeof value !== "object") {
    errors.push(`${ticker} の earnings が不正`);
    return null;
  }
  const date = stringField(value, "date");
  const status = stringField(value, "status");
  if (!date || !DATE_RE.test(date)) errors.push(`${ticker} の earnings.date は YYYY-MM-DD`);
  if (!status || !STATUSES.has(status as EarningsStatus)) {
    errors.push(`${ticker} の earnings.status は confirmed か estimated`);
  }
  if (!date || !status || !STATUSES.has(status as EarningsStatus)) return null;
  return { date, status: status as EarningsStatus };
}
