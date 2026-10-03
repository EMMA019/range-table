import report from "../../data/backtest/round4.json";
import { formatPnl } from "@/lib/format";
import type { Round4Book, Round4Filter, Round4Report, Round4Row } from "@/lib/round4";
import type { Round3Universe, Round3Window } from "@/lib/round3";
import type { Verdict } from "@/lib/round2";

const data = report as Round4Report;

const BOOK: Record<Round4Book, string> = { base: "基準", R1: "R1" };
const FILTER: Record<Round4Filter, string> = {
  none: "そのまま",
  F1x: "F1 未知は見送り",
  F1i: "F1 未知も取る",
  F2: "F2 箱の上は買わない",
  F1xF2: "F1+F2 未知は見送り",
  F1iF2: "F1+F2 未知も取る",
};
const UNIVERSE: Record<Round3Universe, string> = { core: "今の187", pit: "当時の500+400", adv: "売買代金上位200" };
const WINDOW: Record<Round3Window, string> = { oos: "2022-10〜2024-10", in: "2024-10〜2026-10" };
const VERDICT: Record<Verdict, string> = { pass: "合格", fail: "不合格", hold: "保留", "not-judged": "未判定" };

function line(row: Round4Row): string {
  const flow = row.filter === "none" ? "" : ` 除外 ${row.excludedOriginal.n}回 ${formatPnl(row.excludedOriginal.pnlUsd)}、新規 ${row.newlyAdmitted.n}回 ${formatPnl(row.newlyAdmitted.pnlUsd)}。`;
  return `${FILTER[row.filter]} ${VERDICT[row.verdict]} ${formatPnl(row.totalUsd)}、${row.n}回、比率 ${row.ratio ?? "—"}。${flow}`;
}

/** Round-4 filter test. The pass rule is the locked round-3 rule. */
export function Round4Section() {
  const made = data.generatedAt.slice(0, 10);
  return (
    <section className="rounded-2xl border border-line bg-elev px-3 py-3 shadow-[var(--shadow)]">
      <h2 className="text-sm font-medium">赤字と箱の上</h2>
      <p className="mt-1 text-[11px] leading-relaxed text-muted">
        事前登録 {data.rulesCommit.slice(0, 7)}。作成 {made}。F1は提出日がシグナル日以前のGAAP四半期利益の合計がマイナスなら見送る。未知は見送りと、未知も取る、の2通り。F2は始値が20日高値を上回る買いを見送る。判定は当時の500+400と売買代金上位200。100回未満は保留。今の187は未判定。
      </p>
      <div className="mt-2 text-[11px] leading-relaxed text-muted">
        {data.summary
          .filter((row) => row.filter !== "none")
          .map((row) => (
            <p key={`${row.book}-${row.filter}`}>
              {BOOK[row.book]} {FILTER[row.filter]} {VERDICT[row.verdict]}（500+400 {VERDICT[row.pit]}、上位200 {VERDICT[row.adv]}）
            </p>
          ))}
      </div>
      {(["pit", "adv", "core"] as const).map((universe) => (
        <div key={universe} className="mt-2">
          <p className="text-xs">{UNIVERSE[universe]}</p>
          {(["oos", "in"] as const).map((window) => {
            const rows = data.rows.filter((row) => row.universe === universe && row.window === window);
            const baseline = rows.find((row) => row.book === "base" && row.filter === "none");
            return (
              <div key={window} className="mt-1 border-t border-line pt-1 text-[11px] leading-relaxed text-muted">
                <p>
                  {WINDOW[window]}。基準の未知 {baseline?.unknownBaseline.n ?? 0}回 {formatPnl(baseline?.unknownBaseline.pnlUsd ?? 0)}。
                </p>
                {rows.map((row) => (
                  <p key={`${row.book}-${row.filter}`} className="mt-1">
                    {BOOK[row.book]} {line(row)}
                  </p>
                ))}
              </div>
            );
          })}
        </div>
      ))}
    </section>
  );
}
