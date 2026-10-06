/**
 * Build data/ticker_meta.json (names + GICS sector/industry, Japanese sector labels).
 *   npx tsx scripts/refresh-ticker-meta.ts
 */
import fs from "fs";
import path from "path";
import { BENCHMARKS, FX_USDJPY } from "../src/lib/constants";
import { parseCsvLine } from "../src/lib/sp500-pit";

const OUT = path.join(process.cwd(), "data", "ticker_meta.json");
const PIT_NAMES = path.join(process.cwd(), "data", "pit_ticker_names.json");
const MONITOR_INDEX = path.join(process.cwd(), "data", "monitor_index.json");

const SP500_CONSTITUENTS_CSV =
  "https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv";
const WIKI_SP500 = "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies";

export type TickerMetaEntry = { name: string; sector: string; industry: string };

const GICS_SECTOR_JA: Record<string, string> = {
  "Communication Services": "コミュニケーション",
  "Consumer Discretionary": "一般消費財",
  "Consumer Staples": "生活必需品",
  "Energy": "エネルギー",
  "Financials": "金融",
  "Health Care": "ヘルスケア",
  "Industrials": "インダストリアル",
  "Information Technology": "情報技術",
  "Materials": "素材",
  "Real Estate": "不動産",
  "Utilities": "公益",
};

function sectorJa(gics: string): string {
  const t = gics.trim();
  if (!t) return "";
  return GICS_SECTOR_JA[t] ?? t;
}

function normTicker(t: string): string {
  return t.trim().toUpperCase().replace(/\./g, "-");
}

function emptyEntry(): TickerMetaEntry {
  return { name: "", sector: "", industry: "" };
}

function applyPatch(base: TickerMetaEntry, patch: Partial<TickerMetaEntry>): TickerMetaEntry {
  return {
    name: patch.name?.trim() ? patch.name.trim() : base.name,
    sector: patch.sector?.trim() ? patch.sector.trim() : base.sector,
    industry: patch.industry?.trim() ? patch.industry.trim() : base.industry,
  };
}

/** Layer 1 — static ETFs / benchmarks (lowest priority). */
const STATIC_META: Record<string, TickerMetaEntry> = {
  SPY: { name: "SPDR S&P 500 ETF Trust", sector: "指数・ETF", industry: "米国大型株" },
  QQQ: { name: "Invesco QQQ Trust", sector: "指数・ETF", industry: "Nasdaq-100" },
  SOXX: { name: "iShares Semiconductor ETF", sector: "指数・ETF", industry: "半導体" },
  SHY: { name: "iShares 1-3 Year Treasury Bond ETF", sector: "指数・ETF", industry: "短期国債" },
  SGOV: { name: "iShares 0-3 Month Treasury Bond ETF", sector: "指数・ETF", industry: "超短期国債" },
  [FX_USDJPY]: { name: "米ドル/円", sector: "為替", industry: "FX" },
};

