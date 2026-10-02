import type { Metadata } from "next";
import { AccountCard, HoldingCards } from "@/components/holdings-cards";
import { PrecheckPanel } from "@/components/precheck-panel";
import { SiteNav } from "@/components/site-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { getHoldingsView } from "@/lib/holdings-feed";
import { configuredPasscode, HOLDINGS_PASSCODE_ENV } from "@/lib/private-auth";
import { hasHoldingsSession } from "@/lib/private-session";
import { loadWatchlist } from "@/lib/watchlist";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "保有",
  robots: { index: false, follow: false },
};

const LOGIN_ERROR: Record<string, string> = {
  bad: "パスコードが違う",
  wait: "失敗が続いたので15分ほど待つ",
  off: `${HOLDINGS_PASSCODE_ENV} が未設定`,
};

export default async function HoldingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const configured = configuredPasscode() != null;
  const authed = configured && (await hasHoldingsSession());
  const view = authed ? await getHoldingsView() : null;
  const tickers = authed ? loadWatchlist().groups.flatMap((group) => group.tickers.map((ticker) => ticker.ticker)) : [];
  const error = typeof params.e === "string" ? LOGIN_ERROR[params.e] : undefined;

  return (
    <div className="mx-auto min-h-dvh w-full max-w-lg">
      <header className="sticky top-0 z-20 border-b border-line bg-bg/95 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur">
        <div className="flex items-center gap-3 pb-2">
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold leading-none tracking-tight">保有</h1>
            <p className="mt-1 truncate text-[11px] text-muted">読み取り専用。中身は Render の HOLDINGS_JSON</p>
          </div>
          {authed && (
            <form action="/api/holdings/logout" method="post">
              <Button type="submit" variant="ghost" size="sm">
                閉じる
              </Button>
            </form>
          )}
          <ThemeToggle />
        </div>
        <SiteNav current="/holdings" />
      </header>
      <main className="space-y-4 px-4 py-4">
        {!configured ? (
          <p className="text-sm leading-relaxed text-muted">
            このサイトは公開なので、パスコードが無いあいだ保有は表示しない。Render の環境変数 {HOLDINGS_PASSCODE_ENV}（8文字以上）を設定すると開ける。
          </p>
        ) : !authed || !view ? (
          <form action="/api/holdings/login" method="post" className="space-y-2">
            <label htmlFor="passcode" className="block text-sm">
              パスコード
            </label>
            <input
              id="passcode"
              name="passcode"
              type="password"
              autoComplete="current-password"
              required
              className="h-11 w-full rounded-xl border border-line bg-elev px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-copper"
            />
            {error && <p className="text-xs text-rust">{error}</p>}
            <Button type="submit" className="w-full">
              開く
            </Button>
            <p className="text-[11px] text-muted">この端末に30日間ログインしたままになる。「閉じる」で消える。</p>
          </form>
        ) : (
          <>
            <PrecheckPanel tickers={tickers} />
            <AccountCard view={view} />
            <section>
              <h2 className="mb-2 text-sm font-medium">保有（見直しラインに近い順）</h2>
              <HoldingCards view={view} />
            </section>
            {view.warnings.length > 0 && (
              <ul className="space-y-1 text-[11px] text-rust">
                {view.warnings.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
            <p className="text-[11px] leading-relaxed text-muted">
              編集はできない。変えるときは Render の HOLDINGS_JSON を書き換える（再起動で反映）。ONDS は表示しない。
            </p>
          </>
        )}
      </main>
    </div>
  );
}
