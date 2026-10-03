import type { ReactNode } from "react";
import studyJson from "../../data/backtest/study.json";
import type { Book, Row, StudyReport } from "@/lib/backtest-study";

const study = studyJson as StudyReport;

const pct = (value: number | null) => (value == null ? "—" : `${(value * 100).toFixed(1)}%`);
const usd = (value: number | null | undefined) => (value == null ? "—" : `$${value.toFixed(2)}`);

function MiniTable({ rows }: { rows: Row[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="mt-2 w-full min-w-[36rem] text-xs">
        <thead className="text-[10px] text-muted">
          <tr>
            {["ルール", "件数", "勝率", "平均", "PF", "連敗", "DD", "1年目", "2年目"].map((label) => (
              <th key={label} className="pb-1 pr-2 text-right font-normal first:text-left">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-line">
              <th scope="row" className="py-1.5 pr-2 text-left font-normal">
                {row.label}
              </th>
              <td className="py-1.5 text-right tabular-nums">{row.stats.n}</td>
              <td className="py-1.5 text-right tabular-nums">{pct(row.stats.winRate)}</td>
              <td className="py-1.5 text-right tabular-nums">{usd(row.stats.avgUsd)}</td>
              <td className="py-1.5 text-right tabular-nums">{row.stats.profitFactor ?? "—"}</td>
              <td className="py-1.5 text-right tabular-nums">{row.stats.maxConsecLosses}</td>
              <td className="py-1.5 text-right tabular-nums">{usd(row.stats.maxDrawdownUsd)}</td>
              <td className="py-1.5 text-right tabular-nums">{usd(row.year1.avgUsd)}</td>
              <td className="py-1.5 text-right tabular-nums">{usd(row.year2.avgUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BookTable({ books }: { books: Book[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="mt-2 w-full min-w-[40rem] text-xs">
        <thead className="text-[10px] text-muted">
          <tr>
            {["条件", "件数", "勝率", "平均", "PF", "合計", "DD", "$10日", "年1", "年2"].map((label) => (
              <th key={label} className="pb-1 pr-2 text-right font-normal first:text-left">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {books.map((book) => (
            <tr key={book.id} className="border-t border-line">
              <th scope="row" className="py-1.5 pr-2 text-left font-normal">
                {book.label}
              </th>
              <td className="py-1.5 text-right tabular-nums">{book.n}</td>
              <td className="py-1.5 text-right tabular-nums">{pct(book.winRate)}</td>
              <td className="py-1.5 text-right tabular-nums">{usd(book.avgUsd)}</td>
              <td className="py-1.5 text-right tabular-nums">{book.profitFactor ?? "—"}</td>
              <td className="py-1.5 text-right tabular-nums">{usd(book.totalUsd)}</td>
              <td className="py-1.5 text-right tabular-nums">{usd(book.maxDrawdownUsd)}</td>
              <td className="py-1.5 text-right tabular-nums">{book.daysRealized10}</td>
              <td className="py-1.5 text-right tabular-nums">{usd(book.restartYear1.totalUsd)}</td>
              <td className="py-1.5 text-right tabular-nums">{usd(book.restartYear2.totalUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Card({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-elev px-3 py-3 shadow-[var(--shadow)]">
      <h2 className="text-sm font-medium">{title}</h2>
      {note ? <p className="mt-1 text-[11px] leading-relaxed text-muted">{note}</p> : null}
      {children}
    </section>
  );
}

function Equity({ book }: { book: Book }) {
  const values = book.equity.map((point) => point.equity);
  const min = Math.min(3200, ...values);
  const max = Math.max(3200, ...values);
  const span = max - min || 1;
  return (
    <div className="mt-3 flex h-16 items-end gap-px" aria-label="月末の評価額">
      {book.equity.map((point) => (
        <div
          key={point.month}
          title={`${point.month} $${point.equity.toFixed(0)}`}
          className="min-w-0 flex-1 bg-copper"
          style={{ height: `${Math.max(8, ((point.equity - min) / span) * 100)}%` }}
        />
      ))}
    </div>
  );
}

/** Weekend comparison. Sits under the original one-rule summary on /backtest. */
export function StudySection() {
  const base = study.base;
  const tickerBook = study.portfolio.find((book) => book.rank === "ticker");
  const universes = study.universes.filter((book) => book.rank === "ticker" || book.rank === "rs");
  return (
    <div className="space-y-4">
      <Card title="週末の比較">
        <p className="mt-2 text-xs leading-relaxed">
          基準は {base.stats.n}件、勝率 {pct(base.stats.winRate)}、平均 {usd(base.stats.avgUsd)}、PF {base.stats.profitFactor ?? "—"}。1年目 {usd(base.year1.avgUsd)}、2年目 {usd(base.year2.avgUsd)}。最終足は {study.period.to}。
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-4 text-[11px] leading-relaxed text-muted">
          {study.headline.adopted.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="mt-2 text-[11px] leading-relaxed text-muted">{study.headline.notStacked}</p>
      </Card>
      <Card title="ATR%・入口・利確" note="DDは $10株数の決済を積んだ谷。口座の評価DDではない。">
        <MiniTable rows={[study.base, ...study.variations.atr]} />
        <MiniTable rows={study.chaseSlices} />
        <MiniTable rows={study.variations.exit} />
      </Card>
      <Card title="損切り・反発・地合い・決算">
        <MiniTable rows={study.variations.stop} />
        <MiniTable rows={study.variations.rebound} />
        <MiniTable rows={study.variations.market} />
        <MiniTable rows={study.variations.earnings} />
      </Card>
      <Card title="ポートフォリオ" note="初期$3,200、同時5件、$300–$450。年1・年2は年初にやり直した合計。$10日は確定損益が$10以上の決済日。">
        <BookTable books={study.portfolio} />
        {tickerBook ? (
          <>
            <p className="mt-2 text-[11px] text-muted">ティッカー順の月末評価額（左が2024-10）</p>
            <Equity book={tickerBook} />
          </>
        ) : null}
      </Card>
      <Card title="ユニバース" note="同じ資金制約。ticker は並べ方なし、rs は20日の対SPY相対強度。">
        <BookTable books={universes} />
      </Card>
      <Card title="他の手法" note="186銘柄、同じ資金制約。SPY/QQQ/SOXXは口座全額の買い持ち。">
        <BookTable books={study.methods} />
        <p className="mt-2 text-[11px] leading-relaxed text-muted">{study.headline.overfitting}</p>
      </Card>
    </div>
  );
}
