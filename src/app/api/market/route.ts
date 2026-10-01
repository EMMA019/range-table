import { NextResponse } from "next/server";
import { getMarketPayload } from "@/lib/market";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const payload = await getMarketPayload();
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "日足を取得できなかった";
    console.error("[range] market route", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
