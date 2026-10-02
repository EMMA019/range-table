/**
 * Shared cooldown for one upstream host family. A 429 pauses every caller, and each
 * further 429 doubles the pause (with jitter) up to `maxMs`. A success clears it.
 */
export type RateGate = {
  wait(): Promise<void>;
  penalize(): number;
  ok(): void;
  remainingMs(): number;
};

export function createRateGate(options: {
  baseMs: number;
  maxMs: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}): RateGate {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const random = options.random ?? Math.random;
  let strikes = 0;
  let until = 0;
  return {
    async wait() {
      for (let guard = 0; guard < 20; guard++) {
        const left = until - now();
        if (left <= 0) return;
        await sleep(left);
      }
    },
    penalize() {
      strikes += 1;
      const raw = Math.min(options.maxMs, options.baseMs * 2 ** (strikes - 1));
      const pause = Math.round(raw * (0.8 + 0.4 * random()));
      until = Math.max(until, now() + pause);
      return pause;
    },
    ok() {
      strikes = 0;
    },
    remainingMs() {
      return Math.max(0, until - now());
    },
  };
}

/** Yahoo chart, quoteSummary, v7 quote and quote pages share one cooldown. */
export const yahooGate = createRateGate({ baseMs: 5_000, maxMs: 60_000 });
