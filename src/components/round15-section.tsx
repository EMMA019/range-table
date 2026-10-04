import report from "../../data/backtest/round15.json";
import { formatDollar, formatPnl } from "@/lib/format";
import type { Round3Universe, Round3Window } from "@/lib/round3";
import type { Round15Cell, Round15Report, Round15Row } from "@/lib/round15";

const data = report as Round15Report;
const UNIVERSE: Record<Exclude<Round3Universe, "core">, string> = { pit: "当時の500+400", adv: "売買代金上位200" };
const WINDOW: Record<Round3Window, string> = { oos: "2022-10〜2024-10", in: "2024-10〜2026-10" };

function rate(value: number | null): string {
  return value == null ? "—" : `${(Math.round(value * 10000) / 100).toFixed(2)}%`;
}

function cell(universe: Exclude<Round3Universe, "core">, window: Round3Window): Round15Cell {
  const row = data.cells.find((item) => item.universe === universe && item.window === window);
  if (!row) throw new Error(`セルがない ${universe} ${window}`);
  return row;
}

function line(row: Round15Row): string {
  return `${formatPnl(row.totalNet190Usd)} / ${formatPnl(row.totalUsd)}、${row.n}回、勝率${rate(row.winRate)}、DD ${formatDollar(row.mtmDdUsd)}、最低 ${row.lowDate} ${formatDollar(row.lowUsd)}`;
}

function removed(universe: Exclude<Round3Universe, "core">, window: Round3Window): string {
  const row = cell(universe, window).removed;
  return `${row.n}回、エンジン ${formatPnl(row.engineUsd)}、$1.90 ${formatPnl(row.net190Usd)}`;
}

function yahooLine(): string {
  if (!("retrievedOn" in data.yahoo)) return `Yahooの取得は失敗した（${data.yahoo.error}）。`;
  const bits = Object.entries(data.yahoo.byTicker).map(([ticker, snap]) => `${ticker} ${snap.trailingEps ?? "—"}`);
  return `Yahooの過去12か月EPSは${data.yahoo.retrievedOn}に取得した（${bits.join("、")}）。決算期末日は応答に無い。マイナスの銘柄はサイトの赤字ルールなら灰色になる。SPCXはこの5銘柄に無い。`;
}

export function Round15Section() {
  const made = data.generatedAt.slice(0, 10);
  const order: Array<[Exclude<Round3Universe, "core">, Round3Window]> = [
    ["pit", "oos"],
    ["pit", "in"],
    ["adv", "oos"],
    ["adv", "in"],
  ];
  return (
    <section className="rounded-2xl border border-line bg-elev px-3 py-3 shadow-[var(--shadow)]">
      <h2 className="text-sm font-medium">金融セクターの除外</h2>
      <p className="mt-1 text-[11px] leading-relaxed text-muted">
        事前登録 {data.prereg.slice(0, 7)}。作成 {made}。基準は出口Cと余資のSOXX（E30、箱の出口、20日）。株のロットは$300–$450。変種は、今のWikipediaのGICS SectorがFinancialsの候補を歩きの前に落とす。S&P 500の表記がS&P 400より優先で、どちらにも無い銘柄は残す。ウォッチリストの「金融」ではない。合格も不合格も置かない。
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-muted">
        金融は2024-10〜2026-10の結果を見たあとで選んだ。その窓はサンプル内で、確認には使わない。窓の外の確認は2022-10〜2024-10だけ。外した約定の損益は、その金融の約定だけで、空いた現金と枠で入った別の銘柄は含まない。口座の差は、その入れ替えを含んだ本の差。GICSのFinancialsには銀行以外も入り、この本ではCOIN、HOOD、PYPL、XYZが外れた約定に出る。
      </p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[44rem] text-left text-[11px]">
          <thead className="text-muted">
            <tr>
              <th className="py-1 pr-2 font-medium">セル</th>
              <th className="py-1 pr-2 font-medium">基準（$1.90 / エンジン、回数、勝率、DD、最低）</th>
              <th className="py-1 pr-2 font-medium">金融なし</th>
              <th className="py-1 font-medium">外した金融の約定</th>
            </tr>
          </thead>
          <tbody>
            {order.map(([universe, window]) => {
              const row = cell(universe, window);
              const sample = window === "in" ? "サンプル内" : "確認";
              return (
                <tr key={`${universe}-${window}`} className="border-t border-line align-top">
                  <td className="py-1.5 pr-2">
                    {UNIVERSE[universe]}
                    <br />
                    {WINDOW[window]}
                    <br />
                    <span className="text-muted">{sample}</span>
                  </td>
                  <td className="py-1.5 pr-2 tabular-nums">{line(row.baseline)}</td>
                  <td className="py-1.5 pr-2 tabular-nums">{line(row.exFinancials)}</td>
                  <td className="py-1.5 tabular-nums">{removed(universe, window)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-muted">
        量子計算のリストは Emma の指定で太陽光・暗号・原子力の横に記録した（IONQ、RGTI、QBTS、QUBT、ARQQ）。QMCOは入れていない。ラウンド12の除外はこれを読まない。この4セルでも落としていない。5銘柄は今のウォッチリストに無く、当時の500+400にも売買代金上位200にも入らない。日足のキャッシュも無い。EDGARのCIKはあってもslim factsは無いので、赤字除外（F1、不明は残す）は今はこれらを落とさない。{yahooLine()}
      </p>
    </section>
  );
}
