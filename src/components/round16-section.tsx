import report from "../../data/backtest/round16.json";
import { formatDollar, formatPnl } from "@/lib/format";
import { FLAVORS, LINE_PCTS, type LineFlavor, type Round16Report, type Round16Row } from "@/lib/round16";

const data = report as Round16Report;
const WINDOW: Record<Round16Row["window"], string> = { in: "2024-10〜2026-10", oos: "2022-10〜2024-10" };

function rate(value: number | null): string {
  return value == null ? "—" : `${(Math.round(value * 10000) / 100).toFixed(2)}%`;
}

function rowLine(row: Round16Row): string {
  return `${formatPnl(row.totalNet190Usd)}、${row.trades}回、勝率${rate(row.winRate)}、DD ${formatDollar(row.mtmDdUsd)}、最低 ${row.lowDate} ${formatDollar(row.lowUsd)}`;
}

function verdictJa(flavor: LineFlavor): string {
  const v = data.verdicts.find((item) => item.flavor === flavor);
  if (!v) return "—";
  if (v.kind === "confirmed") return `${v.pct}% 確認`;
  if (v.kind === "candidate") return `${v.pct}% 候補（2022-24未確認）`;
  if (v.kind === "no-meaningful-difference") return "差が小さく有意差なし";
  return `候補なし（${v.note}）`;
}

export function Round16Section() {
  const made = data.generatedAt.slice(0, 10);
  const unknowns = data.universe.f1Unknown;
  return (
    <section className="rounded-2xl border border-line bg-elev px-3 py-3 shadow-[var(--shadow)]">
      <h2 className="text-sm font-medium">20日箱の入り線（25 / 30 / 35%）</h2>
      <p className="mt-1 text-[11px] leading-relaxed text-muted">
        事前登録 {data.prereg.slice(0, 7)}。作成 {made}。ウォッチリストから金融グループ・太陽光/暗号/原子力/量子テーマ・F1赤字（不明は残す、SPCXは例外）を除き、ATR≥3%、SPY≥20日MA、決算回避、株のみ$3,200・紙ロット
        min(floor($30/(entry−stop)), floor($450/entry))。15%は参考行のみ。
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-muted">
        F1不明 {unknowns.length}銘柄: {unknowns.length ? unknowns.join(", ") : "なし"}。プール {data.universe.afterFilters}（ウォッチリスト {data.universe.watchlist}、金融除外 {data.universe.financialsDropped}、テーマ除外{" "}
        {data.universe.themeDropped}）。
      </p>
      {FLAVORS.map((flavor) => (
        <div key={flavor} className="mt-3">
          <h3 className="text-[11px] font-medium">{flavor === "touch" ? "タッチ" : "反発"} — 判定: {verdictJa(flavor)}</h3>
          <div className="mt-1 overflow-x-auto">
            <table className="w-full min-w-[36rem] text-left text-[11px]">
              <thead className="text-muted">
                <tr>
                  <th className="py-1 pr-2 font-medium">線 / 窓</th>
                  <th className="py-1 font-medium">$1.90純損益、回数、勝率、DD、最低</th>
                </tr>
              </thead>
              <tbody>
                {LINE_PCTS.flatMap((pct) =>
                  (["in", "oos"] as const).map((window) => {
                    const row = data.rows.find((item) => item.pct === pct && item.flavor === flavor && item.window === window);
                    if (!row) return null;
                    return (
                      <tr key={`${pct}-${window}`} className="border-t border-line align-top">
                        <td className="py-1.5 pr-2">
                          {pct}%{pct === 15 ? "（参考）" : ""}
                          <br />
                          <span className="text-muted">{WINDOW[window]}</span>
                        </td>
                        <td className="py-1.5 tabular-nums">{rowLine(row)}</td>
                      </tr>
                    );
                  }),
                )}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      <p className="mt-2 text-[11px] leading-relaxed text-muted">{data.summaryJa}</p>
    </section>
  );
}
