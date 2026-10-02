import type { Metadata } from "next";
import { AlertCards } from "@/components/alert-cards";
import { SiteNav } from "@/components/site-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { getAlertsPayload } from "@/lib/alerts-feed";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "アラート",
};

export default async function AlertsPage() {
  let error: string | null = null;
  let payload: Awaited<ReturnType<typeof getAlertsPayload>> | null = null;
  try {
    payload = await getAlertsPayload({ since: null });
  } catch (err) {
    error = err instanceof Error ? err.message : "アラートを作れなかった";
  }

  return (
    <div className="mx-auto min-h-dvh w-full max-w-lg">
      <header className="sticky top-0 z-20 border-b border-line bg-bg/95 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur">
        <div className="flex items-center gap-3 pb-2">
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold leading-none tracking-tight">アラート</h1>
            {payload && (
              <p className="mt-1 truncate text-[11px] text-muted">
                終値日 {payload.barDate ?? "—"}
                {payload.sources.prices.provisional ? "（暫定）" : ""} · 作成 {payload.generatedAtJst}
              </p>
            )}
          </div>
          <ThemeToggle />
        </div>
        <SiteNav current="/alerts" />
      </header>
      <main className="space-y-3 px-4 py-4">
        {error ? (
          <p className="text-sm text-rust">{error}</p>
        ) : payload && payload.items.length > 0 ? (
          <AlertCards items={payload.items} />
        ) : (
          <p className="pt-6 text-sm leading-relaxed text-muted">いま行動が必要な項目はない。</p>
        )}
        <p className="pt-2 text-[11px] leading-relaxed text-muted">
          IN OK・ATR3%以上・決算5営業日以内なしの銘柄。決算日が未登録の銘柄は「低」で出す。同じ内容は同じIDのまま。JSONは /api/alerts。
        </p>
      </main>
    </div>
  );
}
