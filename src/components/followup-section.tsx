import type { ReactNode } from "react";
import paperJson from "../../data/backtest/paper.json";
import robustJson from "../../data/backtest/robustness.json";
import type { PaperReport } from "@/lib/paper";
import type { Check } from "@/lib/robustness";

const paper = paperJson as PaperReport;
const robust = robustJson as {
  random: {
    trials: number;
    rsUsd: number;
    publishedUsd: number;
    percentileOfRerun: number | null;
    percentileOfPublished: number | null;
    mean: number;
    p50: number;
  };
  dropped: Array<{ ticker: string; pnlUsd: number }>;
  earnings: {
    withDate: number;
    tickers: number;
    filings: number;
    missing: string[];
    portfolio: { span: { n: number; totalUsd: number; avgUsd: number | null }; clear: { n: number; totalUsd: number; avgUsd: number | null } };
  };
  survivorship: string;
  checks: Check[];
};

const usd = (value: number | null | undefined) => (value == null ? "—" : `$${value.toFixed(2)}`);
const ratio = (value: number | null) => (value == null ? "—" : value.toFixed(2));

function Card({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-elev px-3 py-3 shadow-[var(--shadow)]">
      <h2 className="text-sm font-medium">{title}</h2>
      {note ? <p className="mt-1 text-[11px] leading-relaxed text-muted">{note}</p> : null}
      {children}
    </section>
  );
}

function CheckTable({ rows }: { rows: Check[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="mt-2 w-full min-w-[40rem] text-xs">
        <thead className="text-[10px] text-muted">
          <tr>
            {["条件", "合計", "合計/評価DD", "合計/確定DD", "年1", "年2"].map((label) => (
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
              <td className="py-1.5 text-right tabular-nums">{usd(row.totalUsd)}</td>
              <td className="py-1.5 text-right tabular-nums">{ratio(row.totalOverMtm)}</td>
              <td className="py-1.5 text-right tabular-nums">{ratio(row.totalOverRealized)}</td>
              <td className="py-1.5 text-right tabular-nums">{usd(row.year1.totalUsd)}</td>
              <td className="py-1.5 text-right tabular-nums">{usd(row.year2.totalUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Frozen paper books and the pre-registered robustness table. */
export function FollowUpSection() {
  const hash = paper.rulesCommit === "PENDING" ? "未記録" : paper.rulesCommit.slice(0, 7);
  return (
    <div className="space-y-4">
      <Card title="紙テスト" note={paper.note}>
        <p className="mt-2 text-[11px] leading-relaxed text-muted">ルールを固定したコミット {hash}</p>
        <ul className="mt-2 list-disc space-y-1 pl-4 text-[11px] leading-relaxed text-muted">
          {paper.rules.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <div className="overflow-x-auto">
          <table className="mt-2 w-full min-w-[28rem] text-xs">
            <thead className="text-[10px] text-muted">
              <tr>
                {["ブック", "件数", "合計", "評価額", "評価DD", "確定DD"].map((label) => (
                  <th key={label} className="pb-1 pr-2 text-right font-normal first:text-left">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paper.books.map((book) => (
                <tr key={book.id} className="border-t border-line">
                  <th scope="row" className="py-1.5 pr-2 text-left font-normal">
                    {book.label}
                  </th>
                  <td className="py-1.5 text-right tabular-nums">{book.n}</td>
                  <td className="py-1.5 text-right tabular-nums">{usd(book.totalUsd)}</td>
                  <td className="py-1.5 text-right tabular-nums">{usd(book.endEquity)}</td>
                  <td className="py-1.5 text-right tabular-nums">{usd(book.mtmDdUsd)}</td>
                  <td className="py-1.5 text-right tabular-nums">{usd(book.realizedDdUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title="事前に決めた確認" note="ルールは動かしていない。年1・年2は年初に $3,200 へ戻した合計。">
        <p className="mt-2 text-[11px] leading-relaxed text-muted">
          20日の対SPYは {usd(robust.random.rsUsd)}。スロットが足りない日の順位を乱数にした {robust.random.trials} 回のうち、これより小さい結果は {robust.random.percentileOfRerun ?? "—"}%。公開時の {usd(robust.random.publishedUsd)} は {robust.random.percentileOfPublished ?? "—"}%。乱数の平均 {usd(robust.random.mean)}、中央値 {usd(robust.random.p50)}。
        </p>
        <p className="mt-2 text-[11px] leading-relaxed text-muted">
          外した上位: {robust.dropped.map((row) => `${row.ticker} ${usd(row.pnlUsd)}`).join("、") || "—"}。
        </p>
        <p className="mt-2 text-[11px] leading-relaxed text-muted">
          8-K Item 2.02 は {robust.earnings.withDate}/{robust.earnings.tickers} 銘柄、{robust.earnings.filings} 件。ポートフォリオで決算をまたいだ取引 {robust.earnings.portfolio.span.n} 件・合計 {usd(robust.earnings.portfolio.span.totalUsd)}、またがない取引 {robust.earnings.portfolio.clear.n} 件・合計 {usd(robust.earnings.portfolio.clear.totalUsd)}。
        </p>
        <p className="mt-2 text-[11px] leading-relaxed text-muted">{robust.survivorship}</p>
        <CheckTable rows={robust.checks} />
      </Card>
    </div>
  );
}
