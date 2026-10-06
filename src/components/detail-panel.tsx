"use client";

import { useEffect, useState, type ReactNode } from "react";
import { pastResult } from "@/lib/backtest-view";
import { BASIS, CORP_ACTION_BADGE, CORR_NOTE, TOP_BREAKOUT_NOTE, VOLUME_NOTE } from "@/lib/copy";
import { formatPe, PE_SOURCE_NOTE } from "@/lib/pe";
import {
  SEMI_CAP_BADGE,
  earningsBadge,
  formatAtr,
  formatBox,
  formatCorrExact,
  formatDev,
  formatEarnings,
  formatDollarVolume,
  formatPnl,
  formatPx,
  formatRs,
  formatShares,
  guideLineText,
  rangeRefText,
  reboundText,
  formatSlope,
  formatVolumeRatioExact,
  shortDate,
  slopeLabel,
} from "@/lib/format";
import type { ChartPayload, TickerRow } from "@/lib/types";
import { cn } from "@/lib/utils";
import { atTop, continuedBreakout, continuedBreakoutText, volumeSurge, volumeThin, zoneOf } from "@/lib/view";
import { BoxBar } from "./box-bar";
import { EntryBadge } from "./entry-badge";
import { Shares10 } from "./shares10";
import { PriceChart } from "./price-chart";
import { Button } from "./ui/button";

