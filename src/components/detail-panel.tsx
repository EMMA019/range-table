"use client";

import { useEffect, useState, type ReactNode } from "react";
import { BASIS } from "@/lib/copy";
import { formatPe, PE_SOURCE_NOTE } from "@/lib/pe";
import {
  earningsBadge,
  formatAtr,
  formatBox,
  formatDev,
  formatEarnings,
  formatPx,
  shortDate,
} from "@/lib/format";
import type { ChartPayload, TickerRow } from "@/lib/types";
import { cn } from "@/lib/utils";
import { zoneOf } from "@/lib/view";
import { BoxBar } from "./box-bar";
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
        {row && <span className="truncate text-sm text-muted">{row.sector}</span>}
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
              </div>
              <div className="mt-4 flex flex-wrap gap-1">
                {row.quote.brokeHigh && <Pill tone="rust">上抜け</Pill>}
                {earningsBadge(row.earnings) && <Pill tone="rust">{earningsBadge(row.earnings)}</Pill>}
                {row.quote.gapWarning && <Pill tone="rust">価格が飛んでいる</Pill>}
              </div>
              <div className="mt-4 grid grid-cols-1 gap-2 min-[380px]:grid-cols-2">
                <Stat label="20日線" value={formatPx(row.quote.ma20)} basis={BASIS.ma20} />
                <Stat
                  label="20日線からの乖離"
                  value={formatDev(row.quote.devPct)}
                  basis={BASIS.dev}
                  tone={row.quote.devPct < 0 ? "rust" : row.quote.devPct > 0 ? "sage" : undefined}
                />
                <Stat label="20日安値" value={formatPx(row.quote.low20)} basis={BASIS.low20} />
                <Stat label="20日高値" value={formatPx(row.quote.high20)} basis={BASIS.high20} />
                <Stat label="箱の位置" value={formatBox(row.quote.boxPct)} basis={BASIS.box} tone={zoneTone(row.quote.boxPct)} />
                <Stat label="ATR(14)" value={formatAtr(row.quote.atr14)} basis={BASIS.atr} />
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
                      ? `${BASIS.earnings}。${row.earnings.status === "confirmed" ? "日付は確定（確）" : "日付は推定"}`
                      : "data/watchlist.yaml に決算日がない"
                  }
                  tone={row.earnings?.warn ? "rust" : undefined}
                />
              </div>
              {row.quote.gapWarning && (
                <p className="mt-3 text-xs leading-relaxed text-rust">
                  直近20本のあいだに、終値が前日終値から35%以上動いた日がある。分割やスピンオフの直後は箱をそのまま信じない。
                </p>
              )}
              <PeBlock row={row} />
              <ChartBlock ticker={row.ticker} />
            </>
          )}
          {!row.quote && <PeBlock row={row} />}
        </article>
      )}
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
  value: string;
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
