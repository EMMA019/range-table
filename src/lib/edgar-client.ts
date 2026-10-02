import https from "node:https";
import zlib from "node:zlib";
import { createRateGate } from "./rate-gate";

/**
 * SEC EDGAR fair access: declare who is calling and stay under 10 requests per second.
 * SEC answers 403 to a User-Agent without a contact email, so EDGAR stays off until
 * SEC_USER_AGENT ("range-table <contact email>") is set. The email stays out of the repo.
 */
export const SEC_USER_AGENT_ENV = "SEC_USER_AGENT";
const MIN_GAP_MS = 200;
const TIMEOUT_MS = 20_000;
const MAX_BYTES = 12_000_000;

const agent = new https.Agent({ keepAlive: true, maxSockets: 2, maxFreeSockets: 1 });

/** 403/429 from SEC pause every EDGAR call: 1 minute, doubling up to 15 minutes. */
export const edgarGate = createRateGate({ baseMs: 60_000, maxMs: 15 * 60_000 });

let lastStart = 0;
let chain: Promise<void> = Promise.resolve();

/** The declared User-Agent, or null when it has no contact email. */
export function secUserAgent(env: Record<string, string | undefined> = process.env): string | null {
  const value = env[SEC_USER_AGENT_ENV]?.trim() ?? "";
  return /\S+@\S+\.\S+/.test(value) ? value : null;
}

export class EdgarDisabledError extends Error {
  constructor() {
    super(`${SEC_USER_AGENT_ENV} が未設定（連絡先メール入り）`);
  }
}

/** Serializes request starts so they are at least MIN_GAP_MS apart (≤ 5 per second). */
function pace(): Promise<void> {
  const next = chain.then(async () => {
    await edgarGate.wait();
    const wait = lastStart + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastStart = Date.now();
  });
  chain = next.catch(() => undefined);
  return next;
}

export class EdgarHttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function edgarGet(url: string, accept = "application/json"): Promise<string> {
  const userAgent = secUserAgent();
  if (!userAgent) throw new EdgarDisabledError();
  await pace();
  const target = new URL(url);
  return await new Promise<string>((resolve, reject) => {
    const req = https.request(
      {
        hostname: target.hostname,
        path: `${target.pathname}${target.search}`,
        method: "GET",
        headers: {
          "User-Agent": userAgent,
          Accept: accept,
          "Accept-Encoding": "gzip, deflate",
        },
        agent,
        timeout: TIMEOUT_MS,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status === 403 || status === 429) {
          const pause = edgarGate.penalize();
          console.error(`[range] edgar HTTP ${status} ${target.pathname} cooldown=${pause}ms`);
        }
        const encoding = String(res.headers["content-encoding"] ?? "");
        const stream =
          encoding.includes("gzip") ? res.pipe(zlib.createGunzip()) : encoding.includes("deflate") ? res.pipe(zlib.createInflate()) : res;
        const chunks: Buffer[] = [];
        let received = 0;
        let settled = false;
        const fail = (error: Error) => {
          if (settled) return;
          settled = true;
          res.destroy();
          reject(error);
        };
        stream.on("data", (chunk: Buffer) => {
          received += chunk.length;
          if (received > MAX_BYTES) {
            fail(new Error("EDGARの応答が大きすぎる"));
            return;
          }
          chunks.push(chunk);
        });
        stream.on("end", () => {
          if (settled) return;
          settled = true;
          if (status < 200 || status >= 300) {
            reject(new EdgarHttpError(status, `EDGAR HTTP ${status}`));
            return;
          }
          if (status === 200) edgarGate.ok();
          resolve(Buffer.concat(chunks).toString("utf8"));
        });
        stream.on("error", (error: Error) => fail(error));
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end();
  });
}

export async function edgarJson<T>(url: string): Promise<T> {
  return JSON.parse(await edgarGet(url, "application/json")) as T;
}
