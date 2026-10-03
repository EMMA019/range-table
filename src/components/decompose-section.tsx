import report from "../../data/backtest/decompose.json";
import { formatPnl } from "@/lib/format";
import type { DecomposeReport, RankRow, SectorRow } from "@/lib/decompose";

const data = report as DecomposeReport;

const FEATURE: Record<string, string> = {
  atrPct: "ATR%",
  boxWidthPct: "箱の幅",
  entryPosPct: "箱の位置",
  rs20: "対SPY 20日",
  holdSessions: "保有日数",
  daysToNextReaction: "次の決算まで",
  above50: "50日線の上",
  gapThrough: "ギャップ損切り",
  spyAbove20: "SPYが20日線の上",
  weekday: "曜日",
};

const FAMILY: Record<RankRow["family"], string> = {
  entry: "入口",
  path: "出口",
  calendar: "暦",
};

const SLICE: Record<string, string> = {
  "core/oos": "今の187 2022-10",
  "core/in": "今の187 2024-10",
  "pit/oos": "当時の500+400 2022-10",
  "pit/in": "当時の500+400 2024-10",
  "adv/oos": "売買代金上位200 2022-10",
  "adv/in": "売買代金上位200 2024-10",
  pooled: "重複を除いた合算",
};

function pct(value: number | null): string {
  return value == null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function sectorLine(row: SectorRow): string {
  const name = row.sector === "unmapped" ? "未分類" : row.sector;
  return `${name} ${row.n}回、勝率 ${pct(row.winRate)}、平均勝ち ${row.avgWinUsd == null ? "—" : formatPnl(row.avgWinUsd)}、平均負け ${row.avgLossUsd == null ? "—" : formatPnl(row.avgLossUsd)}、合計 ${formatPnl(row.totalUsd)}、最悪 ${row.worstUsd == null ? "—" : formatPnl(row.worstUsd)}。`;
}

/** Descriptive ledger. Not a pass/fail section. */
export function DecomposeSection() {
  const made = data.generatedAt.slice(0, 10);
  return (
    <section className="rounded-2xl border border-line bg-elev px-3 py-3 shadow-[var(--shadow)]">
      <h2 className="text-sm font-medium">取引の分解</h2>
      <p className="mt-1 text-[11px] leading-relaxed text-muted">
        作成 {made}。合格・不合格は付けない。基準は決算の見送りなし、損切りは20日安値。R1は事前登録 65bd4a0。GICSはWikipediaの現在のS&P500とS&P400で、500を優先する。当時の業種ではない。未分類は基準 {data.books[0]?.unmapped.length ?? 0} 銘柄、R1 {data.books[1]?.unmapped.length ?? 0} 銘柄。検定は {data.multipleComparisons.tests} 回。p値は説明用で、ボンフェローニの目安は {data.multipleComparisons.bonferroni}。合算は同じ約定を1回にまとめたもので、一つの口座ではない。
      </p>
      {data.books.map((book) => {
        const pooled = book.slices.find((slice) => slice.id === "pooled");
        return (
          <div key={book.id} className="mt-2">
            <p className="text-xs">{book.label}</p>
            <div className="mt-1 text-[11px] leading-relaxed text-muted">
              {book.slices
                .filter((slice) => slice.id !== "pooled")
                .map((slice) => (
                  <p key={slice.id}>
                    {SLICE[slice.id]} {formatPnl(slice.bookUsd)}、{slice.n}回。
                  </p>
                ))}
              <p className="mt-1">{SLICE.pooled}</p>
              {pooled?.sectors.map((row) => (
                <p key={row.sector} className="mt-1">
                  {sectorLine(row)}
                </p>
              ))}
              <p className="mt-1">
                差の大きい順: {pooled?.rank.slice(0, 4).map((row) => `${FEATURE[row.feature] ?? row.feature}（${FAMILY[row.family]} ${row.stdDiff ?? "—"}）`).join("、")}
                。
              </p>
              <p>
                大きい損失10件のうち、ギャップ損切り {book.shared.gapThrough}、50日線の上 {book.shared.above50}、損切り {book.shared.exitReasons.find((row) => row.bucket === "stop")?.n ?? 0}、未分類 {book.shared.sectors.find((row) => row.bucket === "unmapped")?.n ?? 0}。
              </p>
            </div>
          </div>
        );
      })}
      <div className="mt-2 border-t border-line pt-2 text-[11px] leading-relaxed text-muted">
        <p>仮説。ここから下は未検証で、ルールにはしない。</p>
        <p className="mt-1">基準の合算では、入口の差がいちばん大きいのは箱の位置。勝ちの中央は箱の55%、負けは42%。当時の500+400の2024-10ではこの差はなく、R1の合算でも分かれていない。</p>
        <p className="mt-1">ギャップ損切りと保有日数は出口の記録。ギャップで損切りを割った約定は、入口より下で売っているので負けになる。</p>
        <p className="mt-1">SPYが20日線の下にある日の平均損益は、基準の合算で上にある日より大きい。標準化した差は0.10。R1でも向きは同じで、差は0.16。</p>
        <p className="mt-1">R1の大きい損失10件はすべて損切りで、うち6件の入口が月曜。本全体の曜日の差は0.07。</p>
      </div>
    </section>
  );
}
