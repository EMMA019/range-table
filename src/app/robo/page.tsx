import type { Metadata } from "next";
import { RoboView } from "@/components/robo-view";
import { SiteNav } from "@/components/site-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { roboHoldingsFromEnv } from "@/lib/robo-holdings";
import { configuredPasscode } from "@/lib/private-auth";
import { hasHoldingsSession } from "@/lib/private-session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "ロボ枠",
  description: "ETFの月次見直し案。発注も推奨もしない。",
  robots: { index: false, follow: false },
};

export default async function RoboPage() {
  const authed = configuredPasscode() != null && (await hasHoldingsSession());
  const seed = authed ? roboHoldingsFromEnv() : [];
  return (
    <div className="mx-auto min-h-dvh w-full max-w-lg">
      <header className="sticky top-0 z-20 border-b border-line bg-bg/95 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur">
        <div className="flex items-center gap-3 pb-2">
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold leading-none tracking-tight">ロボ枠</h1>
            <p className="mt-1 truncate text-[11px] text-muted">個別株とは別。提案だけ。注文は出さない</p>
          </div>
          <ThemeToggle />
        </div>
        <SiteNav current="/robo" />
      </header>
      <main className="px-4 py-4">
        <RoboView seed={seed} />
      </main>
    </div>
  );
}
