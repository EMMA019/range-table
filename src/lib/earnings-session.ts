import fs from "node:fs";
import path from "node:path";
import type { EarningsSession } from "./types";

export type { EarningsSession };

const HOOK_PATH = path.join(process.cwd(), "data", "earnings_session.json");

export function parseEarningsSession(value: unknown): EarningsSession | null {
  if (value === "pre" || value === "before" || value === "bmo") return "pre";
  if (value === "post" || value === "after" || value === "amc") return "post";
  return null;
}

/** Nasdaq calendar `time` values such as time-pre-market and time-after-hours. */
export function nasdaqTimeToSession(time: unknown): EarningsSession | null {
  if (typeof time !== "string") return null;
  const text = time.toLowerCase();
  if (text.includes("pre")) return "pre";
  if (text.includes("after")) return "post";
  return null;
}

export function loadEarningsSessionHook(file = HOOK_PATH): Record<string, EarningsSession> {
  try {
    const json = JSON.parse(fs.readFileSync(file, "utf8")) as { when?: unknown };
    if (!json.when || typeof json.when !== "object") return {};
    const out: Record<string, EarningsSession> = {};
    for (const [ticker, value] of Object.entries(json.when as Record<string, unknown>)) {
      const session = parseEarningsSession(value);
      if (session) out[ticker.trim().toUpperCase()] = session;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Watchlist `when` wins, then data/earnings_session.json, then the Nasdaq calendar cache.
 * Unknown stays null so the UI can say 場は未登録 instead of guessing.
 */
export function resolveEarningsSession(
  ticker: string,
  watch: EarningsSession | null | undefined,
  nasdaq: EarningsSession | null | undefined,
  hook: Record<string, EarningsSession> = loadEarningsSessionHook(),
): EarningsSession | null {
  if (watch === "pre" || watch === "post") return watch;
  const fromFile = hook[ticker.trim().toUpperCase()];
  if (fromFile) return fromFile;
  return nasdaq ?? null;
}
