import { NextResponse } from "next/server";
import { getMarketPayload } from "@/lib/market";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    // ?u=all is the bulk-consumer contract (candidate screening, scripts/count-verdict.ts):
    // wait until the whole universe has been fetched instead of answering mid-backfill.
    const awaitUniverse = new URL(request.url).searchParams.get("u") === "all";
    const payload = await getMarketPayload({ awaitUniverse });
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "日足を取得できなかった";
    console.error("[range] market route", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
