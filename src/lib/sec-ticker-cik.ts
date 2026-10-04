import fs from "node:fs";
import path from "node:path";
import { edgarJson } from "./edgar-client";

const SEC_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";

/** Full SEC ticker → CIK map (not watchlist-limited). */
export async function loadSecTickerCikMap(cacheDir: string): Promise<Map<string, number>> {
  fs.mkdirSync(cacheDir, { recursive: true });
  const file = path.join(cacheDir, "company_tickers.json");
  if (!fs.existsSync(file)) {
    const sib = path.join(cacheDir, "..", "round19v2", "company_tickers.json");
    if (fs.existsSync(sib)) fs.copyFileSync(sib, file);
    else {
      const json = await edgarJson(SEC_TICKERS_URL);
      fs.writeFileSync(file, JSON.stringify(json));
    }
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
  const key = ticker.trim().toUpperCase();
  const c = secMap.get(key);
  if (c != null && c > 0) return c;
  const dot = key.replace(/\./g, "-");
  if (dot !== key) {
    const c2 = secMap.get(dot);
    if (c2 != null && c2 > 0) return c2;
  }
  const br = key.replace(/-/g, ".");
  if (br !== key) {
    const c3 = secMap.get(br);
    if (c3 != null && c3 > 0) return c3;
  }
  return null;
}

/** SEC map overlaid with GICS CSV CIK (covers renamed / delisted rows still in PIT files). */
export function buildFullTickerCikMap(
  gics: Map<string, { cik: number | null }>,
  secMap: Map<string, number>,
): Map<string, number> {
  const out = new Map<string, number>(secMap);
  for (const [ticker, row] of gics) {
    if (row.cik != null && row.cik > 0) out.set(ticker.trim().toUpperCase(), row.cik);
  }
  return out;
}
