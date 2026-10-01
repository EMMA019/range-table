import { NextResponse } from "next/server";
import { getPicksPayload } from "@/lib/market";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const payload = await getPicksPayload();
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "推奨を読めなかった";
    console.error("[range] picks route", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
