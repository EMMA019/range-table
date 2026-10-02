import type { HoldingsView } from "@/lib/holdings-view";
import { entrySignalClass, entrySignalLabel, formatDollar, formatPnl, formatYen, shortDate } from "@/lib/format";
import { cn } from "@/lib/utils";

function pct(n: number | null, digits = 1): string {
  return n == null ? "—" : `${n >= 0 ? "" : "−"}${Math.abs(n).toFixed(digits)}%`;
}

function tone(n: number | null): string {
  return n == null ? "" : n > 0 ? "text-sage" : n < 0 ? "text-rust" : "";
}

export function AccountCard({ view }: { view: HoldingsView }) {
  const a = view.account;
  const cushionTone = a.cushionJpy == null ? "" : a.cushionJpy < 0 ? "text-rust" : "text-sage";
  return (
    <section className="rounded-2xl border border-line bg-elev px-3 py-3 shadow-[var(--shadow)]">
      <h2 className="text-[11px] text-muted">円建て口座</h2>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{a.accountJpy == null ? "—" : formatYen(a.accountJpy)}</p>
      <p className="mt-0.5 text-[11px] leading-relaxed text-muted">
        株 {formatDollar(a.stockUsd)} + ドル現金 {formatDollar(a.cashSettledUsd + a.cashUnsettledUsd)}
        {a.usdJpy != null ? ` × ${a.usdJpy.toFixed(2)}円（${a.usdJpyDate ? shortDate(a.usdJpyDate) : ""}）` : ""} + 円現金 {formatYen(a.jpyCash)}
      </p>
      {a.defenseLineJpy != null && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-chip px-3 py-2">
            <p className="text-[11px] text-muted">防衛ラインまで</p>
            <p className={cn("mt-0.5 font-mono text-base tabular-nums", cushionTone)}>{a.cushionJpy == null ? "—" : formatYen(a.cushionJpy)}</p>
            <p className="text-[10px] text-muted">{pct(a.cushionPct)}</p>
          </div>
          <div className="rounded-xl bg-chip px-3 py-2">
            <p className="text-[11px] text-muted">全保有が見直しラインまで下がったら</p>
            <p className={cn("mt-0.5 font-mono text-base tabular-nums", tone(a.cushionAtReviewJpy))}>
              {a.cushionAtReviewJpy == null ? "—" : formatYen(a.cushionAtReviewJpy)}
            </p>
            <p className="text-[10px] text-muted">防衛ラインまでの残り</p>
          </div>
        </div>
      )}
      {a.unsettled.length > 0 && (
        <ul className="mt-3 space-y-0.5 text-[11px] text-muted">
          {a.unsettled.map((item) => (
            <li key={`${item.settleDate}:${item.amountUsd}`}>
              未決済 {formatDollar(item.amountUsd)} · {item.settleDate} 決済{item.settled ? "（済）" : ""}
            </li>
          ))}
        </ul>
      )}
      {a.unpriced.length > 0 && <p className="mt-2 text-[11px] text-rust">日足が無く合計に入っていない: {a.unpriced.join(" ")}</p>}
    </section>
  );
}

export function HoldingCards({ view }: { view: HoldingsView }) {
  if (view.rows.length === 0) return <p className="text-sm text-muted">保有が登録されていない。</p>;
  return (
    <ul className="space-y-2">
      {view.rows.map((row) => (
        <li key={row.ticker} className="rounded-2xl border border-line bg-elev px-3 py-3 shadow-[var(--shadow)]">
          <div className="flex items-center gap-2">
            <span className="text-base font-semibold">{row.ticker}</span>
            {row.entrySignal && (
              <span className={cn("rounded-full px-2 py-0.5 text-[10px]", entrySignalClass(row.entrySignal))}>{entrySignalLabel(row.entrySignal)}</span>
            )}
            {row.earnings?.warn && <span className="rounded-full bg-rust-soft px-2 py-0.5 text-[10px] text-rust">決算{row.earnings.tradingDays ?? 0}営業日</span>}
            {row.stale && <span className="rounded-full bg-chip px-2 py-0.5 text-[10px] text-muted">前回の日足</span>}
            <span className="ml-auto text-xs tabular-nums text-muted">{row.weight == null ? "" : `${(row.weight * 100).toFixed(0)}%`}</span>
          </div>
          {row.close == null ? (
            <p className="mt-1 text-xs text-rust">{row.error}</p>
          ) : (
            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              <p className="text-muted">
                終値 <span className="font-mono text-ink">{formatDollar(row.close)}</span>
                {row.closeDate ? `（${shortDate(row.closeDate)}）` : ""}
              </p>
              <p className="text-muted">
                評価 <span className="font-mono text-ink">{formatDollar(row.value ?? 0)}</span> · {row.shares}株
              </p>
              <p className="text-muted">
                含み <span className={cn("font-mono", tone(row.unrealizedUsd))}>{row.unrealizedUsd == null ? "—" : formatPnl(row.unrealizedUsd)}</span>
                {row.unrealizedPct != null ? `（${pct(row.unrealizedPct)}）` : ""}
              </p>
              <p className="text-muted">
                1ATR <span className="font-mono text-ink">{row.dollarsPerAtr == null ? "—" : formatDollar(row.dollarsPerAtr)}</span>
              </p>
              <p className="col-span-2 text-muted">
                見直しライン{" "}
                {row.reviewLine == null ? (
                  "未設定"
                ) : (
                  <>
                    <span className="font-mono text-ink">{formatDollar(row.reviewLine)}</span> まで{" "}
                    <span className={cn("font-mono", row.toReviewAtr != null && row.toReviewAtr < 1 ? "text-rust" : "text-ink")}>
                      {pct(row.toReviewPct)} · {row.toReviewAtr == null ? "—" : `${row.toReviewAtr.toFixed(1).replace("-", "−")} ATR`}
                    </span>
                  </>
                )}
              </p>
            </div>
          )}
          {row.note && <p className="mt-1 text-[11px] text-muted">{row.note}</p>}
        </li>
      ))}
    </ul>
  );
}
