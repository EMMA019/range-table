import { NextResponse } from "next/server";
import { getChart } from "@/lib/market";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ ticker: string }> },
) {
  const { ticker } = await context.params;
  if (!/^[A-Za-z][A-Za-z0-9.]{0,9}$/.test(ticker)) {
    return NextResponse.json({ error: "ティッカーが不正" }, { status: 400 });
  }
  try {
    const chart = await getChart(ticker);
    if ("error" in chart) {
      return NextResponse.json(chart, { status: 404 });
    }
    return NextResponse.json(chart, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "チャートを取得できなかった";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
