import https from "node:https";
import { FETCH_CONCURRENCY } from "./constants";
import { hasEpsValue, parseQuotePage, parseQuoteSummary, parseV7Quotes } from "./pe";
import type { EpsSnapshot } from "./types";

const HOSTS = ["https://query1.finance.yahoo.com", "https://query2.finance.yahoo.com"];
const COOKIE_URLS = ["https://fc.yahoo.com", "https://finance.yahoo.com/"];
const PROBE_ORDER = ["NVDA", "MSFT", "AVGO", "VRT", "AAPL"];

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const EPS_BUDGET_MS = 45_000;
const V7_BATCH = 40;

type Session = { cookie: string; crumb: string };

const NO_EPS: EpsSnapshot = { trailingEps: null, forwardEps: null, error: "EPSが空" };

/**
 * Trailing and forward EPS. quoteSummary is tried first. If that route is
 * blocked (401/403/429) or returns no numbers, the v7 quote endpoint is used.
 * Failures are returned with an error string so callers can retry soon instead
 * of caching an empty result for a day. A hung Yahoo call cannot hold the page
 * longer than the budget.
 */
export async function fetchEpsMap(symbols: string[]): Promise<Record<string, EpsSnapshot>> {
  const unique = [...new Set(symbols.map((symbol) => symbol.toUpperCase()))];
  const out: Record<string, EpsSnapshot> = {};
  if (unique.length === 0) return out;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EPS_BUDGET_MS);
  try {
    let session: Session | null = null;
    try {
      session = await openSession(controller.signal);
    } catch (error) {
      console.error("[range] eps session failed", errText(error));
    }

    const probe = PROBE_ORDER.find((symbol) => unique.includes(symbol)) ?? unique[0];
    if (!session) {
      // Crumb was blocked (often HTTP 429 from a datacenter). The quote page still embeds EPS.
    } else {
    const probeResult = await fetchSummary(session, probe, controller.signal);
    const summaryBlocked = probeResult.blocked;
    if (!summaryBlocked && probeResult.snap && hasEpsValue(probeResult.snap)) {
      await mapPool(unique, FETCH_CONCURRENCY, async (symbol) => {
        if (controller.signal.aborted) return;
        const result = await fetchSummary(session, symbol, controller.signal);
        if (result.snap && hasEpsValue(result.snap)) out[symbol] = { ...result.snap, error: null };
        else if (result.error) out[symbol] = { ...NO_EPS, error: result.error };
      });
    } else if (probeResult.error) {
      for (const symbol of unique) out[symbol] = { ...NO_EPS, error: probeResult.error };
    }

    const missing = unique.filter((symbol) => !out[symbol] || !hasEpsValue(out[symbol]));
    if (missing.length > 0 && !controller.signal.aborted) {
      console.log(`[range] eps v7 fallback symbols=${missing.length} summaryBlocked=${summaryBlocked}`);
      const batched = await fetchV7(session, missing, controller.signal);
      for (const symbol of missing) {
        const snap = batched.quotes.get(symbol);
        if (snap && hasEpsValue(snap)) out[symbol] = { ...snap, error: null };
        else out[symbol] = { ...NO_EPS, error: snap?.error || batched.error || out[symbol]?.error || "EPSが空" };
      }
    }
    }

    const stillMissing = unique.filter((symbol) => !out[symbol] || !hasEpsValue(out[symbol]));
    if (stillMissing.length > 0 && !controller.signal.aborted) {
      console.log(`[range] eps quote-page fallback symbols=${stillMissing.length}`);
      await mapPool(stillMissing, FETCH_CONCURRENCY, async (symbol) => {
        if (controller.signal.aborted) return;
        const page = await fetchQuotePage(symbol, controller.signal);
        if (page.snap && hasEpsValue(page.snap)) out[symbol] = { ...page.snap, error: null };
        else out[symbol] = { ...NO_EPS, error: page.error || out[symbol]?.error || "EPSが空" };
      });
    }

    for (const symbol of unique) {
      if (!out[symbol]) {
        out[symbol] = { ...NO_EPS, error: controller.signal.aborted ? "timeout" : "EPSが空" };
      }
    }
    const ok = unique.filter((symbol) => hasEpsValue(out[symbol])).length;
    console.log(`[range] eps ready ok=${ok} fail=${unique.length - ok}`);
    return out;
  } finally {
    clearTimeout(timer);
  }
}

