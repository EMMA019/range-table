import fs from "node:fs";
import path from "node:path";
import { CACHE_TTL_MS } from "./constants";
import type { Bar } from "./types";
import { fetchDailyBars } from "./yahoo";
import { yahooSymbol } from "./yahoo-symbol";

/** Long history for the header checks. Kept out of the 66-session price cache. */
export const WEATHER_SYMBOLS = ["SPY", "RSP", "^VIX"] as const;

const CACHE_PATH = path.join(process.cwd(), "data", ".cache", "weather.json");
const KEEP = 220;

type Entry = { bars?: Bar[]; error?: string; at: number };
type Body = { v: 1; series: Record<string, Entry> };

let memory: Body | null = null;
let inflight: Promise<Body> | null = null;

function readDisk(): Body | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(CACHE_PATH, "utf8")) as Body;
    if (parsed?.v !== 1 || !parsed.series) return null;
    return parsed;
  } catch {
    return null;
  }
}

function fresh(body: Body, now: number): boolean {
  return WEATHER_SYMBOLS.every((symbol) => {
    const entry = body.series[symbol];
    return entry && now - entry.at < (entry.error ? 2 * 60 * 1000 : CACHE_TTL_MS);
  });
}

async function refresh(): Promise<Body> {
  const base = memory ?? readDisk() ?? { v: 1 as const, series: {} };
  const series: Record<string, Entry> = { ...base.series };
  const now = Date.now();
  await Promise.all(
    WEATHER_SYMBOLS.map(async (symbol) => {
      try {
        const parsed = await fetchDailyBars(yahooSymbol(symbol), { range: "2y", keep: KEEP });
        series[symbol] = { bars: parsed.bars, at: now };
      } catch (error) {
        const message = error instanceof Error ? error.message : "取得失敗";
        series[symbol] = { bars: series[symbol]?.bars, error: message.slice(0, 180), at: now };
      }
    }),
  );
  const next: Body = { v: 1, series };
  memory = next;
  try {
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify(next));
  } catch (error) {
    console.error("[range] weather cache", error);
  }
  return next;
}

export async function ensureWeather(): Promise<Record<string, Bar[] | null>> {
  const now = Date.now();
  if (!memory) memory = readDisk();
  if (memory && fresh(memory, now)) return barsOf(memory);
  if (!inflight) {
    inflight = refresh().finally(() => {
      inflight = null;
    });
  }
  try {
    return barsOf(await inflight);
  } catch (error) {
    console.error("[range] weather", error);
    return barsOf(memory);
  }
}

function barsOf(body: Body | null): Record<string, Bar[] | null> {
  const out: Record<string, Bar[] | null> = {};
  for (const symbol of WEATHER_SYMBOLS) {
    out[symbol] = body?.series[symbol]?.bars ?? null;
  }
  return out;
}

export function weatherStamp(): string {
  const spy = memory?.series.SPY;
  return spy ? String(spy.at) : "0";
}
