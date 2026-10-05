import type { Bar } from "./types";

/** Stooq daily CSV: Date,Open,High,Low,Close,Volume */
export async function fetchStooqDailyBars(ticker: string): Promise<Bar[]> {
  const sym = `${ticker.replace(/\./g, "-").toLowerCase()}.us`;
  const url = `https://stooq.com/q/d/l/?s=${sym}&i=d`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "range-table/1.0" },
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) return [];
    const text = await res.text();
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) return [];
    const out: Bar[] = [];
    for (let i = 1; i < lines.length; i += 1) {
      const [date, , , , close] = lines[i].split(",");
      const c = Number(close);
      if (!date || !Number.isFinite(c) || c <= 0) continue;
      const iso =
        date.length === 10 && date.includes("-") ? date : `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
      out.push({ date: iso, o: c, h: c, l: c, c, v: 0 });
    }
    out.sort((a, b) => a.date.localeCompare(b.date));
    return out;
  } catch {
    return [];
  }
}

export function mergePriceBars(primary: Bar[], fallback: Bar[]): Bar[] {
  if (!primary.length) return fallback;
  if (!fallback.length) return primary;
  const byDate = new Map<string, Bar>();
  for (const b of primary) byDate.set(b.date, b);
  for (const b of fallback) if (!byDate.has(b.date)) byDate.set(b.date, b);
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}