export function DetailPanel({
  row,
  missingTicker,
  onClose,
}: {
  row: TickerRow | null;
  missingTicker: string | null;
  onClose: () => void;
}) {
  return (
    <div className="px-4 pb-16 pt-3">
      <div className="sticky top-0 z-10 -mx-4 mb-3 flex items-center gap-2 bg-bg/95 px-4 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] backdrop-blur">
        <Button type="button" variant="outline" onClick={onClose}>
          一覧
        </Button>
        {row && (
          <span className="truncate text-sm text-muted">
            {row.sector}
            {row.sectorLabel ? ` · ${row.sectorLabel}` : ""}
          </span>
        )}
      </div>

      {!row ? (
        <p className="text-sm">
          {missingTicker ? `${missingTicker} はリストにない。` : "銘柄を選ぶと日足が出る。"}
        </p>
      ) : (
        <article>
          <header>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <h2 className="font-mono text-3xl tracking-wide">{row.ticker}</h2>
              {row.watchOnly && <Pill>監視のみ</Pill>}
              {row.pe.recovering && <Pill>利益回復中</Pill>}
              {row.quote && continuedBreakout(row.quote) && <Pill tone="rust">{continuedBreakoutText(row.quote)}</Pill>}
              {row.quote && atTop(row.quote) && !row.quote.brokeHigh && <Pill>箱の天井付近</Pill>}
              {row.quote && volumeThin(row.quote) && <Pill>薄商い</Pill>}
              {row.quote && volumeSurge(row.quote) && <Pill tone="rust">出来高急増</Pill>}
              {row.tags.map((tag) => (
                <Pill key={tag}>{tag}</Pill>
              ))}
            </div>
            <p className="mt-2 text-sm leading-relaxed">{row.description}</p>
            {row.notes && <p className="mt-1 text-sm leading-relaxed text-muted">{row.notes}</p>}
            {row.watchOnly && (
              <p className="mt-2 text-xs text-muted">
                監視のみはリストに手で付けた印。株価が下がっても、ファイルを直すまで外れない。
              </p>
            )}
          </header>

          {!row.quote ? (
            <p className="mt-6 rounded-2xl bg-rust-soft px-4 py-3 text-sm text-rust">
              {row.error}
              {row.errorDetail && row.errorDetail !== row.error && (
                <span className="mt-1 block text-xs opacity-80">{row.errorDetail}</span>
              )}
            </p>
          ) : (
            <>
              <p className="mt-5 font-mono text-4xl tabular-nums">{formatPx(row.quote.close)}</p>
              <p className="mt-1 text-xs text-muted">
                終値 {row.quote.closeDate}（{shortDate(row.quote.closeDate)}）· {BASIS.close}
              </p>
              <div className="mt-4">
                <p className="mb-1 text-xs text-muted">箱の位置</p>
                <BoxBar pct={row.quote.boxPct} />
                <p className="mt-1 text-[11px] text-muted">{BASIS.box}</p>
                <p className="mt-3 text-sm leading-relaxed">{guideLineText(row.quote.line15, row.quote.line25)}</p>
                <div className="mt-3 rounded-xl border border-line bg-elev px-3 py-2">
                  <p className="text-[11px] font-medium text-ink">参考レンジ（20日箱の補助）</p>
                  <p className="mt-1 font-mono text-sm tabular-nums text-ink">
                    {rangeRefText(row.quote.low5, row.quote.high5, row.quote.low10, row.quote.high10)}
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted">
                    {BASIS.range5} · {BASIS.range10}
                  </p>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <EntryBadge signal={row.quote.entrySignal} className="text-[11px]" />
                  <p className="text-sm">{reboundText(row.quote.reboundDays)}</p>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-muted">{BASIS.guide}</p>
              </div>
              <div className="mt-4 flex flex-wrap gap-1">
                {row.quote.brokeHigh && <Pill tone="rust">上抜け</Pill>}
                {earningsBadge(row.earnings) && <Pill tone="rust">{earningsBadge(row.earnings)}</Pill>}
                {row.semi && row.semiFull && row.quote.entrySignal === "in_ok" && !row.watchOnly && (
                  <Pill tone="rust">{SEMI_CAP_BADGE}</Pill>
                )}
                {row.quote.gapWarning && <Pill tone="rust">価格が飛んでいる</Pill>}
              {row.quote.corpActionWarning && <Pill tone="rust">{CORP_ACTION_BADGE}</Pill>}
              </div>
              <div className="mt-4 grid grid-cols-1 gap-2 min-[380px]:grid-cols-2">
                <Stat label="20日線" value={formatPx(row.quote.ma20)} basis={BASIS.ma20} />
                <Stat
                  label="20日線からの乖離"
                  value={formatDev(row.quote.devPct)}
                  basis={BASIS.dev}
                  tone={row.quote.devPct < 0 ? "rust" : row.quote.devPct > 0 ? "sage" : undefined}
                />
                <Stat
                  label="20日線の傾き"
                  value={
                    row.quote.maSlopePct == null
                      ? "—"
                      : `${formatSlope(row.quote.maSlopePct)}（${slopeLabel(row.quote.maSlopePct)}）`
                  }
                  basis={BASIS.slope}
                  tone={
                    row.quote.maSlopePct == null
                      ? undefined
                      : slopeLabel(row.quote.maSlopePct) === "下向き"
                        ? "rust"
                        : slopeLabel(row.quote.maSlopePct) === "上向き"
                          ? "sage"
                          : undefined
                  }
                />
                <Stat
                  label="対SPY"
                  value={formatRs(row.rs20)}
                  basis={BASIS.rs}
                  tone={row.rs20 == null ? undefined : row.rs20 > 0 ? "sage" : row.rs20 < 0 ? "rust" : undefined}
                />
                <Stat label="20日安値" value={formatPx(row.quote.low20)} basis={BASIS.low20} />
                <Stat label="20日高値" value={formatPx(row.quote.high20)} basis={BASIS.high20} />
                <Stat
                  label="5日レンジ"
                  value={
                    row.quote.low5 != null && row.quote.high5 != null
                      ? `$${formatPx(row.quote.low5)} – $${formatPx(row.quote.high5)}`
                      : "—"
                  }
                  basis={BASIS.range5}
                />
                <Stat
                  label="10日レンジ"
                  value={
                    row.quote.low10 != null && row.quote.high10 != null
                      ? `$${formatPx(row.quote.low10)} – $${formatPx(row.quote.high10)}`
                      : "—"
                  }
                  basis={BASIS.range10}
                />
                <Stat label="箱の位置" value={formatBox(row.quote.boxPct)} basis={BASIS.box} tone={zoneTone(row.quote.boxPct)} />
                <Stat
                  label="ATR(14)"
                  value={
                    <>
                      {formatAtr(row.quote.atr14)}
                      {" · "}
                      <Shares10 shares={row.quote.shares10} cost={row.quote.cost10} />
                    </>
                  }
                  basis={`${BASIS.atr}。${BASIS.shares10}`}
                />
                <Stat
                  label="上抜け"
                  value={row.quote.brokeHigh ? "はい" : "いいえ"}
                  basis={`${BASIS.breakout}。直前20本の高値は ${formatPx(row.quote.priorHigh20)}`}
                  tone={row.quote.brokeHigh ? "rust" : undefined}
                />
                <Stat
                  label="決算"
                  value={formatEarnings(row.earnings)}
                  basis={
                    row.earnings
                      ? `${BASIS.earnings}。${row.earnings.date}（${row.earnings.status === "confirmed" ? "日付は確定（確）" : "日付は推定"}）`
                      : "data/watchlist.yaml に決算日がない"
                  }
                  tone={row.earnings?.warn ? "rust" : undefined}
                />
                <PastStat ticker={row.ticker} />
              </div>
              {row.quote && atTop(row.quote) && (
                <p className="mt-3 text-xs leading-relaxed text-muted">{TOP_BREAKOUT_NOTE}</p>
              )}
              <VolumeBlock quote={row.quote} />
              <CorrBlock row={row} />
              {row.quote.gapWarning && (
                <p className="mt-3 text-xs leading-relaxed text-rust">
                  直近20本のあいだに、終値が前日終値から35%以上動いた日がある。分割やスピンオフの直後は箱をそのまま信じない。
                </p>
              )}
              {row.quote.corpActionWarning && (
                <p className="mt-3 text-xs leading-relaxed text-rust">
                  {CORP_ACTION_BADGE}（{row.quote.corpActionWarning.date} · 前日比{" "}
                  {row.quote.corpActionWarning.pctMove > 0 ? "+" : ""}
                  {row.quote.corpActionWarning.pctMove.toFixed(1)}%）。箱・IN OK・反発・底/天井フィルタと箱ラインアラートの対象外。
                </p>
              )}
              <PeBlock row={row} />
              <ChartBlock ticker={row.ticker} />
            </>
          )}
          {!row.quote && (
            <>
              <CorrBlock row={row} />
              <PeBlock row={row} />
            </>
          )}
        </article>
      )}
    </div>
  );
}

