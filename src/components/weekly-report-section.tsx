"use client";

import { useEffect, useState } from "react";
import paper from "../../data/backtest/paper.json";
import { formatPnl } from "@/lib/format";
import type { ClosedTrade } from "@/lib/trade-log";
import type { MarketPayload } from "@/lib/types";
import { paperHorizon, weeklyPnl } from "@/lib/weekly-report";

function ret(n: number | null): string {
  if (n == null) return "—";
  const pct = n * 100;
  const body = `${Math.abs(pct).toFixed(2)}%`;
  if (Math.abs(pct) < 0.005) return "0%";
  return pct > 0 ? `+${body}` : `−${body}`;
}

export function WeeklyReportSection({ trades }: { trades: ClosedTrade[] }) {
  const [bench, setBench] = useState<MarketPayload["weekBench"] | null>(null);
  const [benchError, setBenchError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    void fetch("/api/market", { cache: "no-store" })
      .then(async (res) => {
        const body = (await res.json()) as MarketPayload & { error?: string };
        if (!res.ok) throw new Error(body.error || "比較指数を取れなかった");
        if (!cancel) setBench(body.weekBench);
      })
      .catch((error: unknown) => {
        if (!cancel) setBenchError(error instanceof Error ? error.message : "比較指数を取れなかった");
      });
    return () => {
      cancel = true;
    };
  }, []);

  const sessions = bench?.sessions ?? [];
  const pnl = weeklyPnl(trades, sessions);
  const box = paper.books.find((book) => book.id === "box-ticker");
  const horizon = paperHorizon("box-ticker", box?.daily ?? []);

  return (
    <section className="rounded-2xl border border-line bg-elev px-3 py-3 text-[12px] leading-relaxed">
      <h2 className="text-sm font-medium">週次</h2>
      <p className="mt-1 text-[11px] text-muted">
        {bench?.from && bench.to ? `${bench.from} から ${bench.to} の終値` : "直近5営業日の終値がまだない"}。損益は手数料込みのFIFO。
      </p>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
        <dt className="text-muted">手数料込み</dt>
        <dd className="text-right font-mono tabular-nums">{sessions.length ? formatPnl(pnl.pnlAfterFees) : "—"}</dd>
        <dt className="text-muted">最大利益を除く</dt>
        <dd className="text-right font-mono tabular-nums">
          {pnl.pnlExBiggestWin == null ? "—" : formatPnl(pnl.pnlExBiggestWin)}
          {pnl.biggestWin ? <span className="text-muted"> （{pnl.biggestWin.symbol}）</span> : null}
        </dd>
        <dt className="text-muted">手数料</dt>
        <dd className="text-right font-mono tabular-nums">{sessions.length ? formatPnl(pnl.fees) : "—"}</dd>
        <dt className="text-muted">SPY</dt>
        <dd className="text-right font-mono tabular-nums">{ret(bench?.returns.SPY ?? null)}</dd>
        <dt className="text-muted">QQQ</dt>
        <dd className="text-right font-mono tabular-nums">{ret(bench?.returns.QQQ ?? null)}</dd>
        <dt className="text-muted">SOXX</dt>
        <dd className="text-right font-mono tabular-nums">{ret(bench?.returns.SOXX ?? null)}</dd>
        <dt className="text-muted">紙テスト +5日</dt>
        <dd className="text-right font-mono tabular-nums">{horizon.plus5 == null ? "足がまだない" : ret(horizon.plus5)}</dd>
        <dt className="text-muted">紙テスト +10日</dt>
        <dd className="text-right font-mono tabular-nums">{horizon.plus10 == null ? "足がまだない" : ret(horizon.plus10)}</dd>
      </dl>
      <p className="mt-2 text-[11px] text-muted">
        紙テストは data/backtest/paper.json の箱・ティッカー順。開始から5営業日と10営業日の評価額。{horizon.sessions}営業日ぶんある。
        {benchError ? ` ${benchError}` : ""}
      </p>
    </section>
  );
}
