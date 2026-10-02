import crypto from "node:crypto";

/**
 * Gate for the private pages. The passcode lives only in Render's environment; the session
 * cookie is signed with a key derived from it, so changing the passcode signs everyone out.
 * Without a passcode the private pages stay closed (the site itself is public).
 */
export const HOLDINGS_PASSCODE_ENV = "HOLDINGS_PASSCODE";
/** Bearer token for an assistant that needs holdings-derived alerts from /api/alerts or /api/precheck. */
export const ALERTS_TOKEN_ENV = "ALERTS_TOKEN";
export const SESSION_COOKIE = "rt_holdings";
export const SESSION_DAYS = 30;
const MIN_SECRET_LENGTH = 8;
const MIN_TOKEN_LENGTH = 16;

type Env = Record<string, string | undefined>;

export function configuredPasscode(env: Env = process.env): string | null {
  const value = env[HOLDINGS_PASSCODE_ENV]?.trim() ?? "";
  return value.length >= MIN_SECRET_LENGTH ? value : null;
}

/** Compares hashes so neither the length nor an early mismatch leaks through timing. */
export function safeEqual(given: string, expected: string): boolean {
  const a = crypto.createHash("sha256").update(given).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

function sessionKey(passcode: string): Buffer {
  return crypto.createHash("sha256").update(`range-table/holdings-session/${passcode}`).digest();
}

function mac(passcode: string, payload: string): string {
  return crypto.createHmac("sha256", sessionKey(passcode)).update(payload).digest("base64url");
}

export function signSession(passcode: string, now = Date.now()): string {
  const exp = now + SESSION_DAYS * 86_400_000;
  const payload = `v1.${exp}`;
  return `${payload}.${mac(passcode, payload)}`;
}

export function verifySession(cookie: string | undefined, passcode: string | null, now = Date.now()): boolean {
  if (!cookie || !passcode) return false;
  const match = /^v1\.(\d{10,16})\.([A-Za-z0-9_-]{20,})$/.exec(cookie);
  if (!match) return false;
  if (Number(match[1]) <= now) return false;
  return safeEqual(match[2], mac(passcode, `v1.${match[1]}`));
}

export function bearerOk(header: string | null, env: Env = process.env): boolean {
  const token = env[ALERTS_TOKEN_ENV]?.trim() ?? "";
  if (token.length < MIN_TOKEN_LENGTH || !header) return false;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? safeEqual(match[1].trim(), token) : false;
}

/** Wrong passcodes per client: a few tries, then a pause. In memory, so a restart forgets. */
export function createLoginLimiter(maxFailures = 8, windowMs = 15 * 60_000) {
  const failures = new Map<string, { count: number; resetAt: number }>();
  return {
    blocked(key: string, now = Date.now()): boolean {
      const entry = failures.get(key);
      if (!entry || entry.resetAt <= now) return false;
      return entry.count >= maxFailures;
    },
    fail(key: string, now = Date.now()): void {
      const entry = failures.get(key);
      if (!entry || entry.resetAt <= now) failures.set(key, { count: 1, resetAt: now + windowMs });
      else entry.count += 1;
      if (failures.size > 1000) {
        for (const [k, v] of failures) if (v.resetAt <= now) failures.delete(k);
      }
    },
    clear(key: string): void {
      failures.delete(key);
    },
  };
}

export const loginLimiter = createLoginLimiter();

export function clientKey(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "local";
}
