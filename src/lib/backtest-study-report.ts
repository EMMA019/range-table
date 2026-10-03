import type { Book, Row, StudyReport } from "./backtest-study";

const pct = (value: number | null) => (value == null ? "—" : `${(value * 100).toFixed(1)}%`);
const usd = (value: number | null | undefined) => (value == null ? "—" : value.toFixed(2));
const num = (value: number | null | undefined) => (value == null ? "—" : String(value));

function variationTable(rows: Row[]): string {
  const lines = [
    "| ルール | 件数 | 勝率 | 平均$/件 | PF | 最大連敗 | 最大DD$ | 1年目平均 | 2年目平均 |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const row of rows) {
    const stats = row.stats;
    lines.push(
      `| ${row.label} | ${stats.n} | ${pct(stats.winRate)} | ${usd(stats.avgUsd)} | ${num(stats.profitFactor)} | ${stats.maxConsecLosses} | ${usd(stats.maxDrawdownUsd)} | ${usd(row.year1.avgUsd)} | ${usd(row.year2.avgUsd)} |`,
    );
  }
  return lines.join("\n");
}

function bookTable(books: Book[]): string {
  const lines = [
    "| 条件 | 件数 | 勝率 | 平均$/件 | PF | 合計$ | 最大DD$ | 確定$10の日 | 評価+$10の日 | 最悪月 | やり直し1年目$ | やり直し2年目$ |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: |",
  ];
  for (const book of books) {
    const worst = book.worstMonth ? `${book.worstMonth} ${usd(book.worstMonthUsd)}` : "—";
    lines.push(
      `| ${book.label} | ${book.n} | ${pct(book.winRate)} | ${usd(book.avgUsd)} | ${num(book.profitFactor)} | ${usd(book.totalUsd)} | ${usd(book.maxDrawdownUsd)} | ${book.daysRealized10} | ${book.daysMtm10} | ${worst} | ${usd(book.restartYear1.totalUsd)} | ${usd(book.restartYear2.totalUsd)} |`,
    );
  }
  return lines.join("\n");
}

const STYLE: Record<string, string> = {
  breakout: "箱の上で買う。下で待って急騰日に全部売る、という今の型とは逆。",
  pullback: "上昇中の押し目。箱の反発に近い。出口は5日線で、急騰日そのものではない。",
  midpoint: "箱の下で買って真ん中で売る。ジャブに一番近い。利幅は箱の幅次第。",
  gap: "数日で埋めにいく短期。全部売るのが早い。入口は15%線ではない。",
  oversold: "売られすぎだけを見る。下落相場で連敗しやすい。",
  momentum: "週に一度、3か月の強い順に入れ替える。毎日の$10ジャブではない。",
  spy: "口座を指数に置きっ放し。単元の$450上限は使わない（現金の置き場の比較）。",
  qqq: "口座を指数に置きっ放し。単元の$450上限は使わない。",
  soxx: "口座を指数に置きっ放し。単元の$450上限は使わない。",
};

