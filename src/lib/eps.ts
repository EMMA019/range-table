import https from "node:https";
import { EPS_REQUEST_TIMEOUT_MS, EPS_WARM_CONCURRENCY, EPS_WARM_GAP_MS } from "./constants";
import { hasEpsValue, parseQuotePage, parseQuoteSummary, parseV7Quotes } from "./pe";
import type { EpsSnapshot } from "./types";

const HOSTS = ["https://query1.finance.yahoo.com", "https://query2.finance.yahoo.com"];
const COOKIE_URLS = ["https://fc.yahoo.com", "https://finance.yahoo.com/"];
const PROBE_ORDER = ["NVDA", "MSFT", "AVGO", "VRT", "AAPL"];

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const V7_BATCH = 40;
const SESSION_OK_MS = 30 * 60 * 1000;
const SESSION_FAIL_MS = 10 * 60 * 1000;
const SESSION_TIMEOUT_MS = 8_000;
const SUMMARY_TIMEOUT_MS = 8_000;

const TRAILING_EPS = Buffer.from("trailingEps");
const FORWARD_EPS = Buffer.from("forwardEps");

const agent = new https.Agent({
  keepAlive: true,
  maxSockets: EPS_WARM_CONCURRENCY + 1,
  maxFreeSockets: 2,
});

type Session = { cookie: string; crumb: string };

const NO_EPS: EpsSnapshot = { trailingEps: null, forwardEps: null, error: "EPSが空" };

let sessionMemo: { session: Session | null; until: number } | null = null;

/**
 * Trailing and forward EPS for one polite batch.
 * quoteSummary is tried when a crumb is available. If that route is blocked,
 * each symbol falls back to the v7 quote and then the public quote page.
 * Only symbols this call actually finished are returned. A per-request timeout
 * replaces the old shared budget so one slow page cannot fail the rest of the list.
 */
export async function fetchEpsBatch(
  symbols: string[],
  onItem?: (symbol: string, snap: EpsSnapshot) => void,
): Promise<Record<string, EpsSnapshot>> {
  const unique = [...new Set(symbols.map((symbol) => symbol.toUpperCase()))];
  const out: Record<string, EpsSnapshot> = {};
  if (unique.length === 0) return out;

  const note = (symbol: string, snap: EpsSnapshot) => {
    out[symbol] = snap;
    onItem?.(symbol, snap);
  };

  const session = await loadSession();
  let summaryOpen = Boolean(session);
  if (session) {
    const probe = PROBE_ORDER.find((symbol) => unique.includes(symbol)) ?? unique[0];
    const probeResult = await withTimeout(SUMMARY_TIMEOUT_MS, (signal) => fetchSummary(session, probe, signal));
    if (probeResult.blocked) {
      console.error(`[range] eps quoteSummary blocked ${probeResult.error}`);
      dropSession();
      summaryOpen = false;
    } else if (probeResult.snap && hasEpsValue(probeResult.snap)) {
      note(probe, { ...probeResult.snap, error: null });
      const rest = unique.filter((symbol) => symbol !== probe);
      await mapPool(rest, EPS_WARM_CONCURRENCY, async (symbol) => {
        if (!summaryOpen) return;
        const result = await withTimeout(SUMMARY_TIMEOUT_MS, (signal) => fetchSummary(session, symbol, signal));
        if (result.blocked) {
          console.error(`[range] eps ${symbol} quoteSummary blocked ${result.error}`);
          dropSession();
          summaryOpen = false;
          return;
        }
        if (result.snap && hasEpsValue(result.snap)) note(symbol, { ...result.snap, error: null });
        else if (result.error) note(symbol, { ...NO_EPS, error: result.error });
        await sleep(EPS_WARM_GAP_MS);
      });
    }
  }

  const afterSummary = unique.filter((symbol) => !out[symbol] || !hasEpsValue(out[symbol]));
  const liveSession = sessionMemo?.session;
  if (liveSession && afterSummary.length > 0 && summaryOpen) {
    console.log(`[range] eps v7 fallback symbols=${afterSummary.length}`);
    const batched = await withTimeout(SUMMARY_TIMEOUT_MS * 2, (signal) => fetchV7(liveSession, afterSummary, signal));
    for (const symbol of afterSummary) {
      const snap = batched.quotes.get(symbol);
      if (snap && hasEpsValue(snap)) note(symbol, { ...snap, error: null });
      else if (snap?.error && !/429|401|403/.test(snap.error)) note(symbol, { ...NO_EPS, error: snap.error });
    }
    if (batched.error && /429|401|403/.test(batched.error)) {
      console.error(`[range] eps v7 blocked ${batched.error}`);
      dropSession();
    }
  }

  const stillMissing = unique.filter((symbol) => {
    const snap = out[symbol];
    if (!snap) return true;
    if (hasEpsValue(snap)) return false;
    return !/EPSが空/.test(snap.error ?? "");
  });
  if (stillMissing.length > 0) {
    console.log(`[range] eps quote-page fallback symbols=${stillMissing.length}`);
    await mapPool(stillMissing, EPS_WARM_CONCURRENCY, async (symbol) => {
      const page = await withTimeout(EPS_REQUEST_TIMEOUT_MS, (signal) => fetchQuotePage(symbol, signal));
      if (page.snap && hasEpsValue(page.snap)) note(symbol, { ...page.snap, error: null });
      else note(symbol, { ...NO_EPS, error: page.error || out[symbol]?.error || "EPSが空" });
      await sleep(EPS_WARM_GAP_MS);
    });
  }

  const ok = unique.filter((symbol) => out[symbol] && hasEpsValue(out[symbol])).length;
  console.log(`[range] eps batch done ok=${ok} fail=${unique.filter((symbol) => out[symbol]).length - ok} unfinished=${unique.length - Object.keys(out).length}`);
  return out;
}

