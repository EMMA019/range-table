import report from "../../data/backtest/top_trades.json";

type Count = { bucket: string; n: number };
type SideFacts = {
  n: number;
  exitReasons: Count[];
  profit: Count[];
  above50: number;
  below50: number;
  earningsDuring: number;
  unmapped: number;
  medianHold: number | null;
  medianAtrPct: number | null;
  medianEntryPosPct: number | null;
  medianRs20: number | null;
};
type Row = {
  exitReason: string;
  exitDate: string;
  entryPosPct: number | null;
  earningsDuring: string[];
  news: { text: string; url: string } | null;
};
type Book = {
  id: string;
  label: string;
  pooled: number;
  winners: Row[];
  losers: Row[];
  facts: { winners: SideFacts; losers: SideFacts };
};
type TopTradesReport = { rulesCommit: string; generatedAt: string; books: Book[] };

const data = report as TopTradesReport;

function bucket(rows: Count[], name: string): number {
  return rows.find((row) => row.bucket === name)?.n ?? 0;
}

function sessions(value: number | null): string {
  if (value == null) return "—";
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function pct1(value: number | null): string {
  return value == null ? "—" : value.toFixed(1);
}

function signed(value: number | null): string {
  if (value == null) return "—";
  const text = value.toFixed(2);
  return value > 0 ? `+${text}` : text;
}

function sideLine(name: string, rows: Row[], facts: SideFacts): string {
  const aboveBox = rows.filter((row) => (row.entryPosPct ?? 0) > 100).length;
  const onExit = rows.filter((row) => row.earningsDuring.includes(row.exitDate)).length;
  const gapOnExit = rows.filter((row) => row.exitReason === "gap-through-stop" && row.earningsDuring.includes(row.exitDate)).length;
  const news = rows.filter((row) => row.news != null).length;
  const profit = `黒字 ${bucket(facts.profit, "profit")}、赤字 ${bucket(facts.profit, "loss")}、不明 ${bucket(facts.profit, "unknown")}`;
  return `${name} ${facts.n}行。利確 ${bucket(facts.exitReasons, "take-profit")}、損切り ${bucket(facts.exitReasons, "stop")}、ギャップ損切り ${bucket(facts.exitReasons, "gap-through-stop")}、時間切れ ${bucket(facts.exitReasons, "timeout")}。保有の中央値 ${sessions(facts.medianHold)}日。箱の位置の中央値 ${pct1(facts.medianEntryPosPct)}%。100%を超える入りは ${aboveBox}行。50日線の上 ${facts.above50}、下 ${facts.below50}。直近1年は${profit}。保有中の8-K反応日は ${facts.earningsDuring}行、出口日と重なるのは ${onExit}行、出口日のギャップ損切りは ${gapOnExit}行。未分類 ${facts.unmapped}。ATR%の中央値 ${pct1(facts.medianAtrPct)}。対SPY 20日の中央値 ${signed(facts.medianRs20)}。確認したニュース ${news}件。`;
}

/** Descriptive top winners and losers. Not a pass/fail section. */
export function TopTradesSection() {
  const made = data.generatedAt.slice(0, 10);
  return (
    <section className="rounded-2xl border border-line bg-elev px-3 py-3 shadow-[var(--shadow)]">
      <h2 className="text-sm font-medium">大きい勝ちと大きい負け</h2>
      <p className="mt-1 text-[11px] leading-relaxed text-muted">
        作成 {made}。事前登録 {data.rulesCommit.slice(0, 7)}。説明だけ。合格・不合格は付けない。基準（フィルタなし）と、基準にF1（直近1年のGAAPが赤字のときだけ見送り、不明は取る）とF2（始値が箱の上なら見送る）を足した本。当時の500+400と売買代金上位200、両方の期間。同じ銘柄・入り日・出日・損益は1行。一行はSECの業種区分の訳とSECの社名。GICSはWikipediaの現在の区分。全行は data/backtest/top_trades.csv。
      </p>
      {data.books.map((book) => (
        <div key={book.id} className="mt-2 text-[11px] leading-relaxed text-muted">
          <p className="text-xs text-ink">{book.label}</p>
          <p className="mt-1">重複を除くと {book.pooled} 行。各側20行は損益の大きい順。</p>
          <p className="mt-1">{sideLine("勝ち", book.winners, book.facts.winners)}</p>
          <p className="mt-1">{sideLine("負け", book.losers, book.facts.losers)}</p>
        </div>
      ))}
      <div className="mt-2 border-t border-line pt-2 text-[11px] leading-relaxed text-muted">
        <p>仮説。ここから下は未検証で、ルールにはしない。</p>
        <p className="mt-1">F2を通過したあとも、箱の上側の入りが大きいドル損の側に残るかは、あとで事前登録して聞く候補。</p>
        <p className="mt-1">出口が8-Kの反応日に重なるギャップ損切りは、出口の記録。大きい勝ちにも、出口日が反応日の利確がある。</p>
        <p className="mt-1">50日線の上にあることは、この端の大きい勝ちを分ける印にはなっていない、という読み。</p>
      </div>
    </section>
  );
}
