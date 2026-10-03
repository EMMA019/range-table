import report from "../../data/backtest/round6.json";
import { formatDollar, formatPnl } from "@/lib/format";
import type { Round3Universe, Round3Window } from "@/lib/round3";
import type { Round6Report, Round6Row } from "@/lib/round6";
import type { Verdict } from "@/lib/round2";

const data = report as Round6Report;

const UNIVERSE: Record<Round3Universe, string> = { core: "今の187", pit: "当時の500+400", adv: "売買代金上位200" };
const WINDOW: Record<Round3Window, string> = { oos: "2022-10〜2024-10", in: "2024-10〜2026-10" };
const VERDICT: Record<Verdict, string> = { pass: "合格", fail: "不合格", hold: "保留", "not-judged": "未判定" };

function pct(value: number | null): string {
  return value == null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function judged(universe: Round3Universe, window: Round3Window): Round6Row {
  const row = data.rows.find((item) => item.role === "book" && item.size === "lot" && item.universe === universe && item.window === window);
  if (!row) throw new Error(`行がない ${universe} ${window}`);
  return row;
}

function cell(row: Round6Row): string {
  const top = row.topTickers[0];
  const bottom = row.bottomTickers[0];
  const invested = row.investedFraction == null ? "—" : `${(row.investedFraction * 100).toFixed(1)}%`;
  const dropped = row.droppedSemi;
  const tail = top && bottom ? `上 ${top.ticker} ${formatPnl(top.pnlUsd)}、下 ${bottom.ticker} ${formatPnl(bottom.pnlUsd)}。` : "";
  const semi = dropped ? `外した半導体 ${dropped.n}件 ${formatPnl(dropped.pnlUsd)}。` : "";
  return `${WINDOW[row.window]} ${VERDICT[row.verdict]} ${formatPnl(row.totalUsd)}、${row.n}回、評価DD ${formatDollar(row.mtmDdUsd)}、勝率 ${pct(row.winRate)}、平均勝ち ${row.avgWinUsd == null ? "—" : formatPnl(row.avgWinUsd)}、平均負け ${row.avgLossUsd == null ? "—" : formatPnl(row.avgLossUsd)}、投資割合 ${invested}、SPY換算 ${row.scaledSpyUsd == null ? "—" : formatPnl(row.scaledSpyUsd)}、差 ${row.deltaUsd == null ? "—" : formatPnl(row.deltaUsd)}。${semi}${tail}`;
}

/** Round-6 book: round-4 F1i+F2 with the round-5 class removed after selection. */
export function Round6Section() {
  const made = data.generatedAt.slice(0, 10);
  const riskIn = data.rows.find((row) => row.role === "book" && row.size === "risk" && row.universe === "pit" && row.window === "in");
  return (
    <section className="rounded-2xl border border-line bg-elev px-3 py-3 shadow-[var(--shadow)]">
      <h2 className="text-sm font-medium">半導体を外す</h2>
      <p className="mt-1 text-[11px] leading-relaxed text-muted">
        事前登録 {data.rulesCommit.slice(0, 7)}。作成 {made}。基準はF1（赤字だけ見送り、不明は取る）とF2（箱の上は買わない）。選定のあとで半導体とその隣を外し、空いた枠は埋めない。判定は$300–$450のロット、当時の500+400と売買代金上位200の4窓。1%リスクは未判定。総合は{VERDICT[data.summary.verdict]}（500+400 {VERDICT[data.summary.pit]}、上位200 {VERDICT[data.summary.adv]}）。
      </p>
      {(["pit", "adv"] as const).map((universe) => (
        <div key={universe} className="mt-2 text-[11px] leading-relaxed text-muted">
          <p className="text-xs">{UNIVERSE[universe]}</p>
          {(["oos", "in"] as const).map((window) => (
            <p key={window}>{cell(judged(universe, window))}</p>
          ))}
        </div>
      ))}
      <p className="mt-2 text-[11px] leading-relaxed text-muted">
        半導体ありの基準は、当時の500+400が{formatPnl(135.08)}と{formatPnl(10.16)}、上位200が{formatPnl(879.27)}と{formatPnl(277.96)}。SPYは{formatPnl(1661.54)}と{formatPnl(982.45)}。差は外した約定の合計とは別。1%リスクの参考は未判定。当時の500+400の2024-10〜2026-10は{riskIn ? formatPnl(riskIn.totalUsd) : "—"}。現金不足の見送りはなし。
      </p>
    </section>
  );
}
