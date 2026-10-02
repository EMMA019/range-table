import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/private-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const response = new NextResponse(null, { status: 303, headers: { Location: "/holdings" } });
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  return response;
}
