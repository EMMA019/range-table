"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { formatDollar, formatPnl, formatPx } from "@/lib/format";
import { isIgnoredTicker } from "@/lib/holdings";
import {
  BAND_HIGH_PCT,
  BAND_LOW_PCT,
  PAPER_RISK_USD,
  PAPER_SCREEN_START,
  USUAL_COST_CAP,
  buySlot,
  entryPrice,
  excludeReasons,
  lotFlags,
  morningBuyLines,
  reboundConfirmed,
  spyFilter,
  type LineHit,
} from "@/lib/morning";
import {
  closePosition,
  daySnapshot,
  loadLedger,
  openPosition,
  saveLedger,
  unrealized,
  upsertDay,
  type PaperLedger,
  type PaperPosition,
} from "@/lib/paper-ledger";
import type { MarketPayload, TickerRow } from "@/lib/types";
import { cn } from "@/lib/utils";
import { SiteNav } from "./site-nav";
import { ThemeToggle } from "./theme-toggle";
import { Button } from "./ui/button";

const THEME_LABEL: Record<string, string> = {
  solar: "太陽光",
  crypto: "暗号",
  nuclear: "原子力",
  quantum: "量子",
};

function reasonText(reason: string): string {
  if (reason === "loss") return "赤字";
  if (reason === "aboveBox") return "箱の上";
  if (reason === "financials") return "金融";
  if (reason === "atr") return "ATR<3%";
  if (reason.startsWith("theme:")) return THEME_LABEL[reason.slice(6)] ?? "テーマ";
  return reason;
}

