import report from "../../data/backtest/round14.json";
import { formatDollar, formatPnl } from "@/lib/format";
import type { Round3Universe, Round3Window } from "@/lib/round3";
import { ROUND14_PREREG, type Round14Cell, type Round14Report } from "@/lib/round14";

const data = report as Round14Report;
if (data.rulesCommit !== ROUND14_PREREG) throw new Error("事前登録のハッシュが違う");

const UNIVERSE: Record<Round3Universe, string> = { core: "今のリスト", pit: "当時の500+400", adv: "売買代金上位200" };
const WINDOW: Record<Round3Window, string> = { oos: "2022-10〜2024-10", in: "2024-10〜2026-10" };

function cell(universe: Round3Universe, window: Round3Window): Round14Cell {
  const row = data.cells.find((item) => item.universe === universe && item.window === window);
  if (!row) throw new Error(`行がない ${universe} ${window}`);
  return row;
}

function pct(frac: number): string {
  const shown = Math.round(frac * 10000) / 100;
  if (shown === 0) return "0.00%";
  const sign = shown > 0 ? "+" : "−";
  return `${sign}${Math.abs(shown).toFixed(2)}%`;
}

function rowsFor(universes: readonly Round3Universe[]): Round14Cell[] {
  return universes.flatMap((universe) => (["oos", "in"] as const).map((window) => cell(universe, window)));
}

