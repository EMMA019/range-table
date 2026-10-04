import fs from "node:fs";
import path from "node:path";
import type { Bar } from "./types";

export const PIT_CACHE = path.join(process.cwd(), "data", ".cache", "pit");

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

export function pitPaths(root = PIT_CACHE) {
  return {
    root,
    facts: path.join(root, "facts"),
    prices: path.join(root, "prices"),
    cikMap: path.join(root, "cik_map.json"),
    manifest: path.join(root, "manifest.json"),
    overrides: path.join(root, "cik_overrides.json"),
  };
}

export function loadPitManifest(root = PIT_CACHE): PitManifest | null {
  const f = pitPaths(root).manifest;
  if (!fs.existsSync(f)) return null;
  return JSON.parse(fs.readFileSync(f, "utf8")) as PitManifest;
}

export function loadPitBars(ticker: string, root = PIT_CACHE): Bar[] {
  const sym = ticker.replace(/\./g, "-");
  const p = path.join(pitPaths(root).prices, `${sym}.json`);
  if (!fs.existsSync(p)) return [];
  return JSON.parse(fs.readFileSync(p, "utf8")) as Bar[];
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
