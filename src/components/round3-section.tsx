import report from "../../data/backtest/round3.json";
import { formatPnl } from "@/lib/format";
import type { Round3Id, Round3Report, Round3Row, Round3Universe, Round3Window } from "@/lib/round3";
import type { Verdict } from "@/lib/round2";

const data = report as Round3Report;

const ROW: Record<Round3Id, string> = {
  base: "基準",
  R1: "R1 リスク$32",
  R2: "R2 半分利確",
  R3: "R3 5日で赤字撤退",
  R4: "R4 強さ",
  R5: "R5 手数料",
  R6: "R6 25%線",
  R7: "R7 R1からR5",
};

const UNIVERSE: Record<Round3Universe, string> = {
  core: "今の187",
  pit: "当時の500+400",
  adv: "売買代金上位200",
};

const WINDOW: Record<Round3Window, string> = {
  oos: "2022-10〜2024-10",
  in: "2024-10〜2026-10",
};

const VERDICT: Record<Verdict, string> = {
  pass: "合格",
  fail: "不合格",
  hold: "保留",
  "not-judged": "未判定",
};

function pct(value: number | null): string {
  return value == null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function money(value: number | null): string {
  return value == null ? "—" : formatPnl(value);
}

function rMultiple(value: number | null): string {
  return value == null ? "—" : `${value.toFixed(4)}R`;
}

function line(row: Round3Row): string {
  return `${ROW[row.id]} ${VERDICT[row.verdict]} ${formatPnl(row.totalUsd)}、${row.n}回、勝率 ${pct(row.winRate)}、平均勝ち ${money(row.avgWinUsd)}、平均負け ${money(row.avgLossUsd)}、最悪 ${money(row.worstUsd)}、最大DD ${formatPnl(row.mtmDdUsd)}、+$10の日 ${pct(row.daysMtm10Share)}、PF ${row.profitFactor ?? "—"}、期待値 ${rMultiple(row.expectancyR)}、投資割合 ${pct(row.investedFraction)}、保有日 ${pct(row.daysOpenShare)}、SPY換算 ${money(row.scaledSpyUsd)}。`;
}

/** Round-3 risk sizing on the E1 book. Analysis only. */
export function Round3Section() {
  const made = data.generatedAt.slice(0, 10);
  return (
    <section className="rounded-2xl border border-line bg-elev px-3 py-3 shadow-[var(--shadow)]">
      <h2 className="text-sm font-medium">リスク量の比較</h2>
      <p className="mt-1 text-[11px] leading-relaxed text-muted">
        事前登録 {data.rulesCommit.slice(0, 7)}。作成 {made}。基準は20日安値と$300–$450。R1は全銘柄を安値−1.5ATR、1株あたり$32、上限$450。決算は反応日の前5営業日だけ見送る。2024-10〜2026-10の今の187の基準は{formatPnl(1307.46)}、363回。判定は当時の500+400と売買代金上位200のR1からR7。100回未満は保留。合格のSPYは{formatPnl(1661.54)}と{formatPnl(982.45)}。SPY換算は投資割合を掛けた参考で、判定には使わない。
      </p>
      <p className="mt-2 text-[11px] leading-relaxed text-muted">
        {data.summary.map((row) => `${ROW[row.id]} ${VERDICT[row.verdict]}（500+400 ${VERDICT[row.pit]}、上位200 ${VERDICT[row.adv]}）`).join("。")}
        。
      </p>
      {(["core", "pit", "adv"] as const).map((universe) => (
        <div key={universe} className="mt-2">
          <p className="text-xs">{UNIVERSE[universe]}</p>
          {(["oos", "in"] as const).map((window) => (
            <div key={window} className="mt-1 border-t border-line pt-1 text-[11px] leading-relaxed text-muted">
              <p>{WINDOW[window]}</p>
              {data.rows
                .filter((row) => row.universe === universe && row.window === window)
                .map((row) => (
                  <p key={row.id} className="mt-1">
                    {line(row)}
                  </p>
                ))}
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}