function Grid({ universes, title }: { universes: readonly Round3Universe[]; title: string }) {
  const head = ["ユニバース", "期間", "基準の$1.90", "基準のエンジン", "パークの$1.90", "パークのエンジン", "分配", "価格", "売却", "追加手数料", "サイクル", "$1.90の差", "エンジンの差", "評価DD", "最安"];
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
              <tr key={`${row.universe}-${row.window}`} className="border-t border-line align-top">
                <th scope="row" className="py-1 pr-2 text-left font-normal">
                  {UNIVERSE[row.universe]}
                </th>
                <td className="py-1 pr-2 text-right">{WINDOW[row.window]}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{formatPnl(row.baseline.totalNetUsd)}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{formatPnl(row.baseline.totalUsd)}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{formatPnl(row.parked.totalNetUsd)}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{formatPnl(row.parked.totalUsd)}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{formatPnl(row.parked.parkDivUsd)}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{formatPnl(row.parked.parkPriceUsd)}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{row.parked.sellN}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{formatDollar(row.parked.feesUsd)}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{row.parked.cycles}</td>
                <td className="py-1 pr-2 text-right tabular-nums">
                  {formatPnl(row.upliftNetUsd)}
                  <span className="block text-muted">{pct(row.upliftNetFrac)}</span>
                </td>
                <td className="py-1 pr-2 text-right tabular-nums">
                  {formatPnl(row.upliftUsd)}
                  <span className="block text-muted">{pct(row.upliftFrac)}</span>
                </td>
                <td className="py-1 pr-2 text-right tabular-nums">
                  {formatDollar(row.parked.mtmDdUsd)}
                  <span className="block text-muted">基準 {formatDollar(row.baseline.mtmDdUsd)}</span>
                </td>
                <td className="py-1 text-right tabular-nums">
                  {row.parked.lowDate} {formatDollar(row.parked.lowUsd)}
                  <span className="block text-muted">
                    基準 {row.baseline.lowDate} {formatDollar(row.baseline.lowUsd)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Years({ universes, title }: { universes: readonly Round3Universe[]; title: string }) {
  const rows = rowsFor(universes).flatMap((row) => row.years.map((year) => ({ row, year })));
  return (
    <div className="mt-2">
      <p className="text-xs">{title}</p>
      <div className="overflow-x-auto">
        <table className="mt-1 w-full min-w-[36rem] text-[10px]">
          <thead className="text-muted">
            <tr>
              {["ユニバース", "期間", "年", "エンジンの差", "3,200ドルに対する割合"].map((label) => (
                <th key={label} className="pb-1 pr-2 text-right font-normal first:text-left">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ row, year }) => (
              <tr key={`${row.universe}-${row.window}-${year.year}`} className="border-t border-line">
                <th scope="row" className="py-1 pr-2 text-left font-normal">
                  {UNIVERSE[row.universe]}
                </th>
                <td className="py-1 pr-2 text-right">{WINDOW[row.window]}</td>
                <td className="py-1 pr-2 text-right tabular-nums">
                  {year.year}
                  <span className="block text-muted">
                    {year.from}〜{year.to}
                  </span>
                </td>
                <td className="py-1 pr-2 text-right tabular-nums">{formatPnl(year.upliftUsd)}</td>
                <td className="py-1 text-right tabular-nums">{pct(year.upliftFrac)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Idle cash in SGOV. PIT and ADV are the stored cells. The current list sits beside them. There is no verdict. */
export function Round14Section() {
  const made = data.generatedAt.slice(0, 10);
  const pitIn = cell("pit", "in");
  const advIn = cell("adv", "in");
  const pitOos = cell("pit", "oos");
  const bil = data.cells.every((row) => row.parked.bilSessions === 0);
  return (
    <section className="rounded-2xl border border-line bg-elev px-3 py-3 shadow-[var(--shadow)]">
      <h2 className="text-sm font-medium">余資の短期国債</h2>
      <p className="mt-1 text-[11px] leading-relaxed text-muted">
        事前登録 {data.rulesCommit.slice(0, 7)}。作成 {made}。本は出口Cと余資のSOXX（E30、箱の出口、20日）。株のロットは$300–$450のまま。余った決済済み現金はSGOVの整数株。権利落ち日に、前日から持っている株へ現金配当を入れる。株かSOXXの買いに現金が足りないときは、その始値で足りるだけSGOVを売り、売却の$0.70はすぐ使える。買いのあと、残った現金で同じ始値のSGOVを買う。買い手数料は$0。窓の最後に残った株を終値で売る。フラットからフラットの1回を1ポジションとし、$1.90はそこへ1回。売却のたびに$0.70がエンジンに入る。$1.90後の差は判定に使わない。合格・不合格は付けない。パークを切った行は公開の基準と、口座損益・評価DD・SOXX損益・株の回数・SOXXの回数・株とSOXXの同日マイナス・$1.90後で一致した。BILを使った日は{bil ? "0" : "あり"}。
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-muted">
        株の約定はほぼ基準のまま。今のリストの2022-10窓だけ株の損益が{formatPnl(cell("core", "oos").baseline.stockUsd)}から{formatPnl(cell("core", "oos").parked.stockUsd)}へ動いた。回数は同じ。SOXXの回数は、500+400の2022-10窓で{pitOos.baseline.soxxN}から{pitOos.parked.soxxN}、2024-10窓で{pitIn.baseline.soxxN}から{pitIn.parked.soxxN}。上位200の2024-10窓は{advIn.baseline.soxxN}から{advIn.parked.soxxN}。2022-10窓のエンジン差は500+400で{formatPnl(pitOos.upliftUsd)}、2024-10窓は{formatPnl(pitIn.upliftUsd)}。上位200の2024-10窓のエンジン差は{formatPnl(advIn.upliftUsd)}で、$1.90後は{formatPnl(advIn.upliftNetUsd)}。価格損益は分配を含まない。年の差は、その年のセッションにおけるエンジン評価額の変化の差で、$3,200に対する割合も併記する。
      </p>
      <Grid universes={["pit", "adv"]} title="500+400と上位200" />
      <Years universes={["pit", "adv"]} title="年ごとのエンジン差" />
      <Grid universes={["core"]} title="参考・今のリスト" />
      <Years universes={["core"]} title="年ごとのエンジン差・今のリスト" />
    </section>
  );
}
