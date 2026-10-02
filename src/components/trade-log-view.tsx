"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { backupOf, loadFills, readBackup, saveFills } from "@/lib/fill-store";
import { formatDollar, formatPnl, shortDate } from "@/lib/format";
import type { Fill } from "@/lib/ibkr-parse";
import { parseIbkrStatement } from "@/lib/ibkr-parse";
import { buildTradeLog, DAY_TARGET_USD, mergeFills } from "@/lib/trade-log";
import { cn } from "@/lib/utils";

type Notice = { tone: "ok" | "warn"; lines: string[] };

const TRADE_PAGE = 50;

function pct(n: number | null): string {
  return n == null ? "—" : `${Math.round(n * 100)}%`;
}

function pnlClass(n: number): string {
  return n > 0 ? "text-sage" : n < 0 ? "text-rust" : "text-muted";
}

export function TradeLogView() {
  const [fills, setFills] = useState<Fill[] | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [shown, setShown] = useState(TRADE_PAGE);
  const csvInput = useRef<HTMLInputElement>(null);
  const jsonInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setFills(loadFills());
  }, []);

  const log = useMemo(() => (fills ? buildTradeLog(fills) : null), [fills]);

  function store(next: Fill[]) {
    saveFills(next);
    setFills(next);
  }

  async function importCsv(files: FileList | null) {
    if (!files || files.length === 0 || !fills) return;
    let current = fills;
    const lines: string[] = [];
    let tone: Notice["tone"] = "ok";
    for (const file of Array.from(files)) {
      const report = parseIbkrStatement(await file.text());
      if (!report.format) {
        tone = "warn";
        lines.push(`${file.name}: ${report.warnings.join(" ")}`);
        continue;
      }
      const merged = mergeFills(current, report.fills);
      current = merged.fills;
      const kind = report.format === "activity" ? "アクティビティ" : "取引履歴";
      const parts = [`新規 ${merged.added}件`, `既存と同じ ${merged.duplicates}件`];
      if (merged.overlapSkipped) parts.push(`別形式で取り込み済みの日 ${merged.overlapSkipped}件`);
      lines.push(`${file.name}（${kind}）: ${parts.join(" / ")}`);
      if (report.skipped.length) lines.push(`読み飛ばし: ${report.skipped.map((row) => `${row.reason} ${row.count}`).join("、")}`);
      lines.push(...report.warnings);
    }
    store(current);
    setNotice({ tone, lines });
    if (csvInput.current) csvInput.current.value = "";
  }

  function exportJson() {
    if (!fills) return;
    const blob = new Blob([JSON.stringify(backupOf(fills), null, 1)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `range-table-fills-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function importJson(files: FileList | null) {
    const file = files?.[0];
    if (!file || !fills) return;
    try {
      const backup = readBackup(await file.text());
      const merged = mergeFills(fills, backup.fills);
      store(merged.fills);
      setNotice({
        tone: backup.rejected ? "warn" : "ok",
        lines: [`JSONから ${merged.added}件を戻した（既存と同じ ${merged.duplicates}件）${backup.rejected ? ` / 形式違い ${backup.rejected}件` : ""}`],
      });
    } catch (error) {
      setNotice({ tone: "warn", lines: [error instanceof Error ? error.message : "JSONを読めなかった"] });
    }
    if (jsonInput.current) jsonInput.current.value = "";
  }

  function clearAll() {
    if (!window.confirm("この端末に保存した約定を全部消す？")) return;
    store([]);
    setNotice({ tone: "ok", lines: ["全部消した"] });
  }

  if (!fills || !log) return <p className="pt-6 text-sm text-muted">読み込み中…</p>;
  const { kpi } = log;
  const recentDays = kpi.byDay.slice(-60);

  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <input
          ref={csvInput}
          type="file"
          accept=".csv,text/csv"
          multiple
          className="sr-only"
          id="csv-input"
          onChange={(event) => void importCsv(event.target.files)}
        />
        <Button className="w-full" onClick={() => csvInput.current?.click()}>
          IBKRのCSVを選ぶ
        </Button>
        <p className="text-[11px] leading-relaxed text-muted">
          アクティビティ・ステートメント（日本語・英語）か取引履歴のCSV。この端末のブラウザ内だけで読み、サーバには送らない。保存するのは約定（銘柄・日時・数量・価格・手数料）だけで、口座番号やCSVそのものは残さない。
        </p>
        {notice && (
          <div
            role="status"
            className={cn(
              "rounded-xl border px-3 py-2 text-[11px] leading-relaxed",
              notice.tone === "ok" ? "border-line bg-elev text-ink" : "border-rust bg-rust-soft text-rust",
            )}
          >
            {notice.lines.map((line, index) => (
              <p key={index}>{line}</p>
            ))}
          </div>
        )}
      </section>

      {fills.length === 0 ? (
        <p className="pt-2 text-sm leading-relaxed text-muted">まだ約定がない。CSVを選ぶと、勝率・1回平均・合計・$10達成日がここに出る。</p>
      ) : (
        <>
          <section className="grid grid-cols-2 gap-2">
            <Kpi label="勝率" value={pct(kpi.winRate)} sub={`${kpi.wins}勝 / ${kpi.trades}回`} />
            <Kpi label="1回平均" value={kpi.avgPnl == null ? "—" : formatPnl(kpi.avgPnl)} tone={kpi.avgPnl ?? 0} sub="手数料込み" />
            <Kpi label="合計" value={formatPnl(kpi.totalPnl)} tone={kpi.totalPnl} sub={`手数料 ${formatDollar(kpi.totalFees)}`} />
            <Kpi
              label={`$${DAY_TARGET_USD}達成日`}
              value={`${kpi.days10.hit} / ${kpi.days10.tradingDays}`}
              sub="決済があった日のうち"
            />
          </section>

          {log.warnings.length + kpi.reconcile.length > 0 && (
            <section className="space-y-1 rounded-xl border border-line bg-elev px-3 py-2 text-[11px] leading-relaxed text-muted">
              {log.warnings.map((line) => (
                <p key={line}>{line}</p>
              ))}
              {kpi.reconcile.map((row) => (
                <p key={row.symbol}>
                  {row.symbol}: 計算 {formatPnl(row.ours)} / IBKR {formatPnl(row.ibkr)}（差あり）
                </p>
              ))}
            </section>
          )}

          <section>
            <h2 className="mb-2 text-sm font-medium">日別（直近{recentDays.length}日・米国の取引日）</h2>
            <div className="flex flex-wrap gap-1">
              {recentDays.map((day) => (
                <div
                  key={day.date}
                  title={`${day.date} ${formatPnl(day.pnl)}（${day.trades}回）`}
                  className={cn(
                    "flex h-11 w-11 flex-col items-center justify-center rounded-lg text-[9px] leading-tight",
                    day.pnl >= DAY_TARGET_USD ? "bg-sage-soft text-sage" : day.pnl < 0 ? "bg-rust-soft text-rust" : "bg-chip text-muted",
                  )}
                >
                  <span>{shortDate(day.date)}</span>
                  <span className="font-medium">{Math.round(day.pnl)}</span>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="mb-2 text-sm font-medium">銘柄別</h2>
            <ul className="divide-y divide-line rounded-xl border border-line bg-elev">
              {kpi.bySymbol.map((row) => (
                <li key={row.symbol} className="flex items-center justify-between px-3 py-2 text-xs">
                  <span className="font-medium">{row.symbol}</span>
                  <span className="text-muted">{row.trades}回</span>
                  <span className={cn("w-24 text-right tabular-nums", pnlClass(row.pnl))}>{formatPnl(row.pnl)}</span>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="mb-2 text-sm font-medium">トレード（新しい順）</h2>
            <ul className="divide-y divide-line rounded-xl border border-line bg-elev">
              {log.trades.slice(0, shown).map((trade) => (
                <li key={trade.id} className="px-3 py-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">
                      {trade.symbol}
                      {trade.basis === "ibkr" && <span className="ml-1 text-[10px] text-muted">IBKR値</span>}
                    </span>
                    <span className={cn("tabular-nums", pnlClass(trade.pnl))}>{formatPnl(trade.pnl)}</span>
                  </div>
                  <div className="mt-0.5 flex justify-between text-[11px] text-muted">
                    <span>
                      {shortDate(trade.openDate)}→{shortDate(trade.closeDate)}（{trade.holdDays}日）· {trade.qty}株
                    </span>
                    <span>手数料 {formatDollar(trade.fees)}</span>
                  </div>
                </li>
              ))}
            </ul>
            {log.trades.length > shown && (
              <Button variant="outline" className="mt-2 w-full" onClick={() => setShown((value) => value + TRADE_PAGE)}>
                もっと見る（残り{log.trades.length - shown}件）
              </Button>
            )}
          </section>

          {log.open.length > 0 && (
            <section>
              <h2 className="mb-1 text-sm font-medium">ログ上の未決済</h2>
              <p className="mb-2 text-[11px] text-muted">取り込んだ約定だけから計算。期間より前の買いは入らない。</p>
              <ul className="divide-y divide-line rounded-xl border border-line bg-elev">
                {log.open.map((lot) => (
                  <li key={lot.symbol} className="flex items-center justify-between px-3 py-2 text-xs">
                    <span className="font-medium">{lot.symbol}</span>
                    <span className="text-muted">
                      {lot.qty}株 · {shortDate(lot.since)}から
                    </span>
                    <span className="tabular-nums">{formatDollar(lot.cost)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      <section className="space-y-2 border-t border-line pt-4">
        <p className="text-[11px] text-muted">保存先はこの端末のブラウザ（{fills.length}件）。機種変更の前にJSONで保存しておく。</p>
        <div className="grid grid-cols-3 gap-2">
          <Button variant="outline" size="sm" onClick={exportJson} disabled={fills.length === 0}>
            JSONで保存
          </Button>
          <input
            ref={jsonInput}
            type="file"
            accept=".json,application/json"
            className="sr-only"
            onChange={(event) => void importJson(event.target.files)}
          />
          <Button variant="outline" size="sm" onClick={() => jsonInput.current?.click()}>
            JSONから戻す
          </Button>
          <Button variant="ghost" size="sm" className="text-rust" onClick={clearAll} disabled={fills.length === 0}>
            全部消す
          </Button>
        </div>
      </section>
    </div>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: number }) {
  return (
    <div className="rounded-2xl border border-line bg-elev px-3 py-3 shadow-[var(--shadow)]">
      <p className="text-[11px] text-muted">{label}</p>
      <p className={cn("mt-1 text-lg font-semibold tabular-nums", tone != null && pnlClass(tone))}>{value}</p>
      <p className="mt-0.5 text-[10px] text-muted">{sub}</p>
    </div>
  );
}
