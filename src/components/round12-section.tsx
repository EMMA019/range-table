import report from "../../data/backtest/round12.json";
import { formatDollar, formatPnl } from "@/lib/format";
import type { Round3Universe, Round3Window } from "@/lib/round3";
import type { Verdict } from "@/lib/round2";
import { listExcluded, ROUND12_IDS, ROUND12_PREREG, type FlowTicker, type Round12Id, type Round12Report, type Round12Row } from "@/lib/round12";

const data = report as Round12Report;
if (data.rulesCommit !== ROUND12_PREREG) throw new Error("事前登録のハッシュが違う");

const NAME: Record<Round12Id, string> = {
  B: "基準",
  S: "太陽光",
  C: "暗号",
  N: "原子力",
  A: "3つ",
  H: "3つ+HOOD",
};
const UNIVERSE: Record<Round3Universe, string> = { core: "今のリスト", pit: "当時の500+400", adv: "売買代金上位200" };
const WINDOW: Record<Round3Window, string> = { oos: "2022-10〜2024-10", in: "2024-10〜2026-10" };
const VERDICT: Record<Verdict, string> = { pass: "合格", fail: "不合格", hold: "保留", "not-judged": "未判定" };
const ORDER: Round3Universe[] = ["pit", "adv", "core"];

function cell(id: Round12Id, universe: Round3Universe, window: Round3Window): Round12Row {
  const row = data.rows.find((item) => item.id === id && item.universe === universe && item.window === window);
  if (!row) throw new Error(`行がない ${id} ${universe} ${window}`);
  return row;
}

function rowsFor(universes: readonly Round3Universe[]): Round12Row[] {
  return universes.flatMap((universe) => (["oos", "in"] as const).flatMap((window) => ROUND12_IDS.map((id) => cell(id, universe, window))));
}

function peak(row: Round12Row): string {
  const when = row.peakDate === "start" ? "開始" : row.peakDate;
  const penny = row.pathDdUsd === row.mtmDdUsd ? "" : `、日足の差 ${formatDollar(row.pathDdUsd)}`;
  return `${formatDollar(row.mtmDdUsd)}。山 ${when} ${formatDollar(row.peakUsd)}、谷 ${row.troughDate} ${formatDollar(row.troughUsd)}${penny}`;
}

function large(n: number, usd: number): string {
  return n ? `${n}（${formatPnl(usd)}）` : "0";
}

function side(n: number, usd: number): string {
  return `${n}（${formatPnl(usd)}）`;
}

function tickerOf(row: Round12Row, ticker: string): FlowTicker | undefined {
  return row.removedTickers.find((item) => item.ticker === ticker);
}

function focusLine(id: Round12Id, universe: Round3Universe, window: Round3Window, ticker: string): string {
  const item = tickerOf(cell(id, universe, window), ticker);
  if (!item || item.n === 0) return "0";
  return `勝ち${item.wins}（${formatPnl(item.winsUsd)}）、負け${item.losses}（${formatPnl(item.lossesUsd)}）`;
}

type FlowRow = { row: Round12Row; kind: "外した" | "代わり"; ticker: FlowTicker; listed: boolean };

function flows(universes: readonly Round3Universe[]): FlowRow[] {
  const out: FlowRow[] = [];
  for (const universe of universes) {
    for (const window of ["oos", "in"] as const) {
      for (const id of ROUND12_IDS) {
        if (id === "B") continue;
        const row = cell(id, universe, window);
        for (const ticker of row.removedTickers) {
          if (ticker.n > 0) out.push({ row, kind: "外した", ticker, listed: listExcluded(ticker.ticker, id) });
        }
        for (const ticker of row.replacedTickers) {
          if (ticker.n > 0) out.push({ row, kind: "代わり", ticker, listed: listExcluded(ticker.ticker, id) });
        }
      }
    }
  }
  return out;
}

