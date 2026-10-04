import fs from "node:fs";
import path from "node:path";
import { edgarJson } from "./edgar-client";

const SEC_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";

/** Full SEC ticker → CIK map (not watchlist-limited). */
export async function loadSecTickerCikMap(cacheDir: string): Promise<Map<string, number>> {
  fs.mkdirSync(cacheDir, { recursive: true });
  const file = path.join(cacheDir, "company_tickers.json");
  if (!fs.existsSync(file)) {
    const json = await edgarJson(SEC_TICKERS_URL);
    fs.writeFileSync(file, JSON.stringify(json));
  }
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, { cik_str?: number; ticker?: string }>;
  const out = new Map<string, number>();
  for (const row of Object.values(raw)) {
    const t = row.ticker?.trim().toUpperCase();
    const cik = row.cik_str;
    if (t && typeof cik === "number" && cik > 0) out.set(t, cik);
  }
  return out;
}

export function resolveCik(
  ticker: string,
  gicsCik: number | null | undefined,
  secMap: Map<string, number>,
): number | null {
  if (gicsCik != null && gicsCik > 0) return gicsCik;
  const c = secMap.get(ticker.trim().toUpperCase());
  return c != null && c > 0 ? c : null;
}
