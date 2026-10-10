import fs from "node:fs";
import path from "node:path";
import { CACHE_TTL_MS, ERROR_RETRY_MS } from "./constants";
import { studyRobo, type CloseBar, type RoboPanel, type RoboStudy } from "./robo-backtest";
import { ROBO_UNIVERSE } from "./robo-model";
import { fetchDailyBars } from "./yahoo";
import { yahooSymbol } from "./yahoo-symbol";

/** Bump when the walk-forward rules change so a warm process does not reuse an old study. */
const MODEL_STAMP = "ml-v1";
const CACHE_PATH = path.join(process.cwd(), "data", ".cache", "robo-bars.json");

type CacheEntry = { bars?: CloseBar[]; at: number; error?: string };
type CacheBody = { v: 1; series: Record<string, CacheEntry> };

const TRADED = ROBO_UNIVERSE.map((asset) => asset.ticker);
const YIELDS = ["^TNX", "^IRX"] as const;
const EXTRAS = ["^VIX", ...YIELDS] as const;

let memory: CacheBody | null = null;
let inflight: Promise<CacheBody> | null = null;
let studyMemo: { stamp: string; value: RoboStudy | { error: string } } | null = null;

export async function getRoboStudy(): Promise<RoboStudy | { error: string }> {
  const bars = await ensureBars();
  const spy = bars.SPY ?? [];
  const stamp = `${MODEL_STAMP}:${spy.length}:${spy[spy.length - 1]?.date ?? ""}`;
  if (studyMemo?.stamp === stamp) return studyMemo.value;
  const panel = panelFrom(bars);
  let value: RoboStudy | { error: string };
  try {
    value = studyRobo(panel, { today: todayEt() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "学習に失敗した";
    value = { error: message };
  }
  if (!("error" in value)) studyMemo = { stamp, value };
  return value;
}

function panelFrom(bars: Record<string, CloseBar[]>): RoboPanel {
  const prices: Record<string, CloseBar[]> = {};
  for (const ticker of TRADED) prices[ticker] = bars[ticker] ?? [];
  return {
    prices,
    vix: bars["^VIX"] ?? [],
    tnx: scaleYield(bars["^TNX"] ?? []),
    irx: scaleYield(bars["^IRX"] ?? []),
  };
}

/** Yahoo's yield indexes are often quoted in tenths of a percent (45 = 4.5%). */
export function scaleYield(bars: CloseBar[]): CloseBar[] {
  const closes = bars.map((bar) => bar.c).filter((value) => value > 0).sort((a, b) => a - b);
  const mid = closes.length === 0 ? 0 : closes[Math.floor(closes.length / 2)];
  if (mid <= 20) return bars;
  return bars.map((bar) => ({ date: bar.date, c: bar.c / 10 }));
}

async function ensureBars(): Promise<Record<string, CloseBar[]>> {
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
    console.error("[range] robo bars", error);
    return barsOf(memory);
  }
}

function fresh(body: CacheBody, now: number): boolean {
  return [...TRADED, ...EXTRAS].every((symbol) => {
    const entry = body.series[symbol];
    if (!entry) return false;
    const life = entry.error ? ERROR_RETRY_MS : CACHE_TTL_MS;
    return now - entry.at < life && (entry.bars?.length ?? 0) > 0;
  });
}

async function refresh(): Promise<CacheBody> {
  const base = memory ?? readDisk() ?? { v: 1 as const, series: {} };
  const series: Record<string, CacheEntry> = { ...base.series };
  const symbols = [...TRADED, ...EXTRAS];
  for (let i = 0; i < symbols.length; i += 4) {
    const chunk = symbols.slice(i, i + 4);
    await Promise.all(
      chunk.map(async (symbol) => {
        try {
          const totalReturn = !symbol.startsWith("^");
          const parsed = await fetchDailyBars(yahooSymbol(symbol), { range: "20y", keep: 6000, totalReturn });
          series[symbol] = { bars: parsed.bars.map((bar) => ({ date: bar.date, c: bar.c })), at: Date.now() };
        } catch (error) {
          const message = error instanceof Error ? error.message : "取得失敗";
          series[symbol] = { bars: series[symbol]?.bars, error: message.slice(0, 180), at: Date.now() };
        }
      }),
    );
  }
  const next: CacheBody = { v: 1, series };
  memory = next;
  try {
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify(next));
  } catch (error) {
    console.error("[range] robo cache", error);
  }
  return next;
}

function readDisk(): CacheBody | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(CACHE_PATH, "utf8")) as CacheBody;
    if (parsed?.v !== 1 || !parsed.series) return null;
    return parsed;
  } catch {
    return null;
  }
}

function barsOf(body: CacheBody | null): Record<string, CloseBar[]> {
  const out: Record<string, CloseBar[]> = {};
  for (const symbol of [...TRADED, ...EXTRAS]) out[symbol] = body?.series[symbol]?.bars ?? [];
  return out;
}

function todayEt(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}
