import report from "../../data/backtest/round5.json";
import { formatDollar, formatPnl } from "@/lib/format";
import type { Round3Universe, Round3Window } from "@/lib/round3";
import type { Round5Report, Round5Row, Round5Stop } from "@/lib/round5";
import type { Verdict } from "@/lib/round2";

const data = report as Round5Report;

const STOP: Record<Round5Stop, string> = { S0: "S0 安値", S1: "S1 安値−1ATR" };
const UNIVERSE: Record<Round3Universe, string> = { core: "今の187", pit: "当時の500+400", adv: "売買代金上位200" };
const WINDOW: Record<Round3Window, string> = { oos: "2022-10〜2024-10", in: "2024-10〜2026-10" };
const VERDICT: Record<Verdict, string> = { pass: "合格", fail: "不合格", hold: "保留", "not-judged": "未判定" };

function pct(value: number | null): string {
  return value == null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function judged(stop: Round5Stop, universe: Round3Universe, window: Round3Window): Round5Row {
  const row = data.rows.find((item) => item.role === "book" && item.stop === stop && item.cap === "cap450" && item.universe === universe && item.window === window);
  if (!row) throw new Error(`行がない ${stop} ${universe} ${window}`);
  return row;
}

function cell(row: Round5Row): string {
  const top = row.topTickers[0];
  const bottom = row.bottomTickers[0];
  const invested = row.investedFraction == null ? "—" : `${(row.investedFraction * 100).toFixed(1)}%`;
  const tail = top && bottom ? `上 ${top.ticker} ${formatPnl(top.pnlUsd)}、下 ${bottom.ticker} ${formatPnl(bottom.pnlUsd)}。` : "";
  return `${WINDOW[row.window]} ${VERDICT[row.verdict]} ${formatPnl(row.totalUsd)}、${row.n}回、評価DD ${formatDollar(row.mtmDdUsd)}、勝率 ${pct(row.winRate)}、平均勝ち ${row.avgWinUsd == null ? "—" : formatPnl(row.avgWinUsd)}、平均負け ${row.avgLossUsd == null ? "—" : formatPnl(row.avgLossUsd)}、投資割合 ${invested}、SPY換算 ${row.scaledSpyUsd == null ? "—" : formatPnl(row.scaledSpyUsd)}。${tail}`;
}

/** Round-5 semiconductor book. The pass rule is the locked round-3 rule. */
export function Round5Section() {
  const made = data.generatedAt.slice(0, 10);
  const unfunded = data.rows.filter((row) => row.unfunded > 0);
  return (
    <section className="rounded-2xl border border-line bg-elev px-3 py-3 shadow-[var(--shadow)]">
      <h2 className="text-sm font-medium">半導体とその隣</h2>
      <p className="mt-1 text-[11px] leading-relaxed text-muted">
        事前登録 {data.rulesCommit.slice(0, 7)}。作成 {made}。基準のF1（赤字だけ見送り、不明は取る）とF2（箱の上は買わない）。対象は半導体、装置、光とネットワーク、サーバー、電力と冷却。ATRは3%以上。株数はリスク$32。判定行は$450上限。落ちた枠は埋めない。判定の8窓はいずれも100回以上。
      </p>
      {data.summary.map((row) => (
        <div key={row.stop} className="mt-2 text-[11px] leading-relaxed text-muted">
          <p className="text-xs">
            {STOP[row.stop]} {VERDICT[row.verdict]}（500+400 {VERDICT[row.pit]}、上位200 {VERDICT[row.adv]}）
          </p>
          {(["pit", "adv"] as const).map((universe) => (
            <div key={universe} className="mt-1">
              <p>{UNIVERSE[universe]}</p>
              {(["oos", "in"] as const).map((window) => (
                <p key={window}>{cell(judged(row.stop, universe, window))}</p>
              ))}
            </div>
          ))}
        </div>
      ))}
      <p className="mt-2 text-[11px] leading-relaxed text-muted">
        比較の基準F1+F2は、当時の500+400が{formatPnl(135.08)}と{formatPnl(10.16)}、上位200が{formatPnl(879.27)}と{formatPnl(277.96)}。SPYは{formatPnl(1661.54)}と{formatPnl(982.45)}。上限なしの参考は未判定。現金不足で見送ったのは{unfunded.map((row) => `${UNIVERSE[row.universe]} ${WINDOW[row.window]} ${row.unfunded}件`).join("、") || "なし"}。
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-muted">
        2026-07-30〜2026-10-01の手仕舞いは40件、27勝13敗、手数料前{formatPnl(412)}、平均勝ち{formatPnl(18.7)}、平均負け{formatPnl(-7.2)}、最悪{formatPnl(-28)}（COHR）。上のセルとは別の集計。
      </p>
    </section>
  );
}
