import { NextResponse } from "next/server";
import { loadMonitorIndex } from "@/lib/monitor-universe";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  let union: number | null = null;
  let asOfDate: string | null = null;
  try {
    const index = loadMonitorIndex();
    union = index.union.length;
    asOfDate = index.asOfDate;
  } catch {
    union = null;
  }
  return NextResponse.json({
    ok: true,
    commit: (process.env.RENDER_GIT_COMMIT ?? "").slice(0, 7) || null,
    union,
    asOfDate,
  });
}
