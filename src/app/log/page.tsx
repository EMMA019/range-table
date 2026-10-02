import type { Metadata } from "next";
import { SiteNav } from "@/components/site-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { TradeLogView } from "@/components/trade-log-view";

export const metadata: Metadata = {
  title: "取引ログ",
};

export default function LogPage() {
  return (
    <div className="mx-auto min-h-dvh w-full max-w-lg">
      <header className="sticky top-0 z-20 border-b border-line bg-bg/95 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur">
        <div className="flex items-center gap-3 pb-2">
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold leading-none tracking-tight">取引ログ</h1>
            <p className="mt-1 truncate text-[11px] text-muted">手数料込みの確定損益・勝率・$10達成日</p>
          </div>
          <ThemeToggle />
        </div>
        <SiteNav current="/log" />
      </header>
      <main className="px-4 py-4">
        <TradeLogView />
      </main>
    </div>
  );
}
