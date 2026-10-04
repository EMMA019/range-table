import report from "../../data/backtest/round8.json";
import { formatDollar, formatPnl } from "@/lib/format";
import type { Round3Universe, Round3Window } from "@/lib/round3";
import type { Verdict } from "@/lib/round2";
import { ETF_REASONS, type EtfEntryName, type EtfExitName, type EtfExitTotals, type Round8Id, type Round8Report, type Round8Row } from "@/lib/round8";

const data = report as Round8Report;

const NAME: Record<Round8Id, string> = {
  C: "C単独",
  SOXX20: "C+SOXX 20日",
  SOXX40: "C+SOXX 40日",
  SOXX60: "C+SOXX 60日",
  QQQ20: "C+QQQ 20日",
  QQQ40: "C+QQQ 40日",
  QQQ60: "C+QQQ 60日",
};
const UNIVERSE: Record<Round3Universe, string> = { core: "今のリスト", pit: "当時の500+400", adv: "売買代金上位200" };
const WINDOW: Record<Round3Window, string> = { oos: "2022-10〜2024-10", in: "2024-10〜2026-10" };
const VERDICT: Record<Verdict, string> = { pass: "合格", fail: "不合格", hold: "保留", "not-judged": "未判定" };
const REASON: Record<keyof EtfExitTotals, string> = {
  target: "利確",
  stop: "損切り",
  timeout: "期限",
  preempted: "先売り",
  window: "窓の終わり",
};

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function rowOf(id: Round8Id, universe: Round3Universe, window: Round3Window, exit: EtfExitName = "box", entry: EtfEntryName = "E15"): Round8Row {
  const row = data.rows.find((item) => item.id === id && item.universe === universe && item.window === window && (id === "C" ? item.exit == null : item.exit === exit && item.entry === entry));
  if (!row) throw new Error(`行がない ${id} ${universe} ${window} ${exit} ${entry}`);
  return row;
}

function money(value: number | null): string {
  return value == null ? "—" : formatPnl(value);
}

