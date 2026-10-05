import fs from "node:fs";
import path from "node:path";
import { sessionDate } from "./calendar";
import { pitPaths } from "./pit-dataset";
import type { YahooSplit } from "./yahoo";

export type PitSplit = { date: string; numerator: number; denominator: number };

export function normalizeYahooSplits(splits: YahooSplit[]): PitSplit[] {
  const out: PitSplit[] = [];
  for (const sp of splits) {
    if (
      typeof sp.date !== "number" ||
      typeof sp.numerator !== "number" ||
      typeof sp.denominator !== "number" ||
      sp.numerator <= 0 ||
      sp.denominator <= 0
    ) {
      continue;
    }
    out.push({
      date: sessionDate(sp.date),
      numerator: sp.numerator,
      denominator: sp.denominator,
    });
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

export function loadPitSplits(ticker: string, root?: string): PitSplit[] {
  const sym = ticker.trim().toUpperCase().replace(/\./g, "-");
  const f = path.join(pitPaths(root).root, "splits", `${sym}.json`);
  if (!fs.existsSync(f)) return [];
  const raw = JSON.parse(fs.readFileSync(f, "utf8")) as PitSplit[];
  return Array.isArray(raw) ? raw : [];
}

export function savePitSplits(ticker: string, splits: PitSplit[], root = pitPaths().root): void {
  const dir = path.join(pitPaths(root).root, "splits");
  fs.mkdirSync(dir, { recursive: true });
  const sym = ticker.trim().toUpperCase().replace(/\./g, "-");
  fs.writeFileSync(path.join(dir, `${sym}.json`), JSON.stringify(splits));
}

/** Multiply share count for splits strictly after `factEnd` and on/before `asOf`. */
export function forwardShareMultiplier(splits: PitSplit[], factEnd: string, asOf: string): number {
  let m = 1;
  for (const sp of splits) {
    if (sp.date > factEnd && sp.date <= asOf) m *= sp.numerator / sp.denominator;
  }
  return m;
}

/** Unadjust split-backward-adjusted `c` to nominal close on `barDate`. */
export function nominalCloseFromAdjusted(c: number, barDate: string, splits: PitSplit[]): number {
  let f = 1;
  for (const sp of splits) {
    if (sp.date > barDate) f *= sp.numerator / sp.denominator;
  }
  return c * f;
}
