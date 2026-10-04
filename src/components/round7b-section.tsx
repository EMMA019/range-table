import report from "../../data/backtest/round7b_reference.json";
import { formatDollar, formatPnl } from "@/lib/format";
import type { Round3Window } from "@/lib/round3";
import { EXIT_REASONS, type Round7Reason } from "@/lib/round7";
import type { Round7bReport, Round7bRow, Round7bRowId, Round7bThemeTotal } from "@/lib/round7b";

const data = report as Round7bReport;

const ROW: Record<Round7bRowId, string> = {
  keepC: "KEEP+SPCX、出口C",
  keepTransitionC: "KEEP+SPCX+転換、出口C",
  currentC: "今のリスト、出口C",
  currentA: "今のリスト、出口A",
};
const WINDOW: Record<Round3Window, string> = { oos: "2022-10〜2024-10", in: "2024-10〜2026-10" };
const REASON: Record<Round7Reason, string> = {
  target: "利確",
  stop: "損切り",
  breakeven: "建値",
  priorLow: "前日安値",
  timeout: "期限",
  window: "窓の終わり",
};
const THEME: Record<Round7bThemeTotal["theme"], string> = {
  nuclear: "原子力",
  lossMaking: "赤字の事業",
  transition: "転換",
  other: "その他",
};

function pct(value: number | null): string {
  return value == null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function money(value: number | null): string {
  return value == null ? "—" : formatPnl(value);
}

function versusN(row: Round7bRow): string {
  if (row.nRequired == null) return `${row.n}回。平均が正ではないのでNはない`;
  const relation = row.n < row.nRequired ? "Nより少ない" : "N以上";
  return `${row.n}回、N ${row.nRequired}、回数は${relation}`;
}

function exits(row: Round7bRow): string {
  return EXIT_REASONS.filter((reason) => row.exits[reason].n > 0)
    .map((reason) => `${REASON[reason]} ${row.exits[reason].n}件 ${formatPnl(row.exits[reason].pnlUsd)}`)
    .join("、");
}

function cell(row: Round7bRow): string {
  const invested = row.investedFraction == null ? "—" : `${(row.investedFraction * 100).toFixed(1)}%`;
  return `${WINDOW[row.window]} ${formatPnl(row.totalUsd)}、${versusN(row)}、評価DD ${formatDollar(row.mtmDdUsd)}、勝率 ${pct(row.winRate)}、平均勝ち ${money(row.avgWinUsd)}、平均負け ${money(row.avgLossUsd)}、1件平均 ${money(row.meanUsd)}、$1.90後 ${money(row.meanNet190Usd)}、保有 ${row.avgHold ?? "—"}営業日。${exits(row)}。投資割合 ${invested}、SPY換算 ${money(row.scaledSpyUsd)}、損益/DD ${row.ratio ?? "—"}（SPY ${row.spyRatio}）。`;
}

function themeLine(exit: "A" | "C", theme: Round7bThemeTotal["theme"]): string {
  const cells = data.themeTotals.filter((item) => item.exit === exit && item.theme === theme && item.universe === "core");
  const n = cells.reduce((sum, item) => sum + item.n, 0);
  const wins = cells.reduce((sum, item) => sum + item.wins, 0);
  const losses = cells.reduce((sum, item) => sum + item.losses, 0);
  const total = Math.round(cells.reduce((sum, item) => sum + item.totalUsd, 0) * 100) / 100;
  return `${THEME[theme]} ${formatPnl(total)}、${n}回、${wins}勝${losses}敗`;
}

/** Hindsight reference list. No pass or fail. */
export function Round7bSection() {
  const made = data.generatedAt.slice(0, 10);
  return (
    <section className="rounded-2xl border border-line bg-elev px-3 py-3 shadow-[var(--shadow)]">
      <h2 className="text-sm font-medium">参考（後知恵あり）</h2>
      <p className="mt-1 text-[11px] leading-relaxed text-muted">
        事前登録 {data.rulesCommit.slice(0, 7)}。作成 {made}。2026-10の知識で選んだリストなので後知恵がある。判定は付けない。基準はF1（赤字だけ見送り、不明は取る）とF2（箱の上は買わない）。出口Cは箱の高値で全部売り、出口Aは入りの始値にシグナルのATRを1つ足した値段で全部売る。損切りは20日安値、期限は20営業日、株数は$300–$450。対象は今のリストだけ。SPYは{formatPnl(data.spy.oos.totalUsd)}（評価DD {formatDollar(data.spy.oos.mtmDdUsd)}、比 {data.spy.oos.ratio}）と{formatPnl(data.spy.in.totalUsd)}（評価DD {formatDollar(data.spy.in.mtmDdUsd)}、比 {data.spy.in.ratio}）。
      </p>
      {(["keepC", "keepTransitionC", "currentC", "currentA"] as const).map((id) => (
        <div key={id} className="mt-2 text-[11px] leading-relaxed text-muted">
          <p className="text-xs">
            {ROW[id]}（{data.rows.find((row) => row.id === id)?.members ?? "—"}銘柄）
          </p>
          {(["oos", "in"] as const).map((window) => {
            const row = data.rows.find((item) => item.id === id && item.window === window);
            return <p key={window}>{row ? cell(row) : "—"}</p>;
          })}
        </div>
      ))}
      <p className="mt-2 text-[11px] leading-relaxed text-muted">
        外す銘柄と転換銘柄を、今のリストの両窓で足した。出口Aは{themeLine("A", "nuclear")}、{themeLine("A", "lossMaking")}、{themeLine("A", "transition")}。出口Cは{themeLine("C", "nuclear")}、{themeLine("C", "lossMaking")}、{themeLine("C", "transition")}。当時の500+400と売買代金上位200の内訳は同じファイルにある。
      </p>
    </section>
  );
}
