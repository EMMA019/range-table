import fs from "node:fs";
import path from "node:path";
import { pitPaths } from "./pit-dataset";

const REPO_FACTS_SUPPLEMENT_CIK = path.join(process.cwd(), "data", "pit_facts_supplement_cik.json");

type FactsRoot = {
  facts?: Record<string, Record<string, { units?: Record<string, Array<Record<string, unknown>>> }>>;
};

function loadFactsSupplementCikMap(): Record<string, number> {
  if (!fs.existsSync(REPO_FACTS_SUPPLEMENT_CIK)) return {};
  const raw = JSON.parse(fs.readFileSync(REPO_FACTS_SUPPLEMENT_CIK, "utf8")) as { cik?: Record<string, number> };
  return raw.cik ?? {};
}

function supplementFactsPath(root: string, cik: number): string {
  return path.join(pitPaths(root).facts, `_supplement_cik_${cik}.json`);
}

function pointKey(p: Record<string, unknown>): string {
  return [p.end, p.filed, p.form, p.fp, p.val].join("|");
}

/** Merge SEC companyfacts `units` arrays (supplement fills gaps in primary). */
export function mergeCompanyFactsJson(primary: unknown, supplement: unknown): unknown {
  if (!supplement || typeof supplement !== "object") return primary;
  if (!primary || typeof primary !== "object") return supplement;
  const p = primary as FactsRoot;
  const s = supplement as FactsRoot;
  if (!p.facts) return primary;
  if (!s.facts) return primary;
  const out: FactsRoot = JSON.parse(JSON.stringify(primary)) as FactsRoot;
  for (const [ns, tags] of Object.entries(s.facts)) {
    if (!out.facts![ns]) out.facts![ns] = {};
    for (const [tag, block] of Object.entries(tags)) {
      if (!out.facts![ns][tag]) {
        out.facts![ns][tag] = JSON.parse(JSON.stringify(block));
        continue;
      }
      const units = block.units ?? {};
      const outUnits = out.facts![ns][tag].units ?? {};
      out.facts![ns][tag].units = outUnits;
      for (const [unit, points] of Object.entries(units)) {
        const existing = outUnits[unit] ?? [];
        const seen = new Set(existing.map((pt) => pointKey(pt)));
        const merged = [...existing];
        for (const pt of points) {
          const k = pointKey(pt);
          if (seen.has(k)) continue;
          seen.add(k);
          merged.push(pt);
        }
        outUnits[unit] = merged;
      }
    }
  }
  return out;
}

export function loadMergedPitFacts(
  ticker: string,
  cik: number | null | undefined,
  index: Map<number, string>,
  root: string,
): unknown | undefined {
  const p = pitFactsPathForTicker(ticker, cik, index, root);
  let primary: unknown | undefined = p ? JSON.parse(fs.readFileSync(p, "utf8")) : undefined;
  const supMap = loadFactsSupplementCikMap();
  const supCik = supMap[ticker.trim().toUpperCase()];
  if (!supCik) return primary;
  let supPath = index.get(supCik) ?? supplementFactsPath(root, supCik);
  if (!fs.existsSync(supPath)) return primary;
  const supplement = JSON.parse(fs.readFileSync(supPath, "utf8"));
  return mergeCompanyFactsJson(primary, supplement);
}

export function buildPitFactsIndex(root: string): Map<number, string> {
  const dir = pitPaths(root).facts;
  const byCik = new Map<number, string>();
  if (!fs.existsSync(dir)) return byCik;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    const full = path.join(dir, f);
    try {
      const j = JSON.parse(fs.readFileSync(full, "utf8")) as { cik?: number | string };
      const raw = j.cik;
      const cik = typeof raw === "number" ? raw : Number(String(raw ?? "").replace(/\D/g, ""));
      if (cik > 0) byCik.set(cik, full);
    } catch {
      /* skip */
    }
  }
  return byCik;
}

function factsCikFromFile(full: string): number | null {
  try {
    const j = JSON.parse(fs.readFileSync(full, "utf8")) as { cik?: number | string };
    const raw = j.cik;
    const n = typeof raw === "number" ? raw : Number(String(raw ?? "").replace(/\D/g, ""));
    return n > 0 ? n : null;
  } catch {
    return null;
  }
}

export function pitFactsPathForTicker(
  ticker: string,
  cik: number | null | undefined,
  index: Map<number, string>,
  root: string,
): string | null {
  const alias = ticker.trim().toUpperCase();
  const tryTicker = (t: string): string | null => {
    const direct = path.join(pitPaths(root).facts, `${t}.json`);
    if (!fs.existsSync(direct)) return null;
    const fileCik = factsCikFromFile(direct);
    if (cik != null && cik > 0 && fileCik != null && fileCik !== cik) return null;
    return direct;
  };
  const hitDirect = tryTicker(alias);
  if (hitDirect) return hitDirect;
  if (cik != null && cik > 0) {
    const fromIndex = index.get(cik);
    if (fromIndex && factsCikFromFile(fromIndex) === cik) return fromIndex;
  }
  return null;
}
