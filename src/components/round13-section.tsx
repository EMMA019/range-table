import report from "../../data/backtest/round13.json";
import { formatDollar, formatPnl } from "@/lib/format";
import type { Round3Universe, Round3Window } from "@/lib/round3";
import type { Verdict } from "@/lib/round2";
import { FOCUS, ROUND13_IDS, ROUND13_PREREG, type FlowTicker, type Round13Id, type Round13Report, type Round13Row } from "@/lib/round13";

const data = report as Round13Report;
if (data.rulesCommit !== ROUND13_PREREG) throw new Error("事前登録のハッシュが違う");

const NAME: Record<Round13Id, string> = { B: "基準", A8: "8%", A7: "7%", A10: "10%" };
const UNIVERSE: Record<Round3Universe, string> = { core: "今のリスト", pit: "当時の500+400", adv: "売買代金上位200" };
const WINDOW: Record<Round3Window, string> = { oos: "2022-10〜2024-10", in: "2024-10〜2026-10" };
const VERDICT: Record<Verdict, string> = { pass: "合格", fail: "不合格", hold: "保留", "not-judged": "未判定" };

function cell(id: Round13Id, universe: Round3Universe, window: Round3Window): Round13Row {
  const row = data.rows.find((item) => item.id === id && item.universe === universe && item.window === window);
  if (!row) throw new Error(`行がない ${id} ${universe} ${window}`);
  return row;
}

function rowsFor(universes: readonly Round3Universe[]): Round13Row[] {
  return universes.flatMap((universe) => (["oos", "in"] as const).flatMap((window) => ROUND13_IDS.map((id) => cell(id, universe, window))));
}

function peak(row: Round13Row): string {
  const when = row.peakDate === "start" ? "開始" : row.peakDate;
  const penny = row.pathDdUsd === row.mtmDdUsd ? "" : `、日足の差 ${formatDollar(row.pathDdUsd)}`;
  return `${formatDollar(row.mtmDdUsd)}。山 ${when} ${formatDollar(row.peakUsd)}、谷 ${row.troughDate} ${formatDollar(row.troughUsd)}${penny}`;
}

function side(n: number, usd: number): string {
  return `${n}（${formatPnl(usd)}）`;
}

function tickerLine(row: Round13Row, ticker: string): string {
  const item = row.removedTickers.find((entry) => entry.ticker === ticker);
  if (!item || item.n === 0) return "0";
  return `勝ち${item.wins}（${formatPnl(item.winsUsd)}）、負け${item.losses}（${formatPnl(item.lossesUsd)}）`;
}

type FlowRow = { row: Round13Row; kind: "外した" | "代わり"; ticker: FlowTicker };

function flows(universes: readonly Round3Universe[]): FlowRow[] {
  const out: FlowRow[] = [];
  for (const universe of universes) {
    for (const window of ["oos", "in"] as const) {
      for (const id of ROUND13_IDS) {
        if (id === "B") continue;
        const row = cell(id, universe, window);
        for (const ticker of row.removedTickers) if (ticker.n > 0) out.push({ row, kind: "外した", ticker });
        for (const ticker of row.replacedTickers) if (ticker.n > 0) out.push({ row, kind: "代わり", ticker });
      }
    }
  }
  return out;
}

