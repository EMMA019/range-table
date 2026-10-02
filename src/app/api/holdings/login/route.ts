import { NextResponse } from "next/server";
import {
  clientKey,
  configuredPasscode,
  loginLimiter,
  safeEqual,
  SESSION_COOKIE,
  SESSION_DAYS,
  signSession,
} from "@/lib/private-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Relative Location: behind Render's proxy request.url can carry the internal host. */
function back(query = ""): NextResponse {
  return new NextResponse(null, { status: 303, headers: { Location: `/holdings${query}` } });
}

export async function POST(request: Request) {
  const passcode = configuredPasscode();
  if (!passcode) return back("?e=off");
  const key = clientKey(request.headers);
  if (loginLimiter.blocked(key)) return back("?e=wait");
  const form = await request.formData().catch(() => null);
  const given = String(form?.get("passcode") ?? "");
  if (!safeEqual(given, passcode)) {
    loginLimiter.fail(key);
    await new Promise((resolve) => setTimeout(resolve, 400));
    return back("?e=bad");
  }
  loginLimiter.clear(key);
  const response = back();
  response.cookies.set(SESSION_COOKIE, signSession(passcode), {
    httpOnly: true,
    secure: new URL(request.url).protocol === "https:" || request.headers.get("x-forwarded-proto") === "https",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 86_400,
  });
  return response;
}
