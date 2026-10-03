import report from "../../data/backtest/round12c.json";
import { formatDollar, formatPnl } from "@/lib/format";
import { ROUND12B_PREREG, ROUND12C_PREREG, type GroupStat, type Round12bCell, type Round12bReport } from "@/lib/round12b";

const data = report as Round12bReport;
if (data.rulesCommit !== ROUND12C_PREREG || data.priorPrereg !== ROUND12B_PREREG || data.hypothesisOnly !== true) {
  throw new Error("事前登録のハッシュが違う");
}

const UNIVERSE: Record<Round12bCell["universe"], string> = { core: "今のリスト", pit: "当時の500+400", adv: "売買代金上位200" };
const WINDOW: Record<Round12bCell["window"], string> = { oos: "2022-10〜2024-10", in: "2024-10〜2026-10" };
const SOURCE: Record<string, string> = { gics: "GICS", watchlist: "監視", unknown: "不明" };
const ORDER: Array<Pick<Round12bCell, "universe" | "window">> = [
  { universe: "pit", window: "oos" },
  { universe: "pit", window: "in" },
  { universe: "adv", window: "oos" },
  { universe: "adv", window: "in" },
  { universe: "core", window: "oos" },
  { universe: "core", window: "in" },
];

function cell(universe: Round12bCell["universe"], window: Round12bCell["window"]): Round12bCell {
  const row = data.cells.find((item) => item.universe === universe && item.window === window);
  if (!row) throw new Error(`行がない ${universe} ${window}`);
  return row;
}

function rowsFor(universes: readonly Round12bCell["universe"][]): Round12bCell[] {
  return ORDER.filter((item) => universes.includes(item.universe)).map((item) => cell(item.universe, item.window));
}

function formatReturn(ratio: number): string {
  const pct = ratio * 100;
  const body = `${Math.abs(pct).toFixed(2)}%`;
  if (Math.round(pct * 100) === 0) return body;
  return pct > 0 ? `+${body}` : `−${body}`;
}

