import fs from "node:fs";
import path from "node:path";
import { addDays, etWallTimeMs, isTradingDay } from "./calendar";
import { jst, siteUrl, type AlertItem } from "./alerts";
import { isIgnoredTicker, type Holding } from "./holdings";

export type MaterialNewsItem = {
  id: string;
  ticker: string;
  headline: string;
  url: string | null;
  publishedAt: string;
  source: string;
};

const HOOK_PATH = path.join(process.cwd(), "data", "material_news.json");

export function parseMaterialNews(json: unknown): MaterialNewsItem[] {
  const root = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  const rows = Array.isArray(root.items) ? root.items : [];
  const out: MaterialNewsItem[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const ticker = typeof row.ticker === "string" ? row.ticker.trim().toUpperCase() : "";
    const id = typeof row.id === "string" ? row.id.trim() : "";
    const headline = typeof row.headline === "string" ? row.headline.trim() : "";
    const publishedAt = typeof row.publishedAt === "string" ? row.publishedAt : "";
    if (!ticker || !id || !headline || !Number.isFinite(Date.parse(publishedAt))) continue;
    if (isIgnoredTicker(ticker)) continue;
    out.push({
      id,
      ticker,
      headline,
      url: typeof row.url === "string" && row.url.trim() ? row.url.trim() : null,
      publishedAt: new Date(publishedAt).toISOString(),
      source: typeof row.source === "string" && row.source.trim() ? row.source.trim() : "news",
    });
  }
  return out;
}

export function loadMaterialNews(env: Record<string, string | undefined> = process.env): {
  items: MaterialNewsItem[];
  error: string | null;
} {
  const secret = env.NEWS_JSON;
  if (secret && secret.trim()) {
    try {
      return { items: parseMaterialNews(JSON.parse(secret) as unknown), error: null };
    } catch {
      return { items: [], error: "NEWS_JSON がJSONとして読めない" };
    }
  }
  try {
    const text = fs.readFileSync(HOOK_PATH, "utf8");
    return { items: parseMaterialNews(JSON.parse(text) as unknown), error: null };
  } catch {
    return { items: [], error: null };
  }
}

function previousSession(date: string): string {
  let cursor = date;
  for (let i = 0; i < 10; i += 1) {
    cursor = addDays(cursor, -1);
    if (isTradingDay(cursor)) return cursor;
  }
  return addDays(date, -1);
}

/**
 * Overnight is after the previous session's 16:00 ET close and before 09:30 ET
 * on the next session. Headlines during the cash session are not this alert.
 */
export function isOvernightNews(publishedAt: string, now = new Date()): boolean {
  const at = Date.parse(publishedAt);
  if (!Number.isFinite(at) || at > now.getTime()) return false;
  const etDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const session = isTradingDay(etDate) ? etDate : previousSession(etDate);
  const open = etWallTimeMs(session, 9 * 60 + 30);
  const prevClose = etWallTimeMs(previousSession(session), 16 * 60);
  return at >= prevClose && at < open;
}

/** Holdings only, ONDS excluded, same /api/alerts path as the other private items. */
export function materialNewsAlerts(
  holdings: Holding[],
  items: MaterialNewsItem[],
  now = new Date(),
): AlertItem[] {
  const held = new Set(holdings.map((holding) => holding.ticker).filter((ticker) => !isIgnoredTicker(ticker)));
  const out: AlertItem[] = [];
  for (const item of items) {
    if (!held.has(item.ticker) || isIgnoredTicker(item.ticker)) continue;
    if (!isOvernightNews(item.publishedAt, now)) continue;
    out.push({
      id: `news:${item.ticker}:${item.id}`,
      kind: "material_news",
      priority: "high",
      ticker: item.ticker,
      title: `${item.ticker} 夜間の材料: ${item.headline}`,
      body: [`出典 ${item.source}`, "保有の夜間材料。注文は出さない。"].join("\n"),
      eventAt: item.publishedAt,
      eventAtJst: jst(item.publishedAt),
      url: item.url ?? siteUrl(`/holdings`),
      flags: ["overnight"],
      facts: { source: item.source, publishedAt: item.publishedAt },
    });
  }
  return out;
}
