import fs from "node:fs";
import path from "node:path";
import { PIT_TICKER_ALIASES } from "./pit-cik";
import type { Bar } from "./types";

export const PIT_CACHE = path.join(process.cwd(), "data", ".cache", "pit");
export const REPO_PIT_CIK_OVERRIDES = path.join(process.cwd(), "data", "pit_cik_overrides.json");
export const REPO_PIT_TICKER_NAMES = path.join(process.cwd(), "data", "pit_ticker_names.json");
export const REPO_PIT_PRICE_ALIASES = path.join(process.cwd(), "data", "pit_price_ticker_aliases.json");

export type PitManifest = {
  version: 1;
  builtAt: string;
  pitTickers: number;
  cikResolved: number;
  factsFiles: number;
  priceFiles: number;
  rebalanceCoverage: Array<{
    date: string;
    pitMembers: number;
    withFacts: number;
    factsPct: number;
    withPrice: number;
    pricePct: number;
  }>;
};

export type PitCikOverridesFile = {
  version?: number;
  cik: Record<string, number>;
  priceTicker?: Record<string, string>;
  source?: Record<string, string>;
  note?: string;
};

export function pitPaths(root = PIT_CACHE) {
  return {
    root,
    facts: path.join(root, "facts"),
    prices: path.join(root, "prices"),
    priceMeta: path.join(root, "price_meta.json"),
    cikMap: path.join(root, "cik_map.json"),
    manifest: path.join(root, "manifest.json"),
    /** Legacy cache-only overrides (merged after repo file). */
    overrides: path.join(root, "cik_overrides.json"),
  };
}

export function loadPitCikOverrides(): PitCikOverridesFile {
  const empty: PitCikOverridesFile = { cik: {} };
  const merge = (base: PitCikOverridesFile, extra: PitCikOverridesFile): PitCikOverridesFile => ({
    version: extra.version ?? base.version,
    note: extra.note ?? base.note,
    cik: { ...base.cik, ...extra.cik },
    priceTicker: { ...(base.priceTicker ?? {}), ...(extra.priceTicker ?? {}) },
    source: { ...(base.source ?? {}), ...(extra.source ?? {}) },
  });
  let out = empty;
  if (fs.existsSync(REPO_PIT_CIK_OVERRIDES)) {
    out = merge(out, JSON.parse(fs.readFileSync(REPO_PIT_CIK_OVERRIDES, "utf8")) as PitCikOverridesFile);
  }
  const cacheOv = pitPaths().overrides;
  if (fs.existsSync(cacheOv)) {
    const raw = JSON.parse(fs.readFileSync(cacheOv, "utf8")) as PitCikOverridesFile | Record<string, number>;
    if (raw && typeof raw === "object" && "cik" in raw) out = merge(out, raw as PitCikOverridesFile);
    else out = merge(out, { cik: raw as Record<string, number> });
  }
  return out;
}

export function loadPitTickerNames(): Record<string, string> {
  if (fs.existsSync(REPO_PIT_TICKER_NAMES)) {
    return JSON.parse(fs.readFileSync(REPO_PIT_TICKER_NAMES, "utf8")) as Record<string, string>;
  }
  return {};
}

export function loadPitPriceTickerAliases(): Record<string, string> {
  const fromOverrides = loadPitCikOverrides().priceTicker ?? {};
  if (fs.existsSync(REPO_PIT_PRICE_ALIASES)) {
    const file = JSON.parse(fs.readFileSync(REPO_PIT_PRICE_ALIASES, "utf8")) as Record<string, string>;
    return { ...file, ...fromOverrides };
  }
  return { ...fromOverrides };
}

export function pitPriceTicker(ticker: string): string {
  const key = ticker.trim().toUpperCase();
  const aliases = loadPitPriceTickerAliases();
  return aliases[key] ?? key;
}

export function loadPitManifest(root = PIT_CACHE): PitManifest | null {
  const f = pitPaths(root).manifest;
  if (!fs.existsSync(f)) return null;
  return JSON.parse(fs.readFileSync(f, "utf8")) as PitManifest;
}

export function loadPitBars(ticker: string, root = PIT_CACHE): Bar[] {
  const key = ticker.trim().toUpperCase();
  const sym = key.replace(/\./g, "-");
  const read = (fileSym: string): Bar[] => {
    const p = path.join(pitPaths(root).prices, `${fileSym}.json`);
    if (!fs.existsSync(p)) return [];
    return JSON.parse(fs.readFileSync(p, "utf8")) as Bar[];
  };
  const direct = read(sym);
  const pitAlias = PIT_TICKER_ALIASES[key]?.replace(/\./g, "-");
  if (pitAlias && pitAlias !== sym) {
    const viaPit = read(pitAlias);
    if (viaPit.length > direct.length) return viaPit;
  }
  if (direct.length) return direct;
  if (pitAlias && pitAlias !== sym) {
    const viaPit = read(pitAlias);
    if (viaPit.length) return viaPit;
  }
  const alias = pitPriceTicker(key).replace(/\./g, "-");
  if (alias !== sym && alias !== pitAlias) {
    const viaAlias = read(alias);
    if (viaAlias.length) return viaAlias;
  }
  return [];
}

export function hasPitFacts(ticker: string, root = PIT_CACHE): boolean {
  return fs.existsSync(path.join(pitPaths(root).facts, `${ticker}.json`));
}

export function loadPitCikMap(root = PIT_CACHE): Map<string, number> {
  const f = pitPaths(root).cikMap;
  if (!fs.existsSync(f)) return new Map();
  const raw = JSON.parse(fs.readFileSync(f, "utf8")) as Record<string, { cik: number }>;
  const out = new Map<string, number>();
  for (const [t, row] of Object.entries(raw)) if (row.cik > 0) out.set(t, row.cik);
  return out;
}
