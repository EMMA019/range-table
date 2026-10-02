import { NextResponse } from "next/server";
import { runPrecheck } from "@/lib/holdings-feed";
import { bearerOk } from "@/lib/private-auth";
import { hasHoldingsSession } from "@/lib/private-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Private pre-buy check. Reads only; nothing is stored and no order is ever sent. */
export async function POST(request: Request) {
  if (!bearerOk(request.headers.get("authorization")) && !(await hasHoldingsSession())) {
    return NextResponse.json({ error: "認証が必要" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const ticker = typeof body?.ticker === "string" ? body.ticker : "";
  const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : typeof value === "string" && value.trim() ? Number(value) : null);
  try {
    const result = await runPrecheck({ ticker, shares: num(body?.shares), price: num(body?.price) });
    const status = "error" in result ? 400 : 200;
    return NextResponse.json(result, { status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[range] precheck", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "チェックできなかった" }, { status: 500 });
  }
}