function rate(value: number | null): string {
  return value == null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function avg(value: number | null): string {
  return value == null ? "—" : formatPnl(value);
}

function bucketLabel(key: string): string {
  if (key === "<3") return "3%未満";
  if (key === ">=10") return "10%以上";
  return `${key.replace("-", "–")}%`;
}

function flow(n: number, usd: number): string {
  return `${n}（${formatPnl(usd)}）`;
}

function Head({ cells, title }: { cells: readonly Round12bCell[]; title: string }) {
  const head = ["ユニバース", "期間", "株の$1.90", "株のエンジン", "回数", "必要資金", "日付", "$1.90/資金", "現金で取れなかった", "経路", "押しのけ", "上位", "下位"];
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
            {cells.map((row) => (
              <tr key={`${row.universe}-${row.window}`} className="border-t border-line align-top">
                <th scope="row" className="py-1 pr-2 text-left font-normal">
                  {UNIVERSE[row.universe]}
                </th>
                <td className="py-1 pr-2 text-right">{WINDOW[row.window]}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{formatPnl(row.stockNetUsd)}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{formatPnl(row.stockUsd)}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{row.stockN}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{formatDollar(row.deployedUsd)}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{row.deployedDate}</td>
                <td className="py-1 pr-2 text-right tabular-nums">
                  {formatReturn(row.returnOnDeployed)}
                  <span className="block text-muted">エンジン {formatReturn(row.engineReturnOnDeployed)}</span>
                </td>
                <td className="py-1 pr-2 text-right tabular-nums">
                  {flow(row.cash.n, row.cash.pnlUsd)}
                  <span className="block text-muted">$1.90 {formatPnl(row.cash.netUsd)}{row.cashUnfilled ? `、未取得 ${row.cashUnfilled}` : ""}</span>
                </td>
                <td className="py-1 pr-2 text-right tabular-nums">
                  {flow(row.path.n, row.path.pnlUsd)}
                  <span className="block text-muted">
                    枠 {flow(row.slot.n, row.slot.pnlUsd)}、半導体 {flow(row.semi.n, row.semi.pnlUsd)}
                  </span>
                </td>
                <td className="py-1 pr-2 text-right tabular-nums">
                  {flow(row.displaced.n, row.displaced.pnlUsd)}
                  <span className="block text-muted">$1.90 {formatPnl(row.displaced.netUsd)}</span>
                </td>
                <td className="py-1 pr-2 text-right">{row.topSector}</td>
                <td className="py-1 text-right">{row.bottomSector}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Groups({ cells, title, bucket }: { cells: readonly Round12bCell[]; title: string; bucket?: boolean }) {
  const head = ["ユニバース", "期間", bucket ? "ATR" : "セクター", "出どころ", "回数", "勝率", "平均", "合計", "−$60以下"];
  const lines = cells.flatMap((row) => (bucket ? row.buckets : row.sectors).map((stat) => ({ row, stat })));
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
            {lines.map(({ row, stat }) => (
              <tr key={`${row.universe}-${row.window}-${stat.key}`} className="border-t border-line">
                <th scope="row" className="py-1 pr-2 text-left font-normal">
                  {UNIVERSE[row.universe]}
                </th>
                <td className="py-1 pr-2 text-right">{WINDOW[row.window]}</td>
                <td className="py-1 pr-2 text-right">{bucket ? bucketLabel(stat.key) : stat.key}</td>
                <td className="py-1 pr-2 text-right">{bucket ? "—" : SOURCE[stat.source ?? ""] ?? "—"}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{stat.n}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{rate(stat.winRate)}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{avg(stat.avgUsd)}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{formatPnl(stat.totalUsd)}</td>
                <td className="py-1 text-right tabular-nums">{stat.largeN}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function sources(row: Round12bCell): string {
  return `GICS ${row.sources.gics}、監視 ${row.sources.watchlist}、不明 ${row.sources.unknown}`;
}

/** Unlimited budget. Hypothesis generation only. No pass or fail. */
export function Round12cSection() {
  const made = data.generatedAt.slice(0, 10);
  const judged = rowsFor(["pit", "adv"]);
  const core = rowsFor(["core"]);
  const oos = cell("pit", "oos");
  const inn = cell("pit", "in");
  const below = data.cells.every((row) => row.buckets.find((stat: GroupStat) => stat.key === "<3")?.n === 0);
  return (
    <section className="rounded-2xl border border-line bg-elev px-3 py-3 shadow-[var(--shadow)]">
      <h2 className="text-sm font-medium">資金制約を外した本（仮説の生成だけ）</h2>
      <p className="mt-1 text-[11px] leading-relaxed text-muted">
        事前登録 {data.rulesCommit.slice(0, 7)}。作成 {made}。前の事前登録 {data.priorPrereg.slice(0, 7)} は、基準の約定が無制限の約定に無いと停止する、と書いていた。実行は今のリストの2022-10窓で60件止まって、表は出なかった。そのファイルは変えていない。{data.rulesCommit.slice(0, 7)} はその停止の後、表の前に固定した。足りない約定は押しのけとして数える。損益は基準の本での損益で、無制限の株合計、セクター、ATRには入れない。
      </p>
      <p className="mt-1 text-[11px] font-medium leading-relaxed">
        これは仮説の生成だけ。合格も不合格も保留も無い。セクターとATRは、成績を出した同じ窓の記述。ここからセクターやATRの幅を売買ルールにするのは後知恵で、この本は選んでいない。
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-muted">
        制約付きの行は公開の6セルと一致した。口座の損益、評価のDD、SOXXの損益、株の回数、SOXXの回数、同じ日に株とSOXXが両方マイナスだった日数、$1.90後。無制限は、残った株のシグナルをすべて$300–$450で取る。現金、5枠、半導体2銘柄は制限にしない。同じ銘柄を同時に2つは持たない。$1.90後は、売却の$0.70を戻してから1ポジションにつき$1.90を1回引く。買いと売りの両方には掛けない。必要資金は、決済前の株の入りコストの最大で、日付はその最大を最初に付けた日。SOXXはその合計に入らない。資金比は株の$1.90後を必要資金で割った値で、エンジンの損益を割った値を併記した。
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-muted">
        SOXXは株の無い別の歩きで、ユニバースでは変わらない。2022-10窓はエンジン {formatPnl(oos.soxxUsd)}、$1.90後 {formatPnl(oos.soxxNetUsd)}、{oos.soxxN}回。2024-10窓はエンジン {formatPnl(inn.soxxUsd)}、$1.90後 {formatPnl(inn.soxxNetUsd)}、{inn.soxxN}回。基準のSOXXより金額が大きいのは、株が現金を使わず、株のための売却も無いため。株の表には混ぜていない。
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-muted">
        現金で取れなかったのは、基準が現金不足で見送り、無制限が約定したシグナル。経路は、無制限にあって基準に無く、現金見送りでもない約定。その内訳は枠と半導体の上限。数が経路より少ない分は、基準がその銘柄を既に持っていて見送り理由が残っていない。押しのけは逆で、無制限が先のシグナルでその銘柄を持ったままなので、基準が後から取った約定を無制限は取っていない。当時の500+400の2024-10窓は株の$1.90後 {formatPnl(inn.stockNetUsd)}、エンジン {formatPnl(inn.stockUsd)}、必要資金 {formatDollar(inn.deployedUsd)}（{inn.deployedDate}）、資金比 {formatReturn(inn.returnOnDeployed)}。2022-10窓は株の$1.90後 {formatPnl(oos.stockNetUsd)}、必要資金 {formatDollar(oos.deployedUsd)}（{oos.deployedDate}）、資金比 {formatReturn(oos.returnOnDeployed)}。
      </p>
      <Head cells={judged} title="4セル。判定はしない" />
      <Head cells={core} title="参考・今のリスト" />
      <p className="mt-2 text-[11px] leading-relaxed text-muted">
        セクターはキャッシュしたWikipediaの現在のGICSで、S&P500がS&P400より優先。どちらにも無い銘柄は監視リストのグループ名で、出どころは監視。それも無ければ不明。シグナル日のセクターではない。合計はエンジンの損益。勝率は損益がプラスの回数を回数で割った値。−$60以下はその回数。出どころの回数は、500+400の2022-10窓が{sources(oos)}、2024-10窓が{sources(inn)}、上位200の2022-10窓が{sources(cell("adv", "oos"))}、2024-10窓が{sources(cell("adv", "in"))}、今のリストの2022-10窓が{sources(cell("core", "oos"))}、2024-10窓が{sources(cell("core", "in"))}。上位200の2024-10窓の合計一位は監視リストのグループで、GICSではない。
      </p>
      <Groups cells={judged} title="セクター・4セル。合計の大きい順" />
      <Groups cells={core} title="セクター・今のリスト" />
      <p className="mt-2 text-[11px] leading-relaxed text-muted">
        ATRはシグナルのATR14をその終値で割り、100を掛けた値。境界の値は上の幅に入る。3%未満は{below ? "6セルとも0" : "ゲートを通過した約定がある"}。幅の表も記述で、狭い幅を落とすルールにはしていない。
      </p>
      <Groups cells={judged} title="ATR・4セル" bucket />
      <Groups cells={core} title="ATR・今のリスト" bucket />
    </section>
  );
}