async function loadSession(): Promise<Session | null> {
  const now = Date.now();
  if (sessionMemo && now < sessionMemo.until) return sessionMemo.session;
  try {
    const session = await withTimeout(SESSION_TIMEOUT_MS, (signal) => openSession(signal));
    sessionMemo = { session, until: Date.now() + SESSION_OK_MS };
    return session;
  } catch (error) {
    console.error("[range] eps session failed", errText(error));
    sessionMemo = { session: null, until: Date.now() + SESSION_FAIL_MS };
    return null;
  }
}

function dropSession() {
  sessionMemo = { session: null, until: Date.now() + SESSION_FAIL_MS };
}

async function openSession(signal: AbortSignal): Promise<Session> {
  const jar = new Map<string, string>();
  for (const url of COOKIE_URLS) {
    try {
      const res = await request(url, {
        headers: { Accept: "text/html,application/json,*/*" },
        signal,
        redirect: "manual",
        discardBody: true,
      });
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
            discardBody: true,
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
      const res = await request(`${host}/v1/test/getcrumb`, {
        headers: { Accept: "text/plain", Cookie: cookie },
        signal,
      });
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
    discardBody?: boolean;
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
        timeout: EPS_REQUEST_TIMEOUT_MS,
        agent,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const location = typeof res.headers.location === "string" ? res.headers.location : null;
        const setCookie = Array.isArray(res.headers["set-cookie"]) ? res.headers["set-cookie"] : [];
        if (init.discardBody) {
          res.resume();
          resolve({ status, ok: status >= 200 && status < 300, body: "", location, setCookie });
          return;
        }
        if (init.redirect !== "manual" && location && status >= 300 && status < 400 && hops < 4) {
          res.resume();
          const next = new URL(location, url).toString();
          request(next, { ...init, hops: hops + 1 }).then(resolve, reject);
          return;
        }
        const chunks: Buffer[] = [];
        let received = 0;
        let carry = Buffer.alloc(0);
        let trail = false;
        let fwd = false;
        let settled = false;
        const cap = init.until ? 900_000 : 256_000;
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
          if (!init.until) {
            if (received > cap) {
              res.destroy();
              finish();
            }
            return;
          }
          const window = carry.length > 0 ? Buffer.concat([carry, chunk]) : chunk;
          if (!trail && window.includes(TRAILING_EPS)) trail = true;
          if (!fwd && window.includes(FORWARD_EPS)) fwd = true;
          carry = Buffer.from(chunk.subarray(Math.max(0, chunk.length - 16)));
          if ((trail && fwd) || received > cap) {
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(ms: number, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fn(controller.signal).finally(() => clearTimeout(timer));
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