function PastStat({ ticker }: { ticker: string }) {
  const past = pastResult(ticker);
  return (
    <Stat
      label="この形の過去2年"
      value={
        past && past.n > 0
          ? `${past.n}回 · 勝率${Math.round((past.winRate ?? 0) * 100)}% · ${formatPnl(past.expectancyUsd ?? 0)}`
          : "—"
      }
      basis="反発して15%ライン以上で翌日始値買い、+1ATRで利確、20日安値割れで損切り。1回あたり手数料込み（過去検証タブ）"
    />
  );
}

function VolumeBlock({ quote }: { quote: TickerRow["quote"] }) {
  if (!quote) return null;
  return (
    <div className="mt-4">
      <div className="grid grid-cols-1 gap-2 min-[380px]:grid-cols-2">
        <Stat
          label="出来高"
          value={quote.volume == null ? "—" : formatShares(quote.volume)}
          basis="直近の確定日足の出来高"
        />
        <Stat
          label="出来高倍率"
          value={quote.volumeRatio == null ? "—" : formatVolumeRatioExact(quote.volumeRatio)}
          basis={
            quote.avgVolume20 == null
              ? "直前20日の平均出来高がない"
              : `直前20日平均 ${formatShares(quote.avgVolume20)}`
          }
          tone={volumeSurge(quote) ? "rust" : undefined}
        />
        <Stat
          label="20日平均売買代金"
          value={quote.avgDollarVolume20 == null ? "—" : formatDollarVolume(quote.avgDollarVolume20)}
          basis="直前20日の、終値×出来高の平均"
        />
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-muted">{VOLUME_NOTE}</p>
    </div>
  );
}

