import fs from "node:fs";
import path from "node:path";
import { pitPaths } from "./pit-dataset";

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

export function pitFactsPathForTicker(
  ticker: string,
  cik: number | null | undefined,
  index: Map<number, string>,
  root: string,
): string | null {
  const direct = path.join(pitPaths(root).facts, `${ticker}.json`);
  if (fs.existsSync(direct)) return direct;
  if (cik != null && cik > 0) {
    const hit = index.get(cik);
    if (hit) return hit;
  }
  return null;
}
