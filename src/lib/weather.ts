import type { Bar } from "./types";

export type WeatherCheck = {
  id: "spy200" | "breadth" | "vix";
  label: string;
  /** True is ○, false is ×, null is 「—」 because the series is missing. */
  ok: boolean | null;
  detail: string;
};

export type SemiEvent = {
  date: string;
  label: string;
};

export type WeatherView = {
  soxx: { close: number; ma20: number; above: boolean; devPct: number } | null;
  checks: WeatherCheck[];
  /** True when a market check is explicitly failing. Missing data does not raise it. */
  cautious: boolean;
  events: SemiEvent[];
  note: string | null;
};

const BREADTH_WINDOW = 50;
const SMA_LONG = 200;
export const VIX_MAX = 20;

export function aboveSma(bars: Bar[] | null | undefined, n: number): boolean | null {
  if (!bars || bars.length < n) return null;
  const slice = bars.slice(-n);
  const avg = slice.reduce((sum, bar) => sum + bar.c, 0) / n;
  const last = bars[bars.length - 1].c;
  if (!(avg > 0) || !Number.isFinite(last)) return null;
  return last >= avg;
}

/** Latest RSP/SPY ratio at or above its own average. Null until both series share `window` sessions. */
export function breadthOk(rsp: Bar[] | null | undefined, spy: Bar[] | null | undefined, window = BREADTH_WINDOW): boolean | null {
  if (!rsp || !spy) return null;
  const spyClose = new Map(spy.map((bar) => [bar.date, bar.c]));
  const ratios: number[] = [];
  for (const bar of rsp) {
    const other = spyClose.get(bar.date);
    if (other != null && other > 0 && bar.c > 0) ratios.push(bar.c / other);
  }
  if (ratios.length < window) return null;
  const use = ratios.slice(-window);
  const avg = use.reduce((sum, value) => sum + value, 0) / window;
  return use[use.length - 1] >= avg;
}

export function vixBelow(bars: Bar[] | null | undefined, max = VIX_MAX): boolean | null {
  const close = bars?.at(-1)?.c;
  if (close == null || !Number.isFinite(close)) return null;
  return close < max;
}

export function marketTurnedBad(checks: Array<boolean | null>): boolean {
  return checks.some((ok) => ok === false);
}

function checkMark(ok: boolean | null): string {
  if (ok == null) return "—";
  return ok ? "○" : "×";
}

export function buildWeather(input: {
  soxx: { close: number; ma20: number; devPct: number } | null;
  spy: Bar[] | null;
  rsp: Bar[] | null;
  vix: Bar[] | null;
  events: SemiEvent[];
  /** Set when the long-history fetch has not landed yet. */
  pending?: boolean;
}): WeatherView {
  const spyOk = aboveSma(input.spy, SMA_LONG);
  const breadth = breadthOk(input.rsp, input.spy);
  const vixOk = vixBelow(input.vix);
  const vixClose = input.vix?.at(-1)?.c;
  const checks: WeatherCheck[] = [
    {
      id: "spy200",
      label: "SPY>200日線",
      ok: spyOk,
      detail: spyOk == null ? "200日線の日足がまだない" : checkMark(spyOk),
    },
    {
      id: "breadth",
      label: "RSP/SPY",
      ok: breadth,
      detail: breadth == null ? "RSPの日足がまだない" : checkMark(breadth),
    },
    {
      id: "vix",
      label: "VIX<20",
      ok: vixOk,
      detail: vixClose == null ? "VIXがまだない" : `${checkMark(vixOk)} ${vixClose.toFixed(1)}`,
    },
  ];
  const soxx = input.soxx
    ? { ...input.soxx, above: input.soxx.close >= input.soxx.ma20 }
    : null;
  return {
    soxx,
    checks,
    cautious: marketTurnedBad(checks.map((check) => check.ok)),
    events: input.events.slice(0, 5),
    note: input.pending ? "相場チェックの長い日足を取得中" : null,
  };
}
