import { NextResponse } from "next/server";
import { getAlertsPayload } from "@/lib/alerts-feed";
import { bearerOk } from "@/lib/private-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  try {
    const payload = await getAlertsPayload({
      since: params.get("since"),
      authorized: bearerOk(request.headers.get("authorization")),
    });
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "アラートを作れなかった";
    console.error("[range] alerts route", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