/** Layer 5 — manual overrides (highest priority). */
const MANUAL_OVERRIDES: Record<string, TickerMetaEntry> = {
  META: {
    name: "Meta Platforms",
    sector: "コミュニケーション",
    industry: "インタラクティブ・メディア",
  },
  FB: {
    name: "Meta Platforms (旧FB)",
    sector: "コミュニケーション",
    industry: "インタラクティブ・メディア",
  },
  SONY: {
    name: "ソニーグループ",
    sector: "一般消費財",
    industry: "コンシューマー・エレクトロニクス",
  },
  CTVA: {
    name: "Corteva",
    sector: "素材",
    industry: "農業化学",
  },
  TM: { name: "トヨタ自動車 (ADR)", sector: "一般消費財", industry: "自動車" },
  HMC: { name: "ホンダ (ADR)", sector: "一般消費財", industry: "自動車" },
  NTES: { name: "NetEase (ADR)", sector: "コミュニケーション", industry: "インタラクティブ・メディア" },
  BABA: { name: "Alibaba Group (ADR)", sector: "一般消費財", industry: "インターネット小売" },
  JD: { name: "JD.com (ADR)", sector: "一般消費財", industry: "インターネット小売" },
  PDD: { name: "PDD Holdings (ADR)", sector: "一般消費財", industry: "インターネット小売" },
  BIDU: { name: "Baidu (ADR)", sector: "コミュニケーション", industry: "インタラクティブ・メディア" },
  NIO: { name: "NIO (ADR)", sector: "一般消費財", industry: "自動車" },
  LI: { name: "Li Auto (ADR)", sector: "一般消費財", industry: "自動車" },
  XPEV: { name: "XPeng (ADR)", sector: "一般消費財", industry: "自動車" },
  TSM: { name: "台湾セミコンダクター (ADR)", sector: "情報技術", industry: "半導体" },
  ASML: { name: "ASML Holding (ADR)", sector: "情報技術", industry: "半導体装置" },
  SAP: { name: "SAP (ADR)", sector: "情報技術", industry: "アプリケーション・ソフトウェア" },
  UL: { name: "Unilever (ADR)", sector: "生活必需品", industry: "日用品" },
  DEO: { name: "Diageo (ADR)", sector: "生活必需品", industry: "酒類" },
  SNY: { name: "Sanofi (ADR)", sector: "ヘルスケア", industry: "医薬品" },
  AZN: { name: "AstraZeneca (ADR)", sector: "ヘルスケア", industry: "医薬品" },
  GSK: { name: "GSK (ADR)", sector: "ヘルスケア", industry: "医薬品" },
  BP: { name: "BP (ADR)", sector: "エネルギー", industry: "統合石油・ガス" },
  SHEL: { name: "Shell (ADR)", sector: "エネルギー", industry: "統合石油・ガス" },
  RIO: { name: "Rio Tinto (ADR)", sector: "素材", industry: "金属・鉱業" },
  BHP: { name: "BHP Group (ADR)", sector: "素材", industry: "金属・鉱業" },
  ALAB: { name: "Astera Labs", sector: "情報技術", industry: "Semiconductors" },
  ALNY: { name: "Alnylam Pharmaceuticals", sector: "ヘルスケア", industry: "Biotechnology" },
  ARM: { name: "Arm Holdings", sector: "情報技術", industry: "Semiconductors" },
  BLDR: { name: "Builders FirstSource", sector: "インダストリアル", industry: "Building Products" },
  CCEP: { name: "Coca-Cola Europacific Partners", sector: "生活必需品", industry: "Soft Drinks" },
  CRWV: { name: "CoreWeave", sector: "情報技術", industry: "Technology Hardware, Storage & Peripherals" },
  FER: { name: "Ferrovial", sector: "インダストリアル", industry: "Construction & Engineering" },
  MELI: { name: "MercadoLibre", sector: "一般消費財", industry: "Broadline Retail" },
  MSTR: { name: "Strategy (MicroStrategy)", sector: "情報技術", industry: "Application Software" },
  NBIS: { name: "Nebius Group", sector: "情報技術", industry: "Internet Services & Infrastructure" },
  RKLB: { name: "Rocket Lab", sector: "インダストリアル", industry: "Aerospace & Defense" },
  SHOP: { name: "Shopify", sector: "情報技術", industry: "Internet Services & Infrastructure" },
  SPCX: { name: "SPAC and New Issue ETF", sector: "指数・ETF", industry: "ETF" },
  TAP: { name: "Molson Coors Beverage", sector: "生活必需品", industry: "Brewers" },
  TRI: { name: "Thomson Reuters", sector: "インダストリアル", industry: "Research & Consulting Services" },
  TTD: { name: "The Trade Desk", sector: "コミュニケーション", industry: "Advertising" },
};

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": "range-table-ticker-meta/1.0 (refresh script)" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

function loadPitNames(): Record<string, string> {
  if (!fs.existsSync(PIT_NAMES)) return {};
  const raw = JSON.parse(fs.readFileSync(PIT_NAMES, "utf8")) as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === "string" && v.trim()) out[normTicker(k)] = v.trim();
  }
  return out;
}

function loadMonitorUnion(): string[] {
  if (!fs.existsSync(MONITOR_INDEX)) {
    throw new Error(`missing ${MONITOR_INDEX} — run refresh-monitor-index or restore from main`);
  }
  const doc = JSON.parse(fs.readFileSync(MONITOR_INDEX, "utf8")) as { union?: string[] };
  if (!Array.isArray(doc.union)) throw new Error("monitor_index.json union missing");
  return doc.union.map(normTicker);
}

export function parseSp500ConstituentsCsv(text: string): Map<string, TickerMetaEntry> {
  const lines = text.trim().split(/\r?\n/);
  const out = new Map<string, TickerMetaEntry>();
  for (let i = 1; i < lines.length; i += 1) {
    const parts = parseCsvLine(lines[i]);
    if (parts.length < 4) continue;
    const ticker = normTicker(parts[0]);
    const security = parts[1]?.trim() ?? "";
    const sector = sectorJa(parts[2]?.trim() ?? "");
    const subIndustry = parts[3]?.trim() ?? "";
    out.set(ticker, { name: security, sector, industry: subIndustry });
  }
  return out;
}

