import { FETCH_CONCURRENCY } from "./constants";
import { parseQuoteSummary } from "./pe";
import type { EpsSnapshot } from "./types";

const HOSTS = ["https://query1.finance.yahoo.com", "https://query2.finance.yahoo.com"];

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const EPS_BUDGET_MS = 25_000;

type Session = { cookie: string; crumb: string };

class AuthError extends Error {
  readonly auth = true;
}

const EMPTY: EpsSnapshot = { trailingEps: null, forwardEps: null };

/**
 * Trailing and forward EPS from quoteSummary. Failures stay empty so callers
 * can still render prices. A 25s budget keeps a hung Yahoo response from
 * holding the page open.
 */
export async function fetchEpsMap(symbols: string[]): Promise<Record<string, EpsSnapshot>> {
  const unique = [...new Set(symbols.map((symbol) => symbol.toUpperCase()))];
  const out: Record<string, EpsSnapshot> = {};
  if (unique.length === 0) return out;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EPS_BUDGET_MS);
  let session: Session | null = null;
  try {
    session = await openSession(controller.signal);
  } catch (error) {
    console.error("[range] eps session", error);
    clearTimeout(timer);
    return out;
  }

  let cursor = 0;
  async function worker() {
    while (cursor < unique.length && !controller.signal.aborted && session) {
      const symbol = unique[cursor];
      cursor += 1;
      try {
        const snap = await fetchSymbol(session, symbol, controller.signal);
        if (snap) out[symbol] = snap;
      } catch (error) {
        if (controller.signal.aborted) return;
        if (!(error instanceof AuthError)) {
          console.error("[range] eps", symbol, error);
          continue;
        }
        try {
          session = await openSession(controller.signal);
          const snap = await fetchSymbol(session, symbol, controller.signal);
          if (snap) out[symbol] = snap;
        } catch (retryError) {
          if (!controller.signal.aborted) console.error("[range] eps", symbol, retryError);
        }
      }
    }
  }

  try {
    const workers = Math.min(FETCH_CONCURRENCY, unique.length);
    await Promise.all(Array.from({ length: workers }, () => worker()));
  } finally {
    clearTimeout(timer);
  }
  return out;
}

async function openSession(signal: AbortSignal): Promise<Session> {
  const gate = await fetch("https://fc.yahoo.com", {
    headers: { "User-Agent": UA, Accept: "*/*" },
    redirect: "manual",
    cache: "no-store",
    signal,
  });
  const cookie = gate.headers
    .getSetCookie()
    .map((part) => part.split(";")[0])
    .filter(Boolean)
    .join("; ");
  if (!cookie) throw new Error("Yahooのcookieを取得できなかった");

  let lastError: Error | null = null;
  for (const host of HOSTS) {
    try {
      const crumbRes = await fetch(`${host}/v1/test/getcrumb`, {
        headers: { "User-Agent": UA, Accept: "text/plain", Cookie: cookie },
        cache: "no-store",
        signal,
      });
      const crumb = (await crumbRes.text()).trim();
      if (!crumbRes.ok || !crumb || crumb.startsWith("<") || crumb.startsWith("{")) {
        throw new Error("Yahooのcrumbを取得できなかった");
      }
      return { cookie, crumb };
    } catch (error) {
      if (signal.aborted) throw error;
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }
  throw lastError ?? new Error("Yahooのcrumbを取得できなかった");
}

async function fetchSymbol(
  session: Session,
  symbol: string,
  signal: AbortSignal,
): Promise<EpsSnapshot | null> {
  let lastError: Error | null = null;
  for (const host of HOSTS) {
    const url = `${host}/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=defaultKeyStatistics,financialData&crumb=${encodeURIComponent(session.crumb)}`;
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": UA,
          Accept: "application/json",
          Cookie: session.cookie,
        },
        cache: "no-store",
        signal,
      });
      if (res.status === 401 || res.status === 403) throw new AuthError(`HTTP ${res.status}`);
      if (res.status === 404) return EMPTY;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return parseQuoteSummary(await res.json());
    } catch (error) {
      if (error instanceof AuthError || signal.aborted) throw error;
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }
  throw lastError ?? new Error("EPSを取得できなかった");
}
