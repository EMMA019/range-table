import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    ok: true,
    commit: (process.env.RENDER_GIT_COMMIT ?? "").slice(0, 7) || null,
  });
}
