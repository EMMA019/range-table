import report from "../../data/backtest/round7.json";
import { formatDollar, formatPnl } from "@/lib/format";
import type { Round3Universe, Round3Window } from "@/lib/round3";
import { EXIT_REASONS, type Round7Id, type Round7Reason, type Round7Report, type Round7Row } from "@/lib/round7";
import type { Verdict } from "@/lib/round2";

const data = report as Round7Report;

const NAME: Record<Round7Id, string> = {
  Locked: "ロック",
  A: "A +1ATR全部",
  B: "B 半分と残り",
  C: "C 箱の高値",
  D: "D 前日安値",
};
const UNIVERSE: Record<Round3Universe, string> = { core: "今の187", pit: "当時の500+400", adv: "売買代金上位200" };
const WINDOW: Record<Round3Window, string> = { oos: "2022-10〜2024-10", in: "2024-10〜2026-10" };
const VERDICT: Record<Verdict, string> = { pass: "合格", fail: "不合格", hold: "保留", "not-judged": "未判定" };
const REASON: Record<Round7Reason, string> = {
  target: "利確",
  stop: "損切り",
  breakeven: "建値",
  priorLow: "前日安値",
  timeout: "期限",
  window: "窓の終わり",
};

function pct(value: number | null): string {
  return value == null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function money(value: number | null): string {
  return value == null ? "—" : formatPnl(value);
}

function rowOf(id: Round7Id, universe: Round3Universe, window: Round3Window): Round7Row {
  const row = data.rows.find((item) => item.id === id && item.universe === universe && item.window === window);
  if (!row) throw new Error(`行がない ${id} ${universe} ${window}`);
  return row;
}

function exits(row: Round7Row): string {
  return EXIT_REASONS.filter((reason) => row.exits[reason].n > 0)
    .map((reason) => `${REASON[reason]} ${row.exits[reason].n}件 ${formatPnl(row.exits[reason].pnlUsd)}`)
    .join("、");
}

function cell(row: Round7Row): string {
  const invested = row.investedFraction == null ? "—" : `${(row.investedFraction * 100).toFixed(1)}%`;
  return `${WINDOW[row.window]} ${VERDICT[row.verdict]} ${formatPnl(row.totalUsd)}、${row.n}回、評価DD ${formatDollar(row.mtmDdUsd)}、勝率 ${pct(row.winRate)}、平均勝ち ${money(row.avgWinUsd)}、平均負け ${money(row.avgLossUsd)}、1件平均 ${money(row.meanUsd)}、$1.90後 ${money(row.meanNet190Usd)}、保有 ${row.avgHold ?? "—"}営業日。${exits(row)}。投資割合 ${invested}。`;
}

/** Round-7 take-profit comparison. The pass rule is the locked round-3 rule. */
export function Round7Section() {
  const made = data.generatedAt.slice(0, 10);
  return (
    <section className="rounded-2xl border border-line bg-elev px-3 py-3 shadow-[var(--shadow)]">
      <h2 className="text-sm font-medium">利確の比べ</h2>
      <p className="mt-1 text-[11px] leading-relaxed text-muted">
        事前登録 {data.rulesCommit.slice(0, 7)}。作成 {made}。基準はF1（赤字だけ見送り、不明は取る）とF2（箱の上は買わない）。損切りは20日安値、期限は20営業日、株数は$300–$450。ロックされた利確は、入りの始値にシグナルのATRを1つ足した値段で全部売ること。同じ足で高値がそこへ届き、終値が損切りを割ると、ロックは利確を先に取る。Aはその足では損切りを先に取る。保存した6セルでAはロックと一致した。$1.90後は、エンジンの売却手数料を戻してから1往復$1.90を引いた平均。今の187は未判定。
      </p>
      {data.summary.map((item) => (
        <div key={item.id} className="mt-2 text-[11px] leading-relaxed text-muted">
          <p className="text-xs">
            {NAME[item.id]} {VERDICT[item.verdict]}（500+400 {VERDICT[item.pit]}、上位200 {VERDICT[item.adv]}）
          </p>
          {(["pit", "adv"] as const).map((universe) => (
            <div key={universe} className="mt-1">
              <p>{UNIVERSE[universe]}</p>
              {(["oos", "in"] as const).map((window) => (
                <p key={window}>{cell(rowOf(item.id, universe, window))}</p>
              ))}
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}