function Grid({ universes, title }: { universes: readonly Round3Universe[]; title: string }) {
  const head = ["本", "ユニバース", "期間", "$1.90後", "エンジン", "回数", "株の−$60", "評価DD", "最安", "外した勝ち", "外した負け", "代わり", "SOXX差", "リスト見送り", "判定"];
  return (
    <div className="mt-2">
      <p className="text-xs">{title}</p>
      <div className="overflow-x-auto">
        <table className="mt-1 w-full min-w-[96rem] text-[10px]">
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
                <td className="py-1 pr-2 text-right tabular-nums">{large(row.stockLargeN, row.stockLargeUsd)}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{peak(row)}</td>
                <td className="py-1 pr-2 text-right tabular-nums">
                  {row.lowDate} {formatDollar(row.lowUsd)}
                </td>
                <td className="py-1 pr-2 text-right tabular-nums">{side(row.removed.wins, row.removed.winsUsd)}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{side(row.removed.losses, row.removed.lossesUsd)}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{side(row.replaced.n, row.replaced.pnlUsd)}</td>
                <td className="py-1 pr-2 text-right tabular-nums">
                  {row.etfNDelta}回 {formatPnl(row.etfPnlDelta)}
                </td>
                <td className="py-1 pr-2 text-right tabular-nums">{row.skipped.list}</td>
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
  const head = ["ユニバース", "期間", "本", "向き", "銘柄", "リスト", "勝ち", "勝ち合計", "負け", "負け合計"];
  return (
    <div className="mt-2">
      <p className="text-xs">{title}</p>
      <div className="overflow-x-auto">
        <table className="mt-1 w-full min-w-[48rem] text-[10px]">
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
            {flows(universes).map(({ row, kind, ticker, listed }) => (
              <tr key={`${row.id}-${row.universe}-${row.window}-${kind}-${ticker.ticker}`} className="border-t border-line">
                <th scope="row" className="py-1 pr-2 text-left font-normal">
                  {UNIVERSE[row.universe]}
                </th>
                <td className="py-1 pr-2 text-right">{WINDOW[row.window]}</td>
                <td className="py-1 pr-2 text-right">{NAME[row.id]}</td>
                <td className="py-1 pr-2 text-right">{kind}</td>
                <td className="py-1 pr-2 text-right">{ticker.ticker}</td>
                <td className="py-1 pr-2 text-right">{listed ? "はい" : "経路"}</td>
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

/** Round-12 explicit exclusion lists. Judged cells are PIT and ADV. The current list is reference. */
export function Round12Section() {
  const made = data.generatedAt.slice(0, 10);
  const base = cell("B", "pit", "oos");
  const verdicts = data.summary.map((row) => `${NAME[row.id]}は${VERDICT[row.verdict]}`).join("、");
  const mstr = data.rows.reduce((sum, row) => sum + row.removedTickers.filter((item) => item.ticker === "MSTR").reduce((inner, item) => inner + item.n, 0) + row.replacedTickers.filter((item) => item.ticker === "MSTR").reduce((inner, item) => inner + item.n, 0), 0);
  const hood = cell("H", "adv", "in");
  const hoodOnly = tickerOf(hood, "HOOD");
  const iren = tickerOf(cell("C", "core", "oos"), "IREN");
  const irenPath = tickerOf(cell("N", "core", "oos"), "IREN");
  return (
    <section className="rounded-2xl border border-line bg-elev px-3 py-3 shadow-[var(--shadow)]">
      <h2 className="text-sm font-medium">銘柄リストの除外</h2>
      <p className="mt-1 text-[11px] leading-relaxed text-muted">
        事前登録 {data.rulesCommit.slice(0, 7)}。作成 {made}。本は出口Cと余資のSOXX（E30、箱の出口、20日）。株のロットは$300–$450のまま。除外は入りの前に候補を落とす。空いた現金と枠は後の株とSOXXが使う。基準は除外なしで、公開の6セルと一致した。$1.90後は売却の$0.70を戻してから1ポジションにつき$1.90を引いた合計で、判定には使わない。判定はエンジンの損益で、500+400と上位200の4セル。{verdicts}。必要な回数に届かないので保留で、不合格のセルは無い。リストは2026-10-03までの知識で作った後知恵で、窓の始まりに同じリストを選んだ証拠にはならない。{data.lists.exception}は常に残す。赤字の追加除外は0。基準のF1が既に落としている候補（窓内、無効でない、TTMが負、かつ箱の上ではない）は、500+400で{base.skipped.f1Only}と{cell("B", "pit", "in").skipped.f1Only}、上位200で{cell("B", "adv", "oos").skipped.f1Only}と{cell("B", "adv", "in").skipped.f1Only}、今のリストで{cell("B", "core", "oos").skipped.f1Only}と{cell("B", "core", "in").skipped.f1Only}。負のTTM全体（箱の上も含む）はそれぞれ{cell("B", "pit", "oos").skipped.f1Negative}、{cell("B", "pit", "in").skipped.f1Negative}、{cell("B", "adv", "oos").skipped.f1Negative}、{cell("B", "adv", "in").skipped.f1Negative}、{cell("B", "core", "oos").skipped.f1Negative}、{cell("B", "core", "in").skipped.f1Negative}。日足の山と谷がエンジンのDDと1セント違うときはその差を併記した。
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-muted">
        太陽光は{data.lists.solar.join(" ")}。暗号は{data.lists.crypto.join(" ")}。HOODは3つ+HOODだけ。原子力は{data.lists.nuclear.join(" ")}。外した約定は、基準にあってその本に無い株で、銘柄と入り日で数える。リストに無い銘柄も、経路が変わって枠を取られなかったときは外した側に入る。代わりは、その本にあって基準に無い株。COINは上位200の2022-10窓で{focusLine("C", "adv", "oos", "COIN")}、2024-10窓で{focusLine("C", "adv", "in", "COIN")}。500+400と今のリストではCOINの約定は0。HOODの外した約定は上位200の2024-10窓の3つ+HOODだけで、{hoodOnly ? `勝ち${hoodOnly.wins}（${formatPnl(hoodOnly.winsUsd)}）` : "0"}。そのセルのエンジンは{formatPnl(hood.totalUsd)}で、3つだけの{formatPnl(cell("A", "adv", "in").totalUsd)}より小さい。MSTRの約定は全36セルで{mstr}。今のリストの暗号で外れた勝ちの大半はIRENで、2022-10窓は勝ち{iren?.wins ?? 0}（{formatPnl(iren?.winsUsd ?? 0)}）、負け{iren?.losses ?? 0}（{formatPnl(iren?.lossesUsd ?? 0)}）。原子力の同じ窓にIRENの勝ち{irenPath?.wins ?? 0}（{formatPnl(irenPath?.winsUsd ?? 0)}）があるが、これはリスト除外ではなく経路。CIFRとWULFは外した約定に出ていない。代わりの大きなマイナスは、500+400の2024-10窓の太陽光で{formatPnl(cell("S", "pit", "in").replaced.pnlUsd)}、上位200の同じ窓の太陽光でSMCIを含む{formatPnl(cell("S", "adv", "in").replaced.pnlUsd)}。
      </p>
      <Grid universes={["pit", "adv"]} title="判定セル" />
      <Flows universes={["pit", "adv"]} title="外した約定と代わり・判定セル" />
      <Grid universes={["core"]} title="参考・今のリスト" />
      <Flows universes={ORDER.filter((item) => item === "core")} title="外した約定と代わり・今のリスト" />
    </section>
  );
}
