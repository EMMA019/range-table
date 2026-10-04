import report from "../../data/backtest/round9.json";
import { formatDollar, formatPnl } from "@/lib/format";
import type { Round3Universe, Round3Window } from "@/lib/round3";
import type { Verdict } from "@/lib/round2";
import type { RegimeFilter, Round9Base, Round9Report, Round9Row } from "@/lib/round9";

const data = report as Round9Report;

const BASE: Record<Round9Base, string> = { C: "C単独", SOXX: "C+SOXX" };
const FILTER: Record<RegimeFilter, string> = { off: "なし", stop: "株止め", strict: "30%線", "stop-all": "全止め" };
const UNIVERSE: Record<Round3Universe, string> = { core: "今のリスト", pit: "当時の500+400", adv: "売買代金上位200" };
const WINDOW: Record<Round3Window, string> = { oos: "2022-10〜2024-10", in: "2024-10〜2026-10" };
const VERDICT: Record<Verdict, string> = { pass: "合格", fail: "不合格", hold: "保留", "not-judged": "未判定" };
const FILTERS: RegimeFilter[] = ["off", "stop", "strict", "stop-all"];
const BASES: Round9Base[] = ["C", "SOXX"];

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function money(value: number | null): string {
  return value == null ? "—" : formatPnl(value);
}

function rate(value: number | null): string {
  return value == null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function rowsFor(universes: readonly Round3Universe[]): Round9Row[] {
  return BASES.flatMap((base) =>
    FILTERS.flatMap((filter) =>
      universes.flatMap((universe) => (["oos", "in"] as const).map((window) => {
        const row = data.rows.find((item) => item.base === base && item.filter === filter && item.universe === universe && item.window === window);
        if (!row) throw new Error(`行がない ${base} ${filter} ${universe} ${window}`);
        return row;
      })),
    ),
  );
}

function Grid({ universes, title }: { universes: readonly Round3Universe[]; title: string }) {
  const head = ["本", "フィルタ", "ユニバース", "期間", "損益", "$1.90後", "株", "ETF", "勝率", "平均勝ち", "平均負け", "評価DD", "同日の負け", "使用・株", "使用・ETF", "SMA下", "判定"];
  return (
    <div className="mt-2">
      <p className="text-xs">{title}</p>
      <div className="overflow-x-auto">
        <table className="mt-1 w-full min-w-[64rem] text-[10px]">
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
              <tr key={`${row.base}-${row.filter}-${row.universe}-${row.window}`} className="border-t border-line">
                <th scope="row" className="py-1 pr-2 text-left font-normal">
                  {BASE[row.base]}
                </th>
                <td className="py-1 text-right">{FILTER[row.filter]}</td>
                <td className="py-1 text-right">{UNIVERSE[row.universe]}</td>
                <td className="py-1 text-right">{WINDOW[row.window]}</td>
                <td className="py-1 text-right tabular-nums">{formatPnl(row.totalUsd)}</td>
                <td className="py-1 text-right tabular-nums">{formatPnl(row.totalNet190Usd)}</td>
                <td className="py-1 text-right tabular-nums">{row.stockN}</td>
                <td className="py-1 text-right tabular-nums">{row.etfN}</td>
                <td className="py-1 text-right tabular-nums">{rate(row.winRate)}</td>
                <td className="py-1 text-right tabular-nums">{money(row.avgWinUsd)}</td>
                <td className="py-1 text-right tabular-nums">{money(row.avgLossUsd)}</td>
                <td className="py-1 text-right tabular-nums">{formatDollar(row.mtmDdUsd)}</td>
                <td className="py-1 text-right tabular-nums">{row.jointLossDays}</td>
                <td className="py-1 text-right tabular-nums">{pct(row.stockUtil)}</td>
                <td className="py-1 text-right tabular-nums">{pct(row.etfUtil)}</td>
                <td className="py-1 text-right tabular-nums">{pct(row.belowShare)}</td>
                <td className="py-1 text-right">{VERDICT[row.verdict]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Round-9 SPY regime filter. Judged cells are PIT and ADV. The current list is reference. */
export function Round9Section() {
  const made = data.generatedAt.slice(0, 10);
  const pick = data.selection;
  const cellText = pick.cells
    .map((cell) => `${UNIVERSE[cell.universe]} ${WINDOW[cell.window]} ${formatPnl(cell.deltaUsd)}`)
    .join("、");
  return (
    <section className="rounded-2xl border border-line bg-elev px-3 py-3 shadow-[var(--shadow)]">
      <h2 className="text-sm font-medium">SPYの20日線</h2>
      <p className="mt-1 text-[11px] leading-relaxed text-muted">
        事前登録 {data.rulesCommit.slice(0, 7)}。作成 {made}。本は出口Cと、余資のSOXX（E30、箱の出口、20日）。シグナル日のSPY終値が、その日を含む20本の終値の平均より低い日だけフィルタする。平均は丸めない。同じ値は下ではない。入りは翌営業日の始値。開いている玉は閉じない。なしは公開値と一致した。株止めは下の日に株を新規で買わない。30%線は下の日に、終値が箱の安値＋高さの30%（小数4桁）以上も要る。15%以上で上限のない本なので、この条件は本と別の規則。全止めは株止めに加えてSOXXの新規も止める。C単独にSOXXはないので、全止めは株止めと同じ。SMA下は窓の営業日のうちSPYが平均未満の割合で、2022-10〜2024-10は29.8%、2024-10〜2026-10は31.8%。判定は500+400と上位200。今のリストは参考。4通り×2本は事前に固定し、平均の長さは20日だけ。最良は{BASE[pick.bestBase]}の{FILTER[pick.bestFilter]}で、4セルの損益差の合計は{formatPnl(pick.sumDeltaUsd)}（{cellText}）。上回るのは2022-10〜2024-10の2セルで、2024-10〜2026-10の2セルは下回る。
      </p>
      <Grid universes={["pit", "adv"]} title="判定セル" />
      <Grid universes={["core"]} title="参考・今のリスト" />
    </section>
  );
}
