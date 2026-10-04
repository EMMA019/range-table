import type { Metadata } from "next";
import { SiteNav } from "@/components/site-nav";
import { BiasSection } from "@/components/bias-section";
import { Round2Section } from "@/components/round2-section";
import { DecomposeSection } from "@/components/decompose-section";
import { Round4Section } from "@/components/round4-section";
import { Round5Section } from "@/components/round5-section";
import { Round6Section } from "@/components/round6-section";
import { Round7Section } from "@/components/round7-section";
import { Round7bSection } from "@/components/round7b-section";
import { Round8Section } from "@/components/round8-section";
import { Round9Section } from "@/components/round9-section";
import { Round10Section } from "@/components/round10-section";
import { Round11Section } from "@/components/round11-section";
import { Round12Section } from "@/components/round12-section";
import { Round15Section } from "@/components/round15-section";
import { Round3Section } from "@/components/round3-section";
import { StopsSection } from "@/components/stops-section";
import { FollowUpSection } from "@/components/followup-section";
import { StudySection } from "@/components/study-section";
import { ThemeToggle } from "@/components/theme-toggle";
import type { Stats } from "@/lib/backtest";
import { BACKTEST } from "@/lib/backtest-view";
import { formatPnl } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "過去検証",
};

const VARIANT_LABEL: Record<string, string> = {
  main: "基本（翌日始値買い・終値で損切り）",
  in_ok: "IN OK帯（15〜25%）だけ",
  signal_close_entry: "シグナル日の終値で買う",
  next_open_stop: "損切りを翌日始値で",
};

function pct(n: number | null): string {
  return n == null ? "—" : `${(n * 100).toFixed(1)}%`;
}

function StatsRow({ label, stats, strong }: { label: string; stats: Stats; strong?: boolean }) {
  const exp = stats.expectancyUsd ?? 0;
  return (
    <tr className={cn("border-t border-line", strong && "font-medium")}>
      <th scope="row" className="py-2 pr-2 text-left font-normal">
        {label}
      </th>
      <td className="py-2 text-right tabular-nums">{stats.n}</td>
      <td className="py-2 text-right tabular-nums">{pct(stats.winRate)}</td>
      <td className={cn("py-2 text-right tabular-nums", exp > 0 ? "text-sage" : exp < 0 ? "text-rust" : "")}>
        {stats.expectancyUsd == null ? "—" : formatPnl(stats.expectancyUsd)}
        <span className="block text-[10px] text-muted">{stats.expectancyAtr == null ? "" : `${stats.expectancyAtr.toFixed(2)} ATR`}</span>
      </td>
      <td className="py-2 text-right tabular-nums">{stats.profitFactor?.toFixed(2) ?? "—"}</td>
      <td className="py-2 text-right tabular-nums">{stats.maxConsecLosses}</td>
    </tr>
  );
}

function StatsTable({ caption, rows }: { caption: string; rows: Array<{ label: string; stats: Stats; strong?: boolean }> }) {
  return (
    <section className="rounded-2xl border border-line bg-elev px-3 py-3 shadow-[var(--shadow)]">
      <h2 className="text-sm font-medium">{caption}</h2>
      <table className="mt-2 w-full text-xs">
        <thead className="text-[10px] text-muted">
          <tr>
            <th className="pb-1 text-left font-normal" />
            <th className="pb-1 text-right font-normal">回数</th>
            <th className="pb-1 text-right font-normal">勝率</th>
            <th className="pb-1 text-right font-normal">期待値</th>
            <th className="pb-1 text-right font-normal">PF</th>
            <th className="pb-1 text-right font-normal">最大連敗</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <StatsRow key={row.label} {...row} />
          ))}
        </tbody>
      </table>
    </section>
  );
}