function Grid({ universes, title }: { universes: readonly Round3Universe[]; title: string }) {
  const head = ["本", "ユニバース", "期間", "$1.90後", "エンジン", "回数", "株の−$60", "評価DD", "最安", "失った勝ち", "外した負け", "代わり", "見送り", "判定"];
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
                <td className="py-1 pr-2 text-right tabular-nums">{side(row.stockLargeN, row.stockLargeUsd)}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{peak(row)}</td>
                <td className="py-1 pr-2 text-right tabular-nums">
                  {row.lowDate} {formatDollar(row.lowUsd)}
                </td>
                <td className="py-1 pr-2 text-right tabular-nums">{side(row.removed.wins, row.removed.winsUsd)}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{side(row.removed.losses, row.removed.lossesUsd)}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{side(row.replaced.n, row.replaced.pnlUsd)}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{row.skipped.atr}</td>
                <td className="py-1 text-right">{VERDICT[row.verdict]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Flows({ universes, title }: { universes: readonly Round3Universe[]; title: string }) {
  const head = ["ユニバース", "期間", "本", "向き", "銘柄", "勝ち", "勝ち合計", "負け", "負け合計"];
  return (
    <div className="mt-2">
      <p className="text-xs">{title}</p>
      <div className="overflow-x-auto">
        <table className="mt-1 w-full min-w-[42rem] text-[10px]">
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
            {flows(universes).map(({ row, kind, ticker }) => (
              <tr key={`${row.id}-${row.universe}-${row.window}-${kind}-${ticker.ticker}`} className="border-t border-line">
                <th scope="row" className="py-1 pr-2 text-left font-normal">
                  {UNIVERSE[row.universe]}
                </th>
                <td className="py-1 pr-2 text-right">{WINDOW[row.window]}</td>
                <td className="py-1 pr-2 text-right">{NAME[row.id]}</td>
                <td className="py-1 pr-2 text-right">{kind}</td>
                <td className="py-1 pr-2 text-right">{ticker.ticker}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{ticker.wins}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{formatPnl(ticker.winsUsd)}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{ticker.losses}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{formatPnl(ticker.lossesUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Round-13 ATR cap. Only the 8% row on PIT and ADV is judged. 7% and 10% are reference. */
export function Round13Section() {
  const made = data.generatedAt.slice(0, 10);
  const judged = data.summary[0];
  const advIn = cell("A8", "adv", "in");
  const pitIn = cell("A8", "pit", "in");
  const names = FOCUS.map((ticker) => `${ticker}は上位200の2024-10窓で${tickerLine(advIn, ticker)}`).join("。");
  return (
    <section className="rounded-2xl border border-line bg-elev px-3 py-3 shadow-[var(--shadow)]">
      <h2 className="text-sm font-medium">ATR上限</h2>
      <p className="mt-1 text-[11px] leading-relaxed text-muted">
        事前登録 {data.rulesCommit.slice(0, 7)}。作成 {made}。8%はラウンド10の基準の約定から後で見つけた閾値で、同じ窓の中の後知恵。この行は確認としては弱い。7%と10%は隣の参考で、判定しない。本は出口Cと余資のSOXX（E30、箱の出口、20日）。株のロットは$300–$450のまま。見送りはシグナル日のATR14÷終値が8%、7%、10%を超えるとき。等しい幅は残す。ATRは基準の3%下限と同じ、小数4桁の単純平均。空いた現金と枠は後の株とSOXXが使う。基準は上限なしで、公開の6セルと一致した。$1.90後は売却の$0.70を戻してから1ポジションにつき$1.90を引いた合計で、判定には使わない。判定はエンジンの損益で、8%の500+400と上位200の4セル。8%は{judged ? VERDICT[judged.verdict] : "—"}（500+400 {judged ? VERDICT[judged.pit] : "—"}、上位200 {judged ? VERDICT[judged.adv] : "—"}）。必要な回数に届かないので保留で、不合格のセルは無い。500+400の2024-10窓はエンジン{formatPnl(pitIn.totalUsd)}で$1.90後は{formatPnl(pitIn.totalNet190Usd)}。失った勝ちは基準にあってこの本に無い株の勝ち。外した負けはその負け。代わりは基準に無い約定。日足の山と谷がエンジンのDDと1セント違うときはその差を併記した。
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-muted">
        {names}。500+400の8%ではHIMS、CLS、SMCIの外した約定は0。上位200の2022-10窓の8%ではSMCIは負け{tickerLine(cell("A8", "adv", "oos"), "SMCI")}で、勝ちは出ていない。今のリストの8%では2022-10窓の外した勝ちにIREN（{formatPnl(cell("A8", "core", "oos").removedTickers.find((item) => item.ticker === "IREN")?.winsUsd ?? 0)}）とPOETがある。上位200の2024-10窓の8%で外した大きい勝ちはCLSとHIMS。そのセルの代わりは{side(advIn.replaced.n, advIn.replaced.pnlUsd)}。
      </p>
      <Grid universes={["pit", "adv"]} title="8%が判定、7%と10%は参考" />
      <Flows universes={["pit", "adv"]} title="外した約定と代わり・500+400と上位200" />
      <Grid universes={["core"]} title="参考・今のリスト" />
      <Flows universes={["core"]} title="外した約定と代わり・今のリスト" />
    </section>
  );
}