async function openSession(signal: AbortSignal): Promise<Session> {
  const jar = new Map<string, string>();
  for (const url of COOKIE_URLS) {
    try {
      const res = await request(url, { headers: { Accept: "text/html,application/json,*/*" }, signal, redirect: "manual" });
      absorbCookies(jar, res.setCookie);
      console.log(`[range] eps cookie ${hostOf(url)} HTTP ${res.status} names=${cookieNames(jar)}`);
      const location = res.location;
      if (location && res.status >= 300 && res.status < 400) {
        const next = new URL(location, url);
        if (next.protocol === "https:") {
          const followed = await request(next.toString(), {
            headers: { Accept: "*/*", Cookie: cookieHeader(jar) },
            signal,
            redirect: "manual",
          });
          absorbCookies(jar, followed.setCookie);
          console.log(`[range] eps cookie ${next.host} HTTP ${followed.status} names=${cookieNames(jar)}`);
        }
      }
    } catch (error) {
      console.error(`[range] eps cookie ${hostOf(url)}`, errText(error));
    }
  }

  const cookie = cookieHeader(jar);
  if (!cookie) throw new Error("cookieを取得できなかった");

  let lastError = "crumbを取得できなかった";
  for (const host of HOSTS) {
    try {
      let res = await request(`${host}/v1/test/getcrumb`, {
        headers: { Accept: "text/plain", Cookie: cookie },
        signal,
      });
      for (let attempt = 0; res.status === 429 && attempt < 2; attempt++) {
        console.error(`[range] eps getcrumb HTTP 429 host=${hostOf(host)} retry=${attempt + 1}`);
        await delay(800 * (attempt + 1), signal);
        res = await request(`${host}/v1/test/getcrumb`, {
          headers: { Accept: "text/plain", Cookie: cookie },
          signal,
        });
      }
      const body = res.body.trim();
      if (!res.ok || !body || body.startsWith("<") || body.startsWith("{") || body.length > 64) {
        lastError = `getcrumb HTTP ${res.status} ${clip(body)}`;
        console.error(`[range] eps ${lastError} host=${hostOf(host)}`);
        continue;
      }
      console.log(`[range] eps crumb HTTP ${res.status} host=${hostOf(host)} len=${body.length}`);
      return { cookie, crumb: body };
    } catch (error) {
      lastError = errText(error);
      console.error(`[range] eps getcrumb ${hostOf(host)}`, lastError);
    }
  }
  throw new Error(lastError);
}

type SummaryResult = { snap: EpsSnapshot | null; blocked: boolean; error: string | null };

async function fetchSummary(session: Session, symbol: string, signal: AbortSignal): Promise<SummaryResult> {
  let lastError = "quoteSummaryに失敗";
  for (const host of HOSTS) {
    const url = `${host}/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=defaultKeyStatistics,financialData&crumb=${encodeURIComponent(session.crumb)}`;
    try {
      const res = await request(url, {
        headers: { Accept: "application/json", Cookie: session.cookie },
        signal,
      });
      const body = res.body;
      if (res.status === 401 || res.status === 403 || res.status === 429) {
        const error = `quoteSummary HTTP ${res.status} ${clip(body)}`;
        console.error(`[range] eps ${symbol} ${hostOf(host)} ${error}`);
        return { snap: null, blocked: true, error };
      }
      if (!res.ok) {
        lastError = `quoteSummary HTTP ${res.status} ${clip(body)}`;
        console.error(`[range] eps ${symbol} ${hostOf(host)} ${lastError}`);
        continue;
      }
      const snap = parseQuoteSummary(safeJson(body));
      if (!snap) {
        lastError = `quoteSummary HTTP 200 応答が不正 ${clip(body)}`;
        console.error(`[range] eps ${symbol} ${hostOf(host)} ${lastError}`);
        continue;
      }
      if (!hasEpsValue(snap)) {
        console.error(`[range] eps ${symbol} ${hostOf(host)} quoteSummary HTTP 200 EPSが空`);
        return { snap: { ...snap, error: "quoteSummaryのEPSが空" }, blocked: false, error: "quoteSummaryのEPSが空" };
      }
      return { snap, blocked: false, error: null };
    } catch (error) {
      lastError = errText(error);
      if (signal.aborted) return { snap: null, blocked: false, error: "timeout" };
      console.error(`[range] eps ${symbol} ${hostOf(host)} ${lastError}`);
    }
  }
  return { snap: null, blocked: false, error: lastError };
}

async function fetchV7(
  session: Session,
  symbols: string[],
  signal: AbortSignal,
): Promise<{ quotes: Map<string, EpsSnapshot>; error: string | null }> {
  const quotes = new Map<string, EpsSnapshot>();
  let lastError: string | null = null;
  for (let i = 0; i < symbols.length; i += V7_BATCH) {
    if (signal.aborted) {
      lastError = "timeout";
      break;
    }
    const group = symbols.slice(i, i + V7_BATCH);
    const joined = group.join(",");
    let done = false;
    for (const host of HOSTS) {
      const url = `${host}/v7/finance/quote?symbols=${encodeURIComponent(joined)}&crumb=${encodeURIComponent(session.crumb)}`;
      try {
        const res = await request(url, {
          headers: { Accept: "application/json", Cookie: session.cookie },
          signal,
        });
        const body = res.body;
        if (!res.ok) {
          lastError = `v7 quote HTTP ${res.status} ${clip(body)}`;
          console.error(`[range] eps ${hostOf(host)} ${lastError}`);
          continue;
        }
        const parsed = parseV7Quotes(safeJson(body));
        if (parsed.length === 0) {
          lastError = `v7 quote HTTP 200 応答が空 ${clip(body)}`;
          console.error(`[range] eps ${hostOf(host)} ${lastError}`);
          continue;
        }
        let filled = 0;
        for (const item of parsed) {
          if (!hasEpsValue(item)) {
            quotes.set(item.ticker, { ...NO_EPS, error: "v7 quoteのEPSが空" });
            continue;
          }
          filled += 1;
          quotes.set(item.ticker, { trailingEps: item.trailingEps, forwardEps: item.forwardEps, error: null });
        }
        console.log(`[range] eps v7 ${hostOf(host)} HTTP 200 batch=${group.length} withEps=${filled}`);
        done = true;
        break;
      } catch (error) {
        lastError = errText(error);
        console.error(`[range] eps v7 ${hostOf(host)}`, lastError);
        if (signal.aborted) break;
      }
    }
    if (!done && !lastError) lastError = "v7 quoteに失敗";
  }
  return { quotes, error: lastError };
}