export function renderStudyMarkdown(report: StudyReport): string {
  const base = report.base.stats;
  const adopted = report.headline.adopted.length
    ? report.headline.adopted.map((line) => `- ${line}`).join("\n")
    : "- 単因子で両年とも基準を明確に超えたものはない。基準のままが無難。";
  const chase =
    report.headline.chase === "justified"
      ? "追いかけ（25%超）を避けるラベルは、この2年では妥当。"
      : report.headline.chase === "not_justified"
        ? "追いかけ（25%超）を一律に捨てる根拠は弱い。"
        : report.headline.chase === "mixed"
          ? "追いかけの良し悪しは年によって違う。"
          : "追いかけラベルは、件数が足りず判断しない。";

  const equity = (book: Book | undefined) =>
    book ? book.equity.map((point) => `${point.month} $${point.equity.toFixed(0)}`).join("、") : "—";
  const baseBook = report.portfolio.find((book) => book.rank === "ticker");
  const broadBook = report.universes.find((book) => book.id === "broad_ticker");

  return `# 週末バックテスト（2024-10-03〜2026-10-02）

市場データの集計だけ。保有株数や口座のCSVは含まない。日足はサーバでは取っていない。

## 結論

基準（反発1日以上、終値が20日箱の15%線以上、翌日始値で買い、利確は買値+ATR14、損切りは終値がシグナル日の20日安値割れ、20営業日で期限、株数は ceil($10/ATR)、手数料往復$0.70）は **${base.n}件、勝率 ${pct(base.winRate)}、平均 $${usd(base.avgUsd)}、PF ${num(base.profitFactor)}、最大連敗 ${base.maxConsecLosses}、決済順の最大DD $${usd(base.maxDrawdownUsd)}**。1年目の平均は $${usd(report.base.year1.avgUsd)}、2年目は $${usd(report.base.year2.avgUsd)}。

${chase} ${report.headline.chaseNote}

単独で両年改善した候補（各年 n≥30、PF≥1、悪い方の年でも平均が基準より $0.05 以上高い）:

${adopted}

${report.headline.notStacked}

${report.headline.methodsNote}

過学習: ${report.headline.overfitting}

推奨は、上の候補を全部重ねることではない。まず基準を維持し、両年で改善した因子が一つだけならそれだけを足して、次の期間で崩れていないかを見る。

## 測り方

- 期間 ${report.period.from} .. ${report.period.to}（${report.period.sessions}営業日）。2年目は ${report.period.year2From} 以降のエントリー。
- 186銘柄はウォッチリストから ONDS を除いたもの。指標はシグナル日の終値まで。買いは翌始値。
- 1〜7とセクターの最大DDは、重なりを許した $10 株数の決済損益を出口日順に積んだ谷。現金口座の評価DDではない。
- 8以降のポートフォリオは初期 $${3200}、同時5件まで、1件 $300–$450 の整数株、売却代金は翌セッションまで使わない。最大DDは日次の評価額。確定$10の日は、決済があった日の確定損益合計が $10 以上の日数。評価+$10の日は、前日終値からの評価額の増加が $10 以上の日。最悪月は月末評価額の前月差が一番小さい月。やり直しは、その年の初めに現金 $${3200} から取り直した結果。

## 1. ATR%

${variationTable([report.base, ...report.variations.atr])}

## 2. エントリー帯

上の帯は、その帯だけを買うルールとして最初から取り直したもの（建玉が空くので、次のシグナルも取れる）。

${variationTable(report.variations.entry)}

下は基準ルールで実際に入ったトレードを、シグナル日の箱の位置で切った内訳。追いかけラベルの判断はこちら。

${variationTable(report.chaseSlices)}

## 3. 利確

急騰日は、終値が前日終値 + シグナル日のATR14 以上の日の終値で全部売る。同じ日に1ATRの指値に届いていれば指値が先。

${variationTable(report.variations.exit)}

## 4. 損切り

${variationTable(report.variations.stop)}

## 5. 地合い

SPYの条件は全銘柄。SOXXの条件は半導体と半導体装置だけにかかり、それ以外はそのまま。半導体だけの行は、SOXXの効きを薄めずに見るためのもの。移動平均はシグナル日の終値まで。

${variationTable(report.variations.market)}

## 6. 反発の確認日数

${variationTable(report.variations.rebound)}

## 7. 決算

日付があるシグナルだけを、前後5営業日で外す。日付が無いものは残す。対象銘柄 ${report.earnings.tickersWithDate}、日付 ${report.earnings.knownDates}、基準シグナルのうち5営業日以内 ${report.earnings.signalsWithin5}。カレンダー ${report.earnings.calendarDays} 日、取れなかった日 ${report.earnings.calendarGaps}。${report.earnings.source}

${variationTable([report.base, ...report.variations.earnings])}

## 8. ポートフォリオ（初期約$3,200）

順位は、同じ朝に枠が足りないときの並べ方。ticker はティッカー順（上手さのない基準）。atr はATR%が高い順。box は箱の位置が低い順（15%線に近い）。rs は直近20営業日のリターンがSPYを上回る順。

${bookTable(report.portfolio)}

月末評価額（ticker順）: ${equity(baseBook)}

## 9. 期間とセクター

1年目と2年目の平均は、上の各表の右二列。基準のセクター内訳（$10株数、決済済みだけ）:

${variationTable(report.sectors.filter((row) => row.stats.n > 0))}

## A. ユニバースの広さ

広い側は ${report.universe.broadListed} 銘柄が時点のS&P500とNasdaq-100（データが揃ったのは ${report.universe.broadWithData}）。シグナルの日に終値 ≤ $${report.universe.priceMax}、ATR ≥ ${report.universe.atrMin}%、半導体以外も含む。広い側だけ、直前20日の平均売買代金が $${(report.universe.dollarMin / 1e6).toFixed(0)}M 以上。流動性上位50はテスト開始前の63営業日（${report.universe.liquidNote}）。銘柄: ${report.universe.liquid50.join(", ") || "—"}。

同じ資金制約。シグナル数/週は、建玉の重なりを除く前の候補。

${bookTable(report.universes)}

月末評価額（広いユニバース・ticker順）: ${equity(broadBook)}

枠が5つしか無いので、候補を増やしても同時に持てる数は増えない。順位ルールの差が、候補の多さを使えるかどうかを見る部分。

## B. 他の手法（同じ資金制約、186銘柄）

${bookTable(report.methods)}

${report.methods.map((book) => `- **${book.label}** ${STYLE[book.id] ?? ""} 合計 $${usd(book.totalUsd)}、最大DD $${usd(book.maxDrawdownUsd)}、確定$10の日 ${book.daysRealized10}、評価+$10の日 ${book.daysMtm10}。`).join("\n")}

月末評価額（基準ポートフォリオ）は第8節。指数の保有は口座全額で、1件$450の制限はかけていない。

## 偏り

${report.biases.map((line) => `- ${line}`).join("\n")}

コアで日足が取れなかった銘柄: ${report.universe.missingCore.join(", ") || "なし"}。
`;
}
