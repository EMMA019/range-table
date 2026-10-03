import report from "../../data/backtest/round10.json";
import { formatDollar, formatPnl } from "@/lib/format";
import type { Round3Universe, Round3Window } from "@/lib/round3";
import type { Verdict } from "@/lib/round2";
import type { Round10Id, Round10Report, Round10Row, SkipCounts } from "@/lib/round10";

const data = report as Round10Report;

const NAME: Record<Round10Id, string> = { B: "基準 $300–450", R30: "R=$30", R35: "R=$35" };
const UNIVERSE: Record<Round3Universe, string> = { core: "今のリスト", pit: "当時の500+400", adv: "売買代金上位200" };
const WINDOW: Record<Round3Window, string> = { oos: "2022-10〜2024-10", in: "2024-10〜2026-10" };
const VERDICT: Record<Verdict, string> = { pass: "合格", fail: "不合格", hold: "保留", "not-judged": "未判定" };
const IDS: Round10Id[] = ["B", "R30", "R35"];

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function money(value: number | null): string {
  return value == null ? "—" : formatPnl(value);
}

function rate(value: number | null): string {
  return value == null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function sizes(values: number[] | null): string {
  if (!values) return "—";
  if (!values.length) return "0";
  return `${values.length}（${values.map((value) => formatPnl(value)).join("、")}）`;
}

function skips(row: Round10Row): string {
  const item: SkipCounts = row.skipped;
  if (row.id === "B") return `予算 ${item.budget}、枠 ${item.slot}、現金 ${item.cash}、半導体 ${item.semi}`;
  return `幅 ${item.wide}、距離 ${item.flat}、上限 ${item.cap}、枠 ${item.slot}、現金 ${item.cash}、半導体 ${item.semi}`;
}

function peak(row: Round10Row): string {
  const when = row.peakDate === "start" ? "開始" : row.peakDate;
  const penny = row.pathDdUsd === row.mtmDdUsd ? "" : `、日足の差 ${formatDollar(row.pathDdUsd)}`;
  return `${formatDollar(row.mtmDdUsd)}。山 ${when} ${formatDollar(row.peakUsd)}、谷 ${row.troughDate} ${formatDollar(row.troughUsd)}${penny}`;
}

function rowsFor(universes: readonly Round3Universe[]): Round10Row[] {
  return universes.flatMap((universe) =>
    (["oos", "in"] as const).flatMap((window) =>
      IDS.map((id) => {
        const row = data.rows.find((item) => item.id === id && item.universe === universe && item.window === window);
        if (!row) throw new Error(`行がない ${id} ${universe} ${window}`);
        return row;
      }),
    ),
  );
}

function Grid({ universes, title }: { universes: readonly Round3Universe[]; title: string }) {
  const head = ["本", "ユニバース", "期間", "$1.90後", "エンジン", "回数", "勝率", "平均勝ち", "平均負け", "最大損失", "ギャップでR超", "その他のR超", "評価DD", "最安", "使用", "見送り", "判定"];
  return (
    <div className="mt-2">
      <p className="text-xs">{title}</p>
      <div className="overflow-x-auto">
        <table className="mt-1 w-full min-w-[88rem] text-[10px]">
          <thead className="text-muted">
            <tr>
              {head.map((label) => (
                <th key={label} className="pb-1 pr-2 text-right font-normal first:text-left">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rowsFor(universes).map((row) => (
              <tr key={`${row.id}-${row.universe}-${row.window}`} className="border-t border-line align-top">
                <th scope="row" className="py-1 pr-2 text-left font-normal">
                  {NAME[row.id]}
                </th>
                <td className="py-1 pr-2 text-right">{UNIVERSE[row.universe]}</td>
                <td className="py-1 pr-2 text-right">{WINDOW[row.window]}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{formatPnl(row.totalNet190Usd)}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{formatPnl(row.totalUsd)}</td>
                <td className="py-1 pr-2 text-right tabular-nums">
                  {row.n}
                  <span className="block text-muted">
                    {row.stockN}+{row.etfN}
                  </span>
                </td>
                <td className="py-1 pr-2 text-right tabular-nums">{rate(row.winRate)}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{money(row.avgWinUsd)}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{money(row.avgLossUsd)}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{money(row.worstUsd)}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{sizes(row.gapUsd)}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{sizes(row.otherUsd)}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{peak(row)}</td>
                <td className="py-1 pr-2 text-right tabular-nums">
                  {row.lowDate} {formatDollar(row.lowUsd)}
                  <span className="block text-muted">{formatPnl(row.lowVsStartUsd)}</span>
                </td>
                <td className="py-1 pr-2 text-right tabular-nums">{pct(row.deployed)}</td>
                <td className="py-1 pr-2 text-right">{skips(row)}</td>
                <td className="py-1 text-right">{VERDICT[row.verdict]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Round-10 stop-distance sizing. Judged cells are PIT and ADV. The current list is reference. */
export function Round10Section() {
  const made = data.generatedAt.slice(0, 10);
  const r30 = data.summary.find((row) => row.id === "R30");
  const r35 = data.summary.find((row) => row.id === "R35");
  return (
    <section className="rounded-2xl border border-line bg-elev px-3 py-3 shadow-[var(--shadow)]">
      <h2 className="text-sm font-medium">損切り幅の株数</h2>
      <p className="mt-1 text-[11px] leading-relaxed text-muted">
        事前登録 {data.rulesCommit.slice(0, 7)}。作成 {made}。本は出口Cと余資のSOXX（E30、箱の出口、20日、フィルタなし）。変えるのは株の株数だけ。株数は floor(R÷(入りの始値−シグナルの20日安値)) で、1銘柄$500まで。1株に満たなければ見送り。入りが20日安値以下は別に数える。Rは$30と$35。SOXXは従来の1%のまま。基準は$300–$450で、公開の6セルと一致した。$1.90後は売却の$0.70を戻してから1ポジションにつき$1.90を引いた合計で、判定には使わない。判定はエンジンの損益で、500+400と上位200の4セル。今のリストは参考。R=$30は{r30 ? VERDICT[r30.verdict] : "—"}（500+400 {r30 ? VERDICT[r30.pit] : "—"}、上位200 {r30 ? VERDICT[r30.adv] : "—"}）、R=$35は{r35 ? VERDICT[r35.verdict] : "—"}（500+400 {r35 ? VERDICT[r35.pit] : "—"}、上位200 {r35 ? VERDICT[r35.adv] : "—"}）。狭い損切りほど株数が増え、1株でRを超える幅は買わない。見送った広い幅に大きな勝ちが含まれることがある。2通り×4セルは事前に固定し、他のRは試していない。
      </p>
      <Grid universes={["pit", "adv"]} title="判定セル" />
      <Grid universes={["core"]} title="参考・今のリスト" />
    </section>
  );
}
