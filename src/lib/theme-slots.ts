import fs from "node:fs";
import path from "node:path";
import { CORR_LOW_MAX } from "./constants";
import { isIgnoredTicker } from "./holdings";

export const THEME_SLOT_IDS = ["power", "cooling", "networking", "edge", "physical-ai"] as const;
export type ThemeSlotId = (typeof THEME_SLOT_IDS)[number];

export const THEME_SLOT_LABEL: Record<ThemeSlotId, string> = {
  power: "電力",
  cooling: "冷却",
  networking: "ネットワーキング",
  edge: "エッジ",
  "physical-ai": "Physical AI",
};

export type ThemeDemandChange = "strengthened" | "weakened" | "unchanged";

export type ThemeDemandSignal = {
  id: string;
  label: string;
  change: ThemeDemandChange | null;
  /** One line from the weekly note. Null when the file omitted it. */
  reason: string | null;
};

export type ThemeSlotRow = {
  ticker: string;
  theme: ThemeSlotId;
  themeLabel: string;
  corrSoxx: number | null;
  /** |rounded correlation| at or under the same 0.3 chip used on the table. */
  lowCorr: boolean;
};

const SLOTS_PATH = path.join(process.cwd(), "data", "theme_slots.json");
const DEMAND_PATH = path.join(process.cwd(), "data", "theme_demand.json");

const CHANGES = new Set<ThemeDemandChange>(["strengthened", "weakened", "unchanged"]);

export function loadThemeSlotMap(file = SLOTS_PATH): Record<ThemeSlotId, string[]> {
  const empty = { power: [], cooling: [], networking: [], edge: [], "physical-ai": [] } as Record<
    ThemeSlotId,
    string[]
  >;
  try {
    const json = JSON.parse(fs.readFileSync(file, "utf8")) as { themes?: Record<string, unknown> };
    const themes = json.themes ?? {};
    for (const id of THEME_SLOT_IDS) {
      const list = themes[id];
      if (!Array.isArray(list)) continue;
      empty[id] = list
        .filter((ticker): ticker is string => typeof ticker === "string")
        .map((ticker) => ticker.trim().toUpperCase())
        .filter((ticker) => ticker && !isIgnoredTicker(ticker));
    }
  } catch {
    /* hook missing */
  }
  return empty;
}

export function loadThemeDemand(file = DEMAND_PATH): { asOf: string | null; signals: ThemeDemandSignal[] } {
  try {
    const json = JSON.parse(fs.readFileSync(file, "utf8")) as { asOf?: unknown; signals?: unknown };
    const asOf = typeof json.asOf === "string" && json.asOf ? json.asOf : null;
    const signals: ThemeDemandSignal[] = [];
    if (Array.isArray(json.signals)) {
      for (const raw of json.signals) {
        if (!raw || typeof raw !== "object") continue;
        const row = raw as Record<string, unknown>;
        const id = typeof row.id === "string" ? row.id : "";
        const label = typeof row.label === "string" ? row.label : "";
        if (!id || !label) continue;
        const change = typeof row.change === "string" && CHANGES.has(row.change as ThemeDemandChange)
          ? (row.change as ThemeDemandChange)
          : null;
        const reason = typeof row.reason === "string" ? row.reason.trim() : "";
        signals.push({ id, label, change, reason: reason || null });
      }
    }
    return { asOf, signals };
  } catch {
    return { asOf: null, signals: [] };
  }
}

export function isLowSoxxCorr(value: number | null): boolean {
  if (value == null || !Number.isFinite(value)) return false;
  return Math.round(value * 100) / 100 <= CORR_LOW_MAX;
}

export function buildThemeSlots(
  themes: Record<ThemeSlotId, string[]>,
  corr: Map<string, number | null>,
): ThemeSlotRow[] {
  const rows: ThemeSlotRow[] = [];
  for (const theme of THEME_SLOT_IDS) {
    for (const ticker of themes[theme]) {
      const corrSoxx = corr.get(ticker) ?? null;
      rows.push({
        ticker,
        theme,
        themeLabel: THEME_SLOT_LABEL[theme],
        corrSoxx,
        lowCorr: isLowSoxxCorr(corrSoxx),
      });
    }
  }
  return rows;
}

export const DEMAND_LABEL: Record<ThemeDemandChange, string> = {
  strengthened: "強まった",
  weakened: "弱まった",
  unchanged: "変化なし",
};