export default function BacktestPage() {
  const s = BACKTEST;
  const thresholdLabel = (min: number | null) => (min == null ? "全部" : `ATR ${min}%以上`);
  const tickers = [...s.byTicker].sort((a, b) => b.totalUsd - a.totalUsd);
  return (
    <div className="mx-auto min-h-dvh w-full max-w-lg">
      <header className="sticky top-0 z-20 border-b border-line bg-bg/95 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur">
        <div className="flex items-center gap-3 pb-2">
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold leading-none tracking-tight">過去検証</h1>
            <p className="mt-1 truncate text-[11px] text-muted">
              {s.period.from} 〜 {s.period.to} · {s.universe.withData}銘柄 · 作成 {s.generatedAt.slice(0, 10)}
            </p>
          </div>
          <ThemeToggle />
        </div>
        <SiteNav current="/backtest" />
      </header>
      <main className="space-y-4 px-4 py-4">
        <ul className="space-y-1 text-[11px] leading-relaxed text-muted">
          <li>シグナル: {s.rules.signal}</li>
          <li>買い: {s.rules.entry}</li>
          <li>利確: {s.rules.target}</li>
          <li>損切り: {s.rules.stop}</li>
          <li>
            期限: {s.rules.timeout} · 株数: {s.rules.sizing} · 手数料: {s.rules.fees}
          </li>
        </ul>

        <StatsTable
          caption="反発して15%ライン以上（シグナル日のATR%で絞る）"
          rows={s.byAtrThreshold.map((row) => ({ label: thresholdLabel(row.minAtrPct), stats: row.rebound15, strong: row.minAtrPct === 3 }))}
        />
        <StatsTable
          caption="IN OK帯（15〜25%）だけ"
          rows={s.byAtrThreshold.map((row) => ({ label: thresholdLabel(row.minAtrPct), stats: row.in_ok, strong: row.minAtrPct === 3 }))}
        />
        <StatsTable caption="ATR%の帯ごと（基本ルール）" rows={s.byAtrBand.map((row) => ({ label: row.band, stats: row }))} />
        <StatsTable
          caption="約定の変え方"
          rows={Object.entries(s.variants).map(([key, stats]) => ({ label: VARIANT_LABEL[key] ?? key, stats }))}
        />

        <p className="text-[11px] leading-relaxed text-muted">
          期待値は1回あたりの手数料込み損益（$10株数）。PFは勝ちの合計÷負けの合計。最大連敗は全銘柄を決済日順に並べたときの連続負け数で、相場全体が崩れた日に損切りが重なると大きくなる。
        </p>

        <details className="rounded-2xl border border-line bg-elev px-3 py-3">
          <summary className="min-h-11 cursor-pointer text-sm font-medium leading-[2.75rem]">銘柄別（合計の多い順・{tickers.length}銘柄）</summary>
          <table className="mt-2 w-full text-xs">
            <thead className="text-[10px] text-muted">
              <tr>
                <th className="pb-1 text-left font-normal">銘柄</th>
                <th className="pb-1 text-right font-normal">回数</th>
                <th className="pb-1 text-right font-normal">勝率</th>
                <th className="pb-1 text-right font-normal">期待値</th>
                <th className="pb-1 text-right font-normal">合計</th>
              </tr>
            </thead>
            <tbody>
              {tickers.map((row) => (
                <tr key={row.ticker} className="border-t border-line">
                  <td className="py-1.5">{row.ticker}</td>
                  <td className="py-1.5 text-right tabular-nums">{row.n}</td>
                  <td className="py-1.5 text-right tabular-nums">{pct(row.winRate)}</td>
                  <td className="py-1.5 text-right tabular-nums">{row.expectancyUsd == null ? "—" : formatPnl(row.expectancyUsd)}</td>
                  <td className={cn("py-1.5 text-right tabular-nums", row.totalUsd > 0 ? "text-sage" : row.totalUsd < 0 ? "text-rust" : "")}>
                    {formatPnl(row.totalUsd)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>

        <StudySection />
        <FollowUpSection />
        <BiasSection />
        <Round2Section />
        <StopsSection />
        <Round3Section />
        <DecomposeSection />
        <Round4Section />
        <Round5Section />
        <Round6Section />
        <Round7Section />
        <Round7bSection />
        <Round8Section />
        <Round9Section />
        <Round10Section />
        <Round11Section />
        <Round12Section />
        <Round15Section />

        <section>
          <h2 className="mb-1 text-sm font-medium">分かっている偏り</h2>
          <ul className="list-disc space-y-1 pl-4 text-[11px] leading-relaxed text-muted">
            {s.biases.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-muted">過去の成績は将来を約束しない。`npm run backtest` で作り直してコミットする。</p>
        </section>
      </main>
    </div>
  );
}
