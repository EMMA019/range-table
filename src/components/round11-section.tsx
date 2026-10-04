import report from "../../data/backtest/round11.json";
import { formatDollar, formatPnl } from "@/lib/format";
import type { Round3Universe, Round3Window } from "@/lib/round3";
import type { Verdict } from "@/lib/round2";
import type { NamedStat, Round11Id, Round11Report, Round11Row } from "@/lib/round11";

const data = report as Round11Report;

const NAME: Record<Round11Id, string> = {
  B: "基準",
  X10: "幅10%",
  X12: "幅12%",
  X15: "幅15%",
  EX: "除外・参考",
};
const UNIVERSE: Record<Round3Universe, string> = { core: "今のリスト", pit: "当時の500+400", adv: "売買代金上位200" };
const WINDOW: Record<Round3Window, string> = { oos: "2022-10〜2024-10", in: "2024-10〜2026-10" };
const VERDICT: Record<Verdict, string> = { pass: "合格", fail: "不合格", hold: "保留", "not-judged": "未判定" };
const IDS: Round11Id[] = ["B", "X10", "X12", "X15", "EX"];
const ORDER: Round3Universe[] = ["pit", "adv", "core"];

function rate(value: number | null): string {
  return value == null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function money(value: number | null): string {
  return value == null ? "—" : formatPnl(value);
}

function cell(id: Round11Id, universe: Round3Universe, window: Round3Window): Round11Row {
  const row = data.rows.find((item) => item.id === id && item.universe === universe && item.window === window);
  if (!row) throw new Error(`行がない ${id} ${universe} ${window}`);
  return row;
}

function rowsFor(universes: readonly Round3Universe[]): Round11Row[] {
  return universes.flatMap((universe) => (["oos", "in"] as const).flatMap((window) => IDS.map((id) => cell(id, universe, window))));
}

function peak(row: Round11Row): string {
  const when = row.peakDate === "start" ? "開始" : row.peakDate;
  const penny = row.pathDdUsd === row.mtmDdUsd ? "" : `、日足の差 ${formatDollar(row.pathDdUsd)}`;
  return `${formatDollar(row.mtmDdUsd)}。山 ${when} ${formatDollar(row.peakUsd)}、谷 ${row.troughDate} ${formatDollar(row.troughUsd)}${penny}`;
}

function soxx(row: Round11Row): string {
  const count = row.etfNDelta > 0 ? `+${row.etfNDelta}` : String(row.etfNDelta);
  return `${row.etfN}回 ${formatPnl(row.etfPnlUsd)}（${count}、${formatPnl(row.etfPnlDelta)}）`;
}

function large(n: number, usd: number): string {
  return n ? `${n}（${formatPnl(usd)}）` : "0";
}

function skips(row: Round11Row): string {
  if (row.id === "EX") return `テーマ ${row.skipped.theme}`;
  if (row.id === "B") return "0";
  return `幅 ${row.skipped.width}`;
}

function Grid({ universes, title }: { universes: readonly Round3Universe[]; title: string }) {
  const head = ["本", "ユニバース", "期間", "$1.90後", "エンジン", "回数", "勝ち", "失った勝ち", "勝率", "平均勝ち", "平均負け", "−$60以下", "うち株", "評価DD", "最安", "SOXX", "使用", "見送り", "判定"];
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
                <td className="py-1 pr-2 text-right tabular-nums">{row.wins}</td>
                <td className="py-1 pr-2 text-right tabular-nums">
                  {row.winsLostStock}
                  <span className="block text-muted">ETF {row.winsLostEtf}</span>
                </td>
                <td className="py-1 pr-2 text-right tabular-nums">{rate(row.winRate)}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{money(row.avgWinUsd)}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{money(row.avgLossUsd)}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{large(row.largeN, row.largeUsd)}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{large(row.stockLargeN, row.stockLargeUsd)}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{peak(row)}</td>
                <td className="py-1 pr-2 text-right tabular-nums">
                  {row.lowDate} {formatDollar(row.lowUsd)}
                  <span className="block text-muted">{formatPnl(row.lowVsStartUsd)}</span>
                </td>
                <td className="py-1 pr-2 text-right tabular-nums">{soxx(row)}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{rate(row.deployed)}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{skips(row)}</td>
                <td className="py-1 text-right">{VERDICT[row.verdict]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type NamedRow = { row: Round11Row; name: NamedStat };

function namedRows(universes: readonly Round3Universe[]): NamedRow[] {
  const out: NamedRow[] = [];
  for (const universe of universes) {
    for (const window of ["oos", "in"] as const) {
      for (const id of IDS) {
        const row = cell(id, universe, window);
        for (const name of row.names) {
          if (name.n || name.removedN) out.push({ row, name });
        }
      }
    }
  }
  return out;
}

function Named({ universes, title }: { universes: readonly Round3Universe[]; title: string }) {
  const head = ["ユニバース", "期間", "本", "銘柄", "残った回数", "残った損益", "外した回数", "外した損益", "外した負け"];
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
            {namedRows(universes).map(({ row, name }) => (
              <tr key={`${row.id}-${row.universe}-${row.window}-${name.ticker}`} className="border-t border-line">
                <th scope="row" className="py-1 pr-2 text-left font-normal">
                  {UNIVERSE[row.universe]}
                </th>
                <td className="py-1 pr-2 text-right">{WINDOW[row.window]}</td>
                <td className="py-1 pr-2 text-right">{NAME[row.id]}</td>
                <td className="py-1 pr-2 text-right">{name.ticker}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{name.n}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{formatPnl(name.pnlUsd)}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{name.removedN}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{formatPnl(name.removedUsd)}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{formatPnl(name.removedLossUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Round-11 stop-width filter. Judged cells are PIT and ADV. The current list and the exclusion row are reference. */
export function Round11Section() {
  const made = data.generatedAt.slice(0, 10);
  const x10 = data.summary.find((row) => row.id === "X10");
  const x12 = data.summary.find((row) => row.id === "X12");
  const x15 = data.summary.find((row) => row.id === "X15");
  const failed = cell("X10", "pit", "in");
  const ex = (universe: Round3Universe, window: Round3Window) => cell("EX", universe, window).skipped.theme;
  return (
    <section className="rounded-2xl border border-line bg-elev px-3 py-3 shadow-[var(--shadow)]">
      <h2 className="text-sm font-medium">損切り幅の見送り</h2>
      <p className="mt-1 text-[11px] leading-relaxed text-muted">
        事前登録 {data.rulesCommit.slice(0, 7)}。作成 {made}。本は出口Cと余資のSOXX（E30、箱の出口、20日）。株のロットは$300–$450のまま。見送りは（入りの始値−エンジンの損切り）÷入りの始値が10%、12%、15%を超えるとき。等しい幅は残す。損切りが入り以上のときはこの条件では外さない。基準はフィルタなしで、公開の6セルと一致した。$1.90後は売却の$0.70を戻してから1ポジションにつき$1.90を引いた合計で、判定には使わない。判定はエンジンの損益で、500+400と上位200の4セル。幅10%は{x10 ? VERDICT[x10.verdict] : "—"}（500+400 {x10 ? VERDICT[x10.pit] : "—"}、上位200 {x10 ? VERDICT[x10.adv] : "—"}）、幅12%は{x12 ? VERDICT[x12.verdict] : "—"}、幅15%は{x15 ? VERDICT[x15.verdict] : "—"}。不合格は500+400の2024-10〜2026-10で、エンジン{formatPnl(failed.totalUsd)}、{failed.n}回。失った勝ちは株{failed.winsLostStock}、ETFの勝ちはどのセルでも0。SOXXの列は回数と損益、括弧内は基準との差。増えたSOXXは最大+2回。見送った広い幅には勝ちが含まれる。3通り×4セルは事前に固定し、他の閾値は試していない。日足の山と谷がエンジンのDDと1セント違うときはその差を併記した。
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-muted">
        除外の行は後知恵で、未判定。原子力は{data.exclusion.nuclear.join(" ")}。説明にマイニングとあるのは{data.exclusion.crypto.join(" ")}。太陽光のタグは無く、除外は{data.exclusion.solar.length}銘柄。赤字は基準のF1が既に外していて、この行の追加は0。{data.exclusion.exception}は残す。候補の見送りは500+400で{ex("pit", "oos")}と{ex("pit", "in")}、上位200で{ex("adv", "oos")}と{ex("adv", "in")}、今のリストで{ex("core", "oos")}と{ex("core", "in")}。500+400と上位200の2024-10窓は、見送った候補が約定していなかったので基準と同じ損益。下の銘柄表に無いNBIS、CRWV、CRDO、CVNA、ENPH、SEDGはそのセルで0回。外した負けは、基準にあってこの本に無い負けの合計。
      </p>
      <Grid universes={["pit", "adv"]} title="判定セル" />
      <Named universes={["pit", "adv"]} title="指定銘柄・判定セル" />
      <Grid universes={["core"]} title="参考・今のリスト" />
      <Named universes={ORDER.filter((item) => item === "core")} title="指定銘柄・今のリスト" />
    </section>
  );
}
