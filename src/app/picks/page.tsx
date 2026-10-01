import type { Metadata } from "next";
import { PickCards } from "@/components/pick-cards";
import { SiteNav } from "@/components/site-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { TEAM_PICKS_EMPTY } from "@/lib/copy";
import { formatAge } from "@/lib/format";
import { getPicksPayload } from "@/lib/market";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "チーム注目",
};

export default async function PicksPage() {
  let error: string | null = null;
  let payload: Awaited<ReturnType<typeof getPicksPayload>> | null = null;
  try {
    payload = await getPicksPayload();
  } catch (err) {
    error = err instanceof Error ? err.message : "推奨を読めなかった";
  }

  return (
    <div className="mx-auto min-h-dvh w-full max-w-lg">
      <header className="sticky top-0 z-20 border-b border-line bg-bg/95 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur">
        <div className="flex items-center gap-3 pb-2">
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold leading-none tracking-tight">チーム注目</h1>
            {payload && !payload.empty && (
              <p className="mt-1 truncate text-[11px] text-muted">{formatAge(payload.fetchedAt)}</p>
            )}
          </div>
          <ThemeToggle />
        </div>
        <SiteNav current="/picks" />
      </header>
      <main className="px-4 py-4">
        {error ? (
          <p className="text-sm text-rust">{error}</p>
        ) : payload && !payload.empty ? (
          <PickCards picks={payload.picks} />
        ) : (
          <p className="pt-6 text-sm leading-relaxed text-muted">{TEAM_PICKS_EMPTY}</p>
        )}
      </main>
    </div>
  );
}