function CorrBlock({ row }: { row: TickerRow }) {
  return (
    <div className="mt-4">
      <div className="grid grid-cols-1 gap-2 min-[380px]:grid-cols-2">
        <Stat label="保有との相関" value={formatCorrExact(row.corrBasket)} basis={CORR_NOTE} />
        <Stat label="SOXXとの相関" value={formatCorrExact(row.corrSoxx)} basis="同じ60営業日の日次リターンとSOXXの相関" />
      </div>
    </div>
  );
}

function PeBlock({ row }: { row: TickerRow }) {
  return (
    <div className="mt-4">
      <div className="grid grid-cols-1 gap-2 min-[380px]:grid-cols-2">
        <Stat
          label="実績PER"
          value={formatPe(row.quote?.close, row.pe.trailingEps)}
          basis={BASIS.trailingPe}
        />
        <Stat
          label="予想PER"
          value={formatPe(row.quote?.close, row.pe.forwardEps)}
          basis={BASIS.forwardPe}
        />
      </div>
      {row.pe.recovering && (
        <p className="mt-2 text-xs leading-relaxed text-muted">{BASIS.recovering}</p>
      )}
      <p className="mt-2 text-[11px] leading-relaxed text-muted">{PE_SOURCE_NOTE}</p>
      {row.pe.error && (
        <p className="mt-1 text-[11px] leading-relaxed text-rust">
          {row.pe.error}
          {row.pe.errorDetail && row.pe.errorDetail !== row.pe.error ? `（${row.pe.errorDetail}）` : ""}
        </p>
      )}
    </div>
  );
}

function zoneTone(boxPct: number): "copper" | "sage" | undefined {
  const zone = zoneOf(boxPct);
  if (zone === "bottom") return "copper";
  if (zone === "top") return "sage";
  return undefined;
}

function Stat({
  label,
  value,
  basis,
  tone,
}: {
  label: string;
  value: ReactNode;
  basis: string;
  tone?: "sage" | "rust" | "copper";
}) {
  return (
    <div className="rounded-xl border border-line bg-elev px-3 py-2">
      <div className="text-[11px] text-muted">{label}</div>
      <div
        className={cn(
          "mt-0.5 font-mono text-base tabular-nums",
          tone === "sage" && "text-sage",
          tone === "rust" && "text-rust",
          tone === "copper" && "text-copper",
        )}
      >
        {value}
      </div>
      <p className="mt-1 text-[11px] leading-snug text-muted">{basis}</p>
    </div>
  );
}

function Pill({ children, tone }: { children: ReactNode; tone?: "rust" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px]",
        tone === "rust" ? "bg-rust-soft text-rust" : "bg-chip text-muted",
      )}
    >
      {children}
    </span>
  );
}

function ChartBlock({ ticker }: { ticker: string }) {
  const [chart, setChart] = useState<ChartPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    setChart(null);
    setError(null);
    fetch(`/api/chart/${encodeURIComponent(ticker)}`, { cache: "no-store" })
      .then(async (res) => {
        const body = (await res.json()) as ChartPayload & { error?: string };
        if (!res.ok) throw new Error(body.error || "チャートを取得できなかった");
        return body;
      })
      .then((body) => {
        if (!cancel) setChart(body);
      })
      .catch((err: unknown) => {
        if (!cancel) setError(err instanceof Error ? err.message : "チャートを取得できなかった");
      });
    return () => {
      cancel = true;
    };
  }, [ticker]);

  if (error) {
    return <p className="mt-4 text-sm text-rust">{error}</p>;
  }
  if (!chart) {
    return (
      <div className="mt-4 h-56 animate-pulse rounded-2xl bg-elev motion-reduce:animate-none" />
    );
  }
  if (chart.bars.length === 0) {
    return <p className="mt-4 text-sm text-muted">描ける日足がない。</p>;
  }
  return <PriceChart bars={chart.bars} low20={chart.low20} high20={chart.high20} />;
}