/** Wikipedia `#constituents` table fallback. */
export function parseSp500FromWiki(html: string): Map<string, TickerMetaEntry> {
  const out = new Map<string, TickerMetaEntry>();
  const tableMatch = html.match(/<table[^>]*id="constituents"[^>]*>([\s\S]*?)<\/table>/i);
  if (!tableMatch) throw new Error("Wikipedia constituents table not found");
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let row: RegExpExecArray | null;
  let header = true;
  while ((row = rowRe.exec(tableMatch[1])) !== null) {
    const cells = [...row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) =>
      m[1].replace(/<[^>]+>/g, "").replace(/\[[^\]]*\]/g, "").trim(),
    );
    if (header) {
      header = false;
      continue;
    }
    if (cells.length < 4) continue;
    const ticker = normTicker(cells[0]);
    if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker)) continue;
    out.set(ticker, {
      name: cells[1],
      sector: sectorJa(cells[2]),
      industry: cells[3],
    });
  }
  if (out.size < 400) throw new Error(`Wikipedia parse got ${out.size} rows`);
  return out;
}

async function fetchSp500Table(): Promise<Map<string, TickerMetaEntry>> {
  try {
    const csv = await fetchText(SP500_CONSTITUENTS_CSV);
    const map = parseSp500ConstituentsCsv(csv);
    if (map.size < 400) throw new Error(`constituents.csv only ${map.size} rows`);
    return map;
  } catch (csvErr) {
    console.warn("[ticker-meta] constituents.csv failed, trying Wikipedia:", csvErr);
    const html = await fetchText(WIKI_SP500);
    return parseSp500FromWiki(html);
  }
}

function staticLayer(): Record<string, TickerMetaEntry> {
  const out: Record<string, TickerMetaEntry> = {};
  for (const t of BENCHMARKS) {
    const key = normTicker(t);
    if (STATIC_META[key]) out[key] = { ...STATIC_META[key] };
  }
  for (const [ticker, meta] of Object.entries(STATIC_META)) {
    out[normTicker(ticker)] = { ...meta };
  }
  return out;
}

function mergeLayers(
  layers: Array<Record<string, Partial<TickerMetaEntry>> | Map<string, TickerMetaEntry>>,
): Record<string, TickerMetaEntry> {
  const tickers: Record<string, TickerMetaEntry> = {};
  for (const layer of layers) {
    const entries =
      layer instanceof Map ? [...layer.entries()] : Object.entries(layer).map(([k, v]) => [normTicker(k), v]);
    for (const [ticker, patch] of entries) {
      const cur = tickers[ticker] ?? emptyEntry();
      tickers[ticker] = applyPatch(cur, patch);
    }
  }
  return tickers;
}

export async function buildTickerMeta(): Promise<{
  generatedAt: string;
  tickers: Record<string, TickerMetaEntry>;
}> {
  const pitNames = loadPitNames();
  const pitLayer: Record<string, Partial<TickerMetaEntry>> = {};
  for (const [ticker, name] of Object.entries(pitNames)) {
    pitLayer[ticker] = { name };
  }

  const sp500 = await fetchSp500Table();

  const monitorUnion = loadMonitorUnion();

  let tickers = mergeLayers([staticLayer(), pitLayer, sp500]);
  for (const t of monitorUnion) {
    if (!tickers[t]) tickers[t] = emptyEntry();
  }
  tickers = mergeLayers([tickers, MANUAL_OVERRIDES]);

  const sorted: Record<string, TickerMetaEntry> = {};
  for (const key of Object.keys(tickers).sort((a, b) => a.localeCompare(b))) {
    sorted[key] = tickers[key]!;
  }

  return { generatedAt: new Date().toISOString(), tickers: sorted };
}

function reportStats(tickers: Record<string, TickerMetaEntry>, monitorUnion: string[]) {
  const all = Object.keys(tickers);
  const emptyName = all.filter((t) => !tickers[t]!.name.trim());
  const emptySector = all.filter((t) => !tickers[t]!.sector.trim());
  const emptyIndustry = all.filter((t) => !tickers[t]!.industry.trim());
  const monitorMissing = monitorUnion.filter(
    (t) => !tickers[t]?.name.trim() || !tickers[t]?.sector.trim(),
  );

  console.log(`Total tickers: ${all.length}`);
  console.log(`Monitor union: ${monitorUnion.length}`);
  console.log(`Empty name: ${emptyName.length}`);
  console.log(`Empty sector: ${emptySector.length}`);
  console.log(`Empty industry: ${emptyIndustry.length}`);
  if (emptyName.length) console.log("  name:", emptyName.join(", "));
  if (emptySector.length) console.log("  sector:", emptySector.join(", "));
  if (monitorMissing.length) console.log("Monitor union still thin (name or sector):", monitorMissing.join(", "));
}

async function main() {
  const monitorUnion = loadMonitorUnion();
  const doc = await buildTickerMeta();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify(doc, null, 2)}\n`);
  const bytes = fs.statSync(OUT).size;
  console.log(`Wrote ${OUT} (${bytes} bytes)`);
  reportStats(doc.tickers, monitorUnion);
}

const isMain =
  typeof process.argv[1] === "string" &&
  (process.argv[1].endsWith("refresh-ticker-meta.ts") || process.argv[1].includes("refresh-ticker-meta"));

if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