function rate(value: number | null): string {
  return value == null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function variant(row: Round8Row): string {
  const flag = row.forcedOneN > 0 ? `、1株の印 ${row.forcedOneN}` : "";
  return `ETF ${formatPnl(row.etfPnlUsd)}、${row.etfN}回、勝率 ${rate(row.etfWinRate)}、平均勝ち ${money(row.etfAvgWinUsd)}、平均負け ${money(row.etfAvgLossUsd)}、ETFの$1.90後 ${formatPnl(row.etfNet190Usd)}、評価DD ${formatDollar(row.mtmDdUsd)}、同日の負け ${row.jointLossDays}日、平均 ${row.meanQty ?? "—"}株${flag}`;
}

function exits(row: Round8Row): string {
  const parts = ETF_REASONS.filter((reason) => row.etfExits[reason].n > 0).map(
    (reason) => `${REASON[reason]} ${row.etfExits[reason].n}件 ${formatPnl(row.etfExits[reason].pnlUsd)}`,
  );
  return parts.length ? parts.join("、") : "なし";
}

function sleeve(row: Round8Row): string {
  return `${WINDOW[row.window]} ${formatPnl(row.totalUsd)}、評価DD ${formatDollar(row.mtmDdUsd)}、使用 株 ${pct(row.stockUtil)}・ETF ${pct(row.etfUtil)}。ETF ${formatPnl(row.etfPnlUsd)}、${row.etfN}回（${exits(row)}）。両方マイナス ${row.bothNegativeDays}日、同日の損切り ${row.sameDayStops}日。$1.90後 ${formatPnl(row.totalNet190Usd)}。`;
}

const GRID_ENTRIES = ["E15", "E25", "E30"] as const;
const GRID_EXITS = ["box", "atr"] as const;
const EXIT_NAME: Record<EtfExitName, string> = { box: "箱", atr: "ATR" };

function gridRows(ids: readonly Round8Id[]): Round8Row[] {
  return ids.flatMap((id) =>
    GRID_ENTRIES.flatMap((entry) =>
      GRID_EXITS.flatMap((exit) =>
        (["pit", "adv"] as const).flatMap((universe) => (["oos", "in"] as const).map((window) => rowOf(id, universe, window, exit, entry))),
      ),
    ),
  );
}

function Grid({ ids, title }: { ids: readonly Round8Id[]; title: string }) {
  const head = ["箱", "入り", "出口", "ユニバース", "期間", "口座", "ETF", "回数", "勝率", "平均勝ち", "平均負け", "$1.90後", "評価DD", "同日の負け"];
  return (
    <div className="mt-2">
      <p className="text-xs">{title}</p>
      <div className="overflow-x-auto">
        <table className="mt-1 w-full min-w-[52rem] text-[10px]">
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
            {gridRows(ids).map((row) => (
              <tr key={`${row.id}-${row.entry}-${row.exit}-${row.universe}-${row.window}`} className="border-t border-line">
                <th scope="row" className="py-1 pr-2 text-left font-normal">
                  {row.id}
                </th>
                <td className="py-1 text-right">{row.entry}</td>
                <td className="py-1 text-right">{row.exit ? EXIT_NAME[row.exit] : "—"}</td>
                <td className="py-1 text-right">{UNIVERSE[row.universe]}</td>
                <td className="py-1 text-right">{WINDOW[row.window]}</td>
                <td className="py-1 text-right tabular-nums">{formatPnl(row.totalUsd)}</td>
                <td className="py-1 text-right tabular-nums">{formatPnl(row.etfPnlUsd)}</td>
                <td className="py-1 text-right tabular-nums">{row.etfN}</td>
                <td className="py-1 text-right tabular-nums">{rate(row.etfWinRate)}</td>
                <td className="py-1 text-right tabular-nums">{money(row.etfAvgWinUsd)}</td>
                <td className="py-1 text-right tabular-nums">{money(row.etfAvgLossUsd)}</td>
                <td className="py-1 text-right tabular-nums">{formatPnl(row.totalNet190Usd)}</td>
                <td className="py-1 text-right tabular-nums">{formatDollar(row.mtmDdUsd)}</td>
                <td className="py-1 text-right tabular-nums">{row.jointLossDays}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function judged(row: Round8Row): string {
  const spy = data.spy[row.window].ratio;
  const versus = row.nRequired == null ? "Nはない" : `${row.n}回、N ${row.nRequired}、回数は${row.n < row.nRequired ? "Nより少ない" : "N以上"}`;
  return `${WINDOW[row.window]} ${VERDICT[row.verdict]} ${formatPnl(row.totalUsd)}、${versus}、評価DD ${formatDollar(row.mtmDdUsd)}、損益/DD ${row.ratio ?? "—"}（SPY ${spy}）、下限 ${row.ciLow ?? "—"}。使用 株 ${pct(row.stockUtil)}・ETF ${pct(row.etfUtil)}。ETF ${formatPnl(row.etfPnlUsd)}、${row.etfN}回（${exits(row)}）。両方マイナス ${row.bothNegativeDays}日、同日の損切り ${row.sameDayStops}日。$1.90後 ${formatPnl(row.totalNet190Usd)}。`;
}

/** Round-8 idle-cash ETF sleeve. N=20 is judged. N=40 and N=60 are reference. */
export function Round8Section() {
  const made = data.generatedAt.slice(0, 10);
  const soxx = data.summary.find((item) => item.id === "SOXX20");
  const qqq = data.summary.find((item) => item.id === "QQQ20");
  return (
    <section className="rounded-2xl border border-line bg-elev px-3 py-3 shadow-[var(--shadow)]">
      <h2 className="text-sm font-medium">余資のETF</h2>
      <p className="mt-1 text-[11px] leading-relaxed text-muted">
        事前登録 {data.rulesCommit.slice(0, 7)}。ATR出口の追記 {data.amendment.slice(0, 7)}。入りの追記 {data.amendment2.slice(0, 7)}。作成 {made}。株の本は出口C。E15は15%線の新規クロス。E25は25%線の同じクロス。E30は終値が箱の安値より高く、安値に高さの30%を足した線（小数4桁）以下で、前日は見ない。判定はE15の20日箱出口だけ。F1は赤字だけ見送り、不明は取る。F2は箱の上を買わない。損切りは20日安値、利確はシグナルの20日高値、期限は20営業日、株数は$300–$450。余資でSOXXかQQQを1銘柄。箱はN日の高値と安値。15%線は安値に高さの15%を足し、小数4桁。終値がその線以上で、前日の終値は前日の線未満のとき、翌営業日の始値で買う。入りの日は始値で利確も損切りもしない。その後は始値が箱の高値以上なら始値、始値が箱の安値未満なら始値。高値が箱の高値以上ならその高値、終値が箱の安値未満なら終値。同じ足は損切りが先。期限は20営業日の終値。株数は min(floor(32÷(入り−箱の安値)), floor(余資÷入り))。株が先で、現金が足りなければETFを必要最小限、その始値で売る。理由は先売り。売却ごとに$0.70。$1.90後は、その手数料を戻してから1ポジションにつき$1.90を引いた合計。E15の箱出口の判定は20日だけ。SOXXは{soxx ? VERDICT[soxx.verdict] : "—"}（500+400 {soxx ? VERDICT[soxx.pit] : "—"}、上位200 {soxx ? VERDICT[soxx.adv] : "—"}）、QQQは{qqq ? VERDICT[qqq.verdict] : "—"}（500+400 {qqq ? VERDICT[qqq.pit] : "—"}、上位200 {qqq ? VERDICT[qqq.adv] : "—"}）。8セルとも合計はプラス、回数は100以上でN未満、損益/DDはSPYを下回り、平均の下限はゼロ以下。C単独は公開済みの6セルと一致した。40日と60日、および今のリストは参考。ATR出口は入りが同じで、損切りは入り−1.5×シグナルのATR14、利確は入り+2×ATR14。ATR14は14本の真の値幅の単純平均で小数4桁。株数は min(floor(32÷(1.5×ATR)), floor(余資÷入り))。リスク式が0株で現金が1株買えるときは1株にして印を付ける。この出口に判定は付けない。
      </p>
      {(["SOXX20", "QQQ20"] as const).map((id) => (
        <div key={id} className="mt-2 text-[11px] leading-relaxed text-muted">
          <p className="text-xs">
            {NAME[id]} {VERDICT[data.summary.find((item) => item.id === id)?.verdict ?? "not-judged"]}
          </p>
          {(["pit", "adv"] as const).map((universe) => (
            <div key={universe} className="mt-1">
              <p>{UNIVERSE[universe]}</p>
              {(["oos", "in"] as const).map((window) => (
                <p key={window}>{judged(rowOf(id, universe, window))}</p>
              ))}
            </div>
          ))}
        </div>
      ))}
      <Grid ids={["SOXX20", "QQQ20"]} title="20日の入りと出口。判定はE15の箱だけ。$1.90後は口座。" />
      <Grid ids={["SOXX40", "QQQ40", "SOXX60", "QQQ60"]} title="40日と60日（参考）。同じ12通り。" />
      <div className="mt-2 text-[11px] leading-relaxed text-muted">
        <p className="text-xs">箱出口とATR出口</p>
        {(["SOXX20", "QQQ20", "SOXX40", "SOXX60", "QQQ40", "QQQ60"] as const).map((id) =>
          (["pit", "adv"] as const).map((universe) => (
            <div key={`${id}-${universe}-atr`} className="mt-1">
              <p>
                {NAME[id]} {UNIVERSE[universe]}
                {id.endsWith("20") ? "" : "（参考）"}
              </p>
              {(["oos", "in"] as const).map((window) => (
                <p key={window}>
                  {WINDOW[window]} 箱 {variant(rowOf(id, universe, window, "box"))}。ATR {variant(rowOf(id, universe, window, "atr"))}。
                </p>
              ))}
            </div>
          )),
        )}
      </div>
      <div className="mt-2 text-[11px] leading-relaxed text-muted">
        <p className="text-xs">参考</p>
        {(["C", "SOXX40", "SOXX60", "QQQ40", "QQQ60"] as const).map((id) =>
          (["pit", "adv"] as const).map((universe) => (
            <div key={`${id}-${universe}`} className="mt-1">
              <p>
                {NAME[id]} {UNIVERSE[universe]}
              </p>
              {(["oos", "in"] as const).map((window) => (
                <p key={window}>{sleeve(rowOf(id, universe, window))}</p>
              ))}
            </div>
          )),
        )}
        <p className="mt-1">
          買い持ち $3,200。
          {data.hold
            .map((item) => `${item.symbol} ${WINDOW[item.window]} ${formatPnl(item.pnlUsd)}、評価DD ${formatDollar(item.mtmDdUsd)}、${item.units}株`)
            .join("。")}
          。
        </p>
      </div>
    </section>
  );
}