type HttpResult = {
  status: number;
  ok: boolean;
  body: string;
  location: string | null;
  setCookie: string[];
};

async function fetchQuotePage(
  symbol: string,
  signal: AbortSignal,
): Promise<{ snap: EpsSnapshot | null; error: string | null }> {
  const slug = symbol.replace(/\./g, "-");
  const url = `https://finance.yahoo.com/quote/${encodeURIComponent(slug)}/`;
  try {
    const res = await request(url, {
      headers: { Accept: "text/html" },
      signal,
      redirect: "follow",
      until: (text) => text.includes("trailingEps") && text.includes("forwardEps"),
    });
    if (res.status === 429) {
      const error = `quote page HTTP 429 ${clip(res.body)}`;
      console.error(`[range] eps ${symbol} ${error}`);
      return { snap: null, error };
    }
    if (!res.ok) {
      const error = `quote page HTTP ${res.status} ${clip(res.body)}`;
      console.error(`[range] eps ${symbol} ${error}`);
      return { snap: null, error };
    }
    const snap = parseQuotePage(res.body);
    if (!snap || !hasEpsValue(snap)) {
      console.error(`[range] eps ${symbol} quote page HTTP 200 EPSが空`);
      return { snap: null, error: "quote pageのEPSが空" };
    }
    return { snap, error: null };
  } catch (error) {
    const message = errText(error);
    console.error(`[range] eps ${symbol} quote page`, message);
    return { snap: null, error: message };
  }
}

async function request(
  url: string,
  init: {
    headers: Record<string, string>;
    signal: AbortSignal;
    redirect?: "manual" | "follow";
    until?: (text: string) => boolean;
    hops?: number;
  },
): Promise<HttpResult> {
  const hops = init.hops ?? 0;
  return await new Promise((resolve, reject) => {
    const target = new URL(url);
    const req = https.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        path: `${target.pathname}${target.search}`,
        method: "GET",
        headers: { "User-Agent": UA, ...init.headers },
        maxHeaderSize: 256 * 1024,
        timeout: 15_000,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const location = typeof res.headers.location === "string" ? res.headers.location : null;
        const setCookie = Array.isArray(res.headers["set-cookie"]) ? res.headers["set-cookie"] : [];
        if (init.redirect !== "manual" && location && status >= 300 && status < 400 && hops < 4) {
          res.resume();
          const next = new URL(location, url).toString();
          request(next, { ...init, hops: hops + 1 }).then(resolve, reject);
          return;
        }
        const chunks: Buffer[] = [];
        let received = 0;
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          resolve({
            status,
            ok: status >= 200 && status < 300,
            body: Buffer.concat(chunks).toString("utf8"),
            location,
            setCookie,
          });
        };
        res.on("data", (chunk: Buffer) => {
          if (settled) return;
          chunks.push(chunk);
          received += chunk.length;
          if (received < 700_000 && received <= 1_400_000) return;
          const text = Buffer.concat(chunks).toString("utf8");
          if ((init.until && init.until(text)) || received > 1_400_000) {
            res.destroy();
            finish();
          }
        });
        res.on("end", finish);
        res.on("error", finish);
      },
    );
    const abort = () => req.destroy(new Error("timeout"));
    if (init.signal.aborted) {
      abort();
      return;
    }
    init.signal.addEventListener("abort", abort, { once: true });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end();
  });
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

function absorbCookies(jar: Map<string, string>, parts: string[]) {
  for (const part of parts) {
    const pair = part.split(";")[0] ?? "";
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}

function cookieHeader(jar: Map<string, string>): string {
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

function cookieNames(jar: Map<string, string>): string {
  return [...jar.keys()].join(",") || "(none)";
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function clip(body: string): string {
  return body.replace(/\s+/g, " ").trim().slice(0, 160);
}

function safeJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function errText(error: unknown): string {
  if (error instanceof Error) {
    if (/aborted|AbortError|timeout/i.test(error.message) || error.name === "AbortError" || error.name === "TimeoutError") {
      return "timeout";
    }
    return error.message.slice(0, 180);
  }
  return String(error).slice(0, 180);
}

async function mapPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await fn(items[index]);
    }
  }
  const workers = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
}