export function MorningView() {
  const [data, setData] = useState<MarketPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showExcluded, setShowExcluded] = useState(false);
  const [dropFinancials, setDropFinancials] = useState(true);
  const [ledger, setLedger] = useState<PaperLedger | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/market", { cache: "no-store" });
      const body = (await res.json()) as MarketPayload & { error?: string };
      if (!res.ok) throw new Error(body.error || "日足を取得できなかった");
      setData(body);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "日足を取得できなかった");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    setLedger(loadLedger(window.localStorage));
  }, [load]);

  const rows = useMemo(() => (data?.rows ?? []).filter((row) => !isIgnoredTicker(row.ticker)), [data]);
  const marks = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of rows) if (row.quote) map.set(row.ticker, row.quote.close);
    return map;
  }, [rows]);

  const persist = useCallback((next: PaperLedger) => {
    setLedger(next);
    saveLedger(next, window.localStorage);
  }, []);

  useEffect(() => {
    if (!ledger || !data?.barDate || data.barDate < PAPER_SCREEN_START) return;
    const day = daySnapshot(ledger, data.barDate, marks);
    const prev = ledger.days.find((row) => row.date === data.barDate);
    if (
      prev &&
      prev.realizedUsd === day.realizedUsd &&
      prev.unrealizedUsd === day.unrealizedUsd &&
      prev.open === day.open &&
      prev.trades === day.trades
    ) {
      return;
    }
    persist(upsertDay(ledger, day));
  }, [data?.barDate, ledger, marks, persist]);

  const spy = data?.indices.find((index) => index.ticker === "SPY")?.quote ?? null;
  const filter = spyFilter(spy ? { close: spy.close, ma20: spy.ma20 } : null);

  const cards = rows.flatMap((row) => {
    const quote = row.quote;
    if (!quote) return [];
    const lines = morningBuyLines(quote);
    if (lines.length === 0) return [];
    const reasons = excludeReasons({
      ticker: row.ticker,
      sectorId: row.sectorId,
      trailingEps: row.pe.trailingEps,
      brokeHigh: quote.brokeHigh,
      atr14: quote.atr14,
      close: quote.close,
    });
    const financials = reasons.includes("financials");
    const others = reasons.filter((reason) => reason !== "financials");
    if (financials && dropFinancials) return [];
    if (others.length > 0 && !showExcluded) return [];
    return lines.map((line) => ({
      row,
      line,
      slot: buySlot(line),
      rebound: reboundConfirmed(quote),
      reasons,
      lot: lotFlags(quote, line),
    }));
  });
  cards.sort(
    (a, b) =>
      Math.abs((a.row.quote?.boxPct ?? 0) - (a.line === "25" ? 25 : 35)) -
        Math.abs((b.row.quote?.boxPct ?? 0) - (b.line === "25" ? 25 : 35)) ||
      a.row.ticker.localeCompare(b.row.ticker) ||
      a.slot - b.slot,
  );

  function record(row: TickerRow, line: LineHit) {
    if (!ledger || !row.quote) return;
    const lot = lotFlags(row.quote, line);
    if (lot.shares == null || lot.shares < 1) return;
    const next = openPosition(ledger, {
      ticker: row.ticker,
      line,
      entry: entryPrice(row.quote, line),
      shares: lot.shares,
      stop: row.quote.low20,
      target: row.quote.high20,
      openedOn: row.quote.closeDate,
    });
    if (next) persist(next);
  }

  function flatten(position: PaperPosition) {
    if (!ledger || !data?.barDate) return;
    const mark = marks.get(position.ticker);
    if (mark == null) return;
    const next = closePosition(ledger, position.id, mark, data.barDate);
    if (next) persist(next);
  }

  return (
    <div className="mx-auto min-h-dvh w-full max-w-lg">
      <header className="sticky top-0 z-20 border-b border-line bg-bg/95 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur">
        <div className="flex items-center gap-3 pb-2">
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold leading-none tracking-tight">今朝</h1>
            <p className="mt-1 truncate text-[11px] text-muted">
              紙テスト {PAPER_SCREEN_START} から
              {data?.barDate ? ` · 終値 ${data.barDate}` : ""}
            </p>
          </div>
          <ThemeToggle />
          <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            更新
          </Button>
        </div>
        <SiteNav current="/" />
      </header>

      <main className="space-y-4 px-4 py-4 pb-[max(2rem,env(safe-area-inset-bottom))]">
        <section className="rounded-2xl border border-line bg-elev px-3 py-3 text-sm leading-relaxed">
          <p>1銘柄につき買いは2回まで。1回目は25%線、2回目は35%線（箱の位置が{BAND_LOW_PCT}〜{BAND_HIGH_PCT}%）。反発の確認は不要。参考として「反発あり」を出す。</p>
          <p className="mt-1">利確は箱の高値で、持っている株を一度に全部。</p>
          <p className="mt-1 text-[11px] text-muted">
            損切りは箱の安値。株数は ${PAPER_RISK_USD} ÷（入り − 安値）と ${USUAL_COST_CAP} ÷ 入り の小さい方。$450が株数を決めたときは「$450上限」と、その株数での損切り損を出す。1株が $450 を超えるときは、代金と $550 の印をこれまで通り出す。
          </p>
        </section>

        <section className="rounded-2xl border border-line bg-elev px-3 py-3">
          <h2 className="text-sm font-medium">SPYの20日線</h2>
          <p className="mt-1 text-sm">
            {filter === "on" && "オン。終値は20日線以上。"}
            {filter === "off" && "オフ。終値は20日線の下。"}
            {filter === "unknown" && "今日の20日線はまだ出ていない。"}
          </p>
          {spy && (
            <p className="mt-1 font-mono text-xs tabular-nums text-muted">
              {formatPx(spy.close)} / 20日線 {formatPx(spy.ma20)} · {spy.closeDate}
            </p>
          )}
        </section>

        {error && <p className="rounded-xl bg-rust-soft px-3 py-2 text-xs text-rust">{error}</p>}
        {loading && !data && <p className="text-sm text-muted">日足を集めています。</p>}

        <section>
          <div className="flex items-end justify-between gap-3">
            <h2 className="text-sm font-medium">今日の買い候補</h2>
            <p className="text-[11px] text-muted">{cards.length}件</p>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-muted">
            終値の箱の位置が{BAND_LOW_PCT}〜{BAND_HIGH_PCT}%（25〜35%帯±2pt）。各線から±{2}ポイント以内ならその線のカード。線に近い順。
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              aria-pressed={dropFinancials}
              onClick={() => setDropFinancials((value) => !value)}
              className={cn("h-11 rounded-full border px-3 text-sm", dropFinancials ? "border-ink bg-ink text-bg" : "border-line bg-elev")}
            >
              金融を外す
            </button>
            <button
              type="button"
              aria-pressed={showExcluded}
              onClick={() => setShowExcluded((value) => !value)}
              className={cn("h-11 rounded-full border px-3 text-sm", showExcluded ? "border-ink bg-ink text-bg" : "border-line bg-elev")}
            >
              除外を表示
            </button>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-muted">
            金融はウォッチリストの「金融」。初期状態では候補から外す。赤字は過去12か月EPSがマイナスの銘柄で、SPCXは残す。箱の上、原子力、暗号、太陽光、量子、ATRが終値の3%未満は除外。ATRは詳細のATR(14)を終値で割ったもの。量子は Emma の指定（IONQ、RGTI、QBTS、QUBT、ARQQ）。
          </p>
          <ul className="mt-3 space-y-2">
            {cards.map(({ row, line, slot, rebound, reasons, lot }) => {
              const grey = reasons.length > 0;
              const taken = ledger?.positions.some((position) => position.ticker === row.ticker && position.line === line) ?? false;
              return (
                <li key={`${row.ticker}-${line}`} className={cn("rounded-2xl border border-line bg-elev px-3 py-3", grey && "opacity-60")}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-base font-medium">{row.ticker}</span>
                      <span className="rounded-full bg-chip px-2 py-0.5 text-[10px] text-ink">{slot === 1 ? "1回目" : "2回目"}</span>
                      {rebound && <span className="rounded-full border border-line px-2 py-0.5 text-[10px] text-muted">反発あり</span>}
                      {lot.flags.capBinding && (
                        <span className="rounded-full bg-chip px-2 py-0.5 text-[10px] text-ink">$450上限</span>
                      )}
                    </span>
                    <span className="font-mono text-sm tabular-nums">{row.quote ? formatPx(row.quote.close) : "—"}</span>
                  </div>
                  <p className="mt-1 text-[11px] text-muted">{row.sector} · 箱 {row.quote ? row.quote.boxPct.toFixed(1) : "—"}%</p>
                  <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[12px]">
                    <dt className="text-muted">入り</dt>
                    <dd className="text-right font-mono tabular-nums">{line}%線 {row.quote ? formatPx(entryPrice(row.quote, line)) : "—"}</dd>
                    <dt className="text-muted">損切り</dt>
                    <dd className="text-right font-mono tabular-nums">箱の安値 {row.quote ? formatPx(row.quote.low20) : "—"}</dd>
                    <dt className="text-muted">株数</dt>
                    <dd className="text-right font-mono tabular-nums">{lot.shares ?? "—"}</dd>
                    <dt className="text-muted">代金</dt>
                    <dd className="text-right font-mono tabular-nums">{lot.cost == null ? "—" : formatDollar(lot.cost)}</dd>
                    {lot.flags.capBinding && lot.maxLoss != null && (
                      <>
                        <dt className="text-muted">損切り損</dt>
                        <dd className="text-right font-mono tabular-nums">{formatDollar(lot.maxLoss)}</dd>
                      </>
                    )}
                  </dl>
                  {(lot.flags.overCost || lot.flags.overPrice || lot.flags.oneShareTooWide) && (
                    <p className="mt-2 text-[11px] leading-relaxed text-rust">
                      {lot.flags.overCost ? `代金が $${USUAL_COST_CAP} を超える。 ` : ""}
                      {lot.flags.overPrice ? "1株が $550 以上。 " : ""}
                      {lot.flags.oneShareTooWide ? "1株でも損が $30 を超える。" : ""}
                    </p>
                  )}
                  {grey && (
                    <p className="mt-2 text-[11px] text-muted">{reasons.map(reasonText).join(" · ")}</p>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    className="mt-3 w-full"
                    disabled={grey || taken || lot.shares == null || lot.shares < 1 || !ledger}
                    onClick={() => record(row, line)}
                  >
                    {taken ? `${slot}回目は記録済み` : "紙に記録"}
                  </Button>
                </li>
              );
            })}
          </ul>
          {data && cards.length === 0 && <p className="mt-3 text-sm text-muted">今、線の上にいる候補はない。</p>}
        </section>

        <section>
          <h2 className="text-sm font-medium">紙の建玉</h2>
          <p className="mt-1 text-[11px] leading-relaxed text-muted">
            この端末のブラウザにだけ保存する。実口座は HOLDINGS_JSON。凍結した4ブックは data/backtest/paper.json。どちらにも書き込まない。損益は終値との差で、手数料は含まない。
          </p>
          {!ledger || ledger.positions.length === 0 ? (
            <p className="mt-2 text-sm text-muted">{PAPER_SCREEN_START} からの建玉はまだない。</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {ledger.positions.map((position) => {
                const mark = marks.get(position.ticker);
                const pnl = unrealized(position, mark);
                return (
                  <li key={position.id} className="rounded-2xl border border-line bg-elev px-3 py-3 text-[12px]">
                    <div className="flex items-baseline justify-between">
                      <span className="font-mono text-base font-medium">{position.ticker}</span>
                      <span className={cn("font-mono tabular-nums", pnl != null && pnl < 0 && "text-rust", pnl != null && pnl > 0 && "text-sage")}>
                        {pnl == null ? "—" : formatPnl(pnl)}
                      </span>
                    </div>
                    <dl className="mt-2 grid grid-cols-2 gap-y-1">
                      <dt className="text-muted">入り</dt>
                      <dd className="text-right font-mono tabular-nums">{formatPx(position.entry)} · {position.line}% · {position.shares}株</dd>
                      <dt className="text-muted">損切り</dt>
                      <dd className="text-right font-mono tabular-nums">{formatPx(position.stop)}</dd>
                      <dt className="text-muted">利確</dt>
                      <dd className="text-right font-mono tabular-nums">箱の高値 {formatPx(position.target)}</dd>
                    </dl>
                    <Button type="button" variant="outline" className="mt-3 w-full" disabled={mark == null} onClick={() => flatten(position)}>
                      終値で全部決済
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section>
          <h2 className="text-sm font-medium">日次の記録</h2>
          <p className="mt-1 text-[11px] text-muted">その日の実現損益、終値での含み損益、建玉数、売買回数。</p>
          {!ledger || ledger.days.length === 0 ? (
            <p className="mt-2 text-sm text-muted">{PAPER_SCREEN_START} 以降の終値日に、この画面を開くと1行残る。</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {[...ledger.days].reverse().map((day) => (
                <li key={day.date} className="rounded-2xl border border-line bg-elev px-3 py-3 text-[12px]">
                  <p className="font-mono">{day.date}</p>
                  <p className="mt-1">実現 {formatPnl(day.realizedUsd)} · 含み {formatPnl(day.unrealizedUsd)}</p>
                  <p className="text-muted">建玉 {day.open} · 売買 {day.trades}</p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="text-[11px] leading-relaxed text-muted">
          ATR、$10の株数、相関、決算、SPYの強さは <Link href="/range" className="underline">詳細</Link> にある。読み取り専用で、注文は出さない。
        </p>
      </main>
    </div>
  );
}
