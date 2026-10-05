import fs from "node:fs";
import path from "node:path";
import { loadSecTickerCikMap } from "./sec-ticker-cik";

export type CikSanityRow = {
  ticker: string;
  cik: number;
  entityName: string | null;
  secTicker: string | null;
  secTitle: string | null;
  factsCik: number | null;
  ok: boolean;
  reason: string;
};

function normTicker(s: string): string {
  return s.trim().toUpperCase().replace(/\./g, "-");
}

export async function loadSecTickerTitleMap(cacheDir: string): Promise<Map<number, { ticker: string; title: string }>> {
  const file = path.join(cacheDir, "company_tickers.json");
  if (!fs.existsSync(file)) return new Map();
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, { cik_str?: number; ticker?: string; title?: string }>;
  const out = new Map<number, { ticker: string; title: string }>();
  for (const row of Object.values(raw)) {
    const cik = row.cik_str;
    const ticker = row.ticker?.trim().toUpperCase();
    const title = row.title?.trim();
    if (cik && ticker && title) out.set(cik, { ticker, title });
  }
  return out;
}

export function checkCikSanity(
  ticker: string,
  cik: number,
  entityName: string | null,
  secByCik: Map<number, { ticker: string; title: string }>,
  factsCik?: number | null,
  secTickerToCik?: Map<string, number>,
): CikSanityRow {
  const sec = secByCik.get(cik);
  const secTicker = sec?.ticker ?? null;
  const secTitle = sec?.title ?? null;
  let ok = true;
  let reason = "ok";

  if (factsCik != null && factsCik > 0 && factsCik !== cik) {
    ok = false;
    reason = `facts CIK ${factsCik}≠map ${cik}`;
  }

  const keys = [ticker, ticker.replace(/\./g, "-"), ticker.replace(/-/g, ".")];
  let secCikForTicker: number | undefined;
  if (secTickerToCik) {
    for (const k of keys) {
      const hit = secTickerToCik.get(k.toUpperCase());
      if (hit) {
        secCikForTicker = hit;
        break;
      }
    }
    if (secCikForTicker != null && secCikForTicker !== cik) {
      ok = false;
      reason = reason === "ok" ? `SEC map CIK ${secCikForTicker}≠${cik}` : `${reason}; SEC map`;
    }
  } else if (!sec && !entityName) {
    ok = false;
    reason = "SEC indexにCIK無し";
  }

  return { ticker, cik, entityName, secTicker, secTitle, factsCik: factsCik ?? null, ok, reason };
}

export async function buildSecMaps(cacheDir: string) {
  const secMap = await loadSecTickerCikMap(cacheDir);
  const secByCik = await loadSecTickerTitleMap(cacheDir);
  return { secMap, secByCik };
}
