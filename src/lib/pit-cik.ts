import fs from "node:fs";
import path from "node:path";
import { edgarJson } from "./edgar-client";
import { buildFullTickerCikMap, loadSecTickerCikMap, resolveCik } from "./sec-ticker-cik";
import type { Sp500Gics } from "./sp500-pit";

const EXCHANGE_URL = "https://www.sec.gov/files/company_tickers_exchange.json";

/** Historical / PIT tickers → current SEC ticker (same CIK). */
export const PIT_TICKER_ALIASES: Record<string, string> = {
  FB: "META",
  "BRK.B": "BRK-B",
  "BF.B": "BF-B",
  BHGE: "BKR",
  RTN: "RTX",
  UTX: "RTX",
  XLNX: "AMD",
  CERN: "ORCL",
  ATVI: "MSFT",
  DISCK: "WBD",
  DISCA: "WBD",
  VIAC: "PARA",
  VIAB: "PARA",
  CTL: "LUMN",
  FTR: "FYBR",
  ARNC: "HWM",
  PKI: "RVTY",
  VAR: "SHW",
  FLT: "CPAY",
  RE: "EG",
  MXIM: "ADI",
  ANTM: "ELV",
  ABC: "COR",
  BLL: "BALL",
  CBS: "PARA",
  COG: "CTRA",
  ADS: "BFH",
  CDAY: "DAY",
  ANDV: "MPC",
  BK: "BNY",
  KORS: "CPRI",
  MYL: "VTRS",
  NLOK: "GEN",
  SYMC: "GEN",
  DWDP: "DD",
  PX: "LIN",
  TMK: "GL",
  HCP: "PEAK",
  PEAK: "PEAK",
  FBHS: "FBIN",
  FI: "FI",
  CTLT: "CTLT",
  SNI: "WBD",
  LLTC: "ADI",
  HRS: "LHX",
};

export type CikResolution = { cik: number; source: string };

export async function loadExchangeTickerCikMap(cacheDir: string): Promise<Map<string, number>> {
  fs.mkdirSync(cacheDir, { recursive: true });
  const file = path.join(cacheDir, "company_tickers_exchange.json");
  if (!fs.existsSync(file)) {
    const sib = path.join(cacheDir, "company_tickers_exchange.json");
    const v2 = path.join(cacheDir, "..", "round19v2", "company_tickers_exchange.json");
    if (!fs.existsSync(sib) && fs.existsSync(v2)) fs.copyFileSync(v2, sib);
    if (!fs.existsSync(sib)) {
      const json = await edgarJson(EXCHANGE_URL);
      fs.writeFileSync(file, JSON.stringify(json));
    }
  }
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as {
    fields?: string[];
    data?: Array<[number, string, string, string]>;
  };
  const out = new Map<string, number>();
  for (const row of raw.data ?? []) {
    const cik = row[0];
    const ticker = row[2]?.trim().toUpperCase();
    if (ticker && typeof cik === "number" && cik > 0) out.set(ticker, cik);
  }
  return out;
}

export function mergeCikMaps(...maps: Map<string, number>[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of maps) for (const [t, c] of m) out.set(t, c);
  return out;
}

export async function buildPitCikMap(
  cacheDir: string,
  gics: Map<string, Sp500Gics>,
  overrides?: Record<string, number>,
): Promise<Map<string, CikResolution>> {
  return buildPitCikMapForTickers(cacheDir, gics, [...gics.keys()], overrides);
}

export async function buildPitCikMapForTickers(
  cacheDir: string,
  gics: Map<string, Sp500Gics>,
  tickers: string[],
  overrides?: Record<string, number>,
): Promise<Map<string, CikResolution>> {
  const sec = await loadSecTickerCikMap(cacheDir);
  const exch = await loadExchangeTickerCikMap(cacheDir);
  const merged = mergeCikMaps(buildFullTickerCikMap(gics, sec), exch);
  const out = new Map<string, CikResolution>();

  const resolveOne = (ticker: string): CikResolution | null => {
    const key = ticker.trim().toUpperCase();
    const alias = PIT_TICKER_ALIASES[key];
    const gicsCik = gics.get(key)?.cik ?? gics.get(alias ?? "")?.cik;
    const fromGics = gicsCik != null && gicsCik > 0 ? gicsCik : null;
    const fromMerged = resolveCik(key, fromGics, merged);
    if (fromMerged) return { cik: fromMerged, source: fromGics ? "gics" : "sec_map" };
    if (alias) {
      const c2 = resolveCik(alias, gics.get(alias)?.cik, merged);
      if (c2) return { cik: c2, source: `alias:${alias}` };
    }
    const ov = overrides?.[key];
    if (ov && ov > 0) return { cik: ov, source: "override" };
    return null;
  };

  for (const t of tickers) {
    const r = resolveOne(t);
    if (r) out.set(t, r);
  }
  return out;
}

export async function searchCikEfts(ticker: string, companyName?: string): Promise<number | null> {
  const q = companyName ? `"${companyName.replace(/"/g, "")}"` : ticker;
  const url = `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(q)}&forms=10-K`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": process.env.SEC_USER_AGENT?.trim() || "range-table research@example.com" },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { hits?: { hits?: Array<{ _source?: { ciks?: string[] } }> } };
    const cikStr = json.hits?.hits?.[0]?._source?.ciks?.[0];
    if (!cikStr) return null;
    const n = Number(cikStr.replace(/\D/g, ""));
    return n > 0 ? n : null;
  } catch {
    return null;
  }
}
