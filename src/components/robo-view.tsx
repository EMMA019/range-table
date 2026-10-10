"use client";

import { useEffect, useMemo, useState } from "react";
import type { BudgetResult } from "@/lib/robo-backtest";
import {
  actionLabel,
  assetByTicker,
  classifyForecast,
  DEFAULT_BUDGET,
  describeSleeve,
  directionLabel,
  formatPct,
  formatShares,
  formatUsd,
  hasRoboLocal,
  loadRoboLocal,
  ROBO_DISCLAIMER,
  ROBO_UNIVERSE,
  saveRoboLocal,
  type LiveFactors,
  type SleevePosition,
} from "@/lib/robo-model";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

type Payload = {
  disclaimer: string;
  asOf: string;
  warnings: string[];
  regimeText: string;
  factors: LiveFactors;
  byBudget: BudgetResult[];
  hitText: string;
  importance: { label: string; share: number }[];
  assumptions: string[];
  limitations: string[];
  trainMonths: number;
};

const GROUP_LABEL: Record<string, string> = {
  equity: "株",
  cushion: "株のクッション",
  gold: "金",
  bond: "長めの国債",
  short: "短期債",
  tbill: "超短期債",
};

export function RoboView({ seed }: { seed: SleevePosition[] }) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [budget, setBudget] = useState(DEFAULT_BUDGET);
  const [positions, setPositions] = useState<SleevePosition[]>([]);

  useEffect(() => {
    const stored = hasRoboLocal(window.localStorage);
    const local = loadRoboLocal(window.localStorage);
    if (stored) {
      setBudget(local.budget);
      setPositions(local.positions);
    } else if (seed.length > 0) {
      setPositions(seed);
    }
    setReady(true);
  }, [seed]);

  useEffect(() => {
    if (!ready) return;
    saveRoboLocal({ budget, positions }, window.localStorage);
  }, [ready, budget, positions]);

  useEffect(() => {
    void load();
  }, []);

  const view = useMemo(() => (payload ? describeSleeve(payload.factors, budget, positions) : null), [payload, budget, positions]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/robo", { cache: "no-store" });
      const body = (await response.json()) as Payload & { error?: string };
      if (!response.ok) throw new Error(body.error || "取得できなかった");
      setPayload(body);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "取得できなかった");
    } finally {
      setLoading(false);
    }
  }

  const weights = view
    ? ROBO_UNIVERSE.map((asset) => ({
        ...asset,
        weight: view.allocation.weights[asset.ticker] ?? 0,
        price: payload?.factors.assets.find((row) => row.ticker === asset.ticker)?.price ?? null,
      })).filter((row) => row.weight >= 0.005)
    : [];
  const trades = view?.plan.lines.filter((line) => line.action !== "hold" || line.currentShares > 0 || line.weight >= 0.005) ?? [];
  const primary = payload?.byBudget.find((row) => row.budget === 1000) ?? payload?.byBudget[0];
  const large = payload?.byBudget.find((row) => row.budget === 10000);

  return (
    <div className="space-y-4">
      <p className="rounded-2xl border border-rust/40 bg-rust-soft px-3 py-3 text-sm leading-relaxed text-ink">{ROBO_DISCLAIMER} 証券口座にはつながっていない。この画面に発注ボタンはない。</p>

      {loading && !payload && <p className="text-sm text-muted">日足を取って、来月の向きを学習しています。</p>}
      {error && (
        <div className="space-y-2">
          <p className="text-sm text-rust">{error}</p>
          <Button type="button" variant="outline" onClick={() => void load()}>
            もう一度
          </Button>
        </div>
      )}

      {payload && view && (
        <>
          <section className="rounded-2xl border border-line bg-elev px-3 py-4 shadow-[var(--shadow)]">
            <p className="text-[11px] text-muted">
              {payload.asOf} の終値まで · 学習に使った月 {payload.trainMonths}
            </p>
            <p className="mt-2 text-xl font-semibold leading-snug">{view.verdict}</p>
            <p className="mt-2 text-sm leading-relaxed">{payload.regimeText}</p>
            <p className="mt-1 text-sm leading-relaxed">{view.note}</p>
            <p className="mt-1 text-sm leading-relaxed text-muted">{view.cushionNote}</p>
          </section>

          {payload.warnings.length > 0 && (
            <ul className="space-y-1 text-[11px] leading-relaxed text-copper">
              {payload.warnings.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}

          <section>
            <h2 className="mb-2 text-sm font-medium">来月の向き</h2>
            <ul className="space-y-2">
              {payload.factors.assets.map((asset) => {
                const meta = assetByTicker(asset.ticker);
                const call = classifyForecast(asset.forecast, asset.ridge, asset.gbm);
                if (meta?.group === "tbill" && (view.allocation.weights[asset.ticker] ?? 0) < 0.005 && call.direction === "flat") return null;
                return (
                  <li key={asset.ticker} className="flex items-center gap-3 rounded-2xl border border-line bg-elev px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">
                        {meta?.name ?? asset.ticker}
                        <span className="ml-2 text-[11px] font-normal text-muted">{asset.ticker}</span>
                      </p>
                      <p className="text-[11px] text-muted">{GROUP_LABEL[meta?.group ?? "equity"]}</p>
                    </div>
                    <p
                      className={cn(
                        "shrink-0 rounded-full px-3 py-1 text-sm",
                        call.direction === "up" && "bg-sage-soft text-sage",
                        call.direction === "down" && "bg-rust-soft text-rust",
                        call.direction === "flat" && "bg-chip text-muted",
                      )}
                    >
                      {directionLabel(call.direction)}
                      <span className="block text-center text-[10px]">
                        {call.confidence === "high" ? "自信 高" : call.confidence === "mid" ? "自信 中" : "自信 低"}
                      </span>
                    </p>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="rounded-2xl border border-line bg-elev px-3 py-3">
            <h2 className="text-sm font-medium">目標の内訳</h2>
            <ul className="mt-2 space-y-2">
              {weights.map((row) => (
                <li key={row.ticker}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span>
                      {row.name}
                      <span className="ml-1 text-[11px] text-muted">{row.ticker}</span>
                    </span>
                    <span className="tabular-nums">{formatPct(row.weight, 1)}</span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-track">
                    <div className="h-full rounded-full bg-copper" style={{ width: `${Math.min(100, row.weight * 100)}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="space-y-3 rounded-2xl border border-line bg-elev px-3 py-3">
            <h2 className="text-sm font-medium">今月の見直し案</h2>
            <label className="block text-[11px] text-muted" htmlFor="robo-budget">
              この枠の金額（ドル）
            </label>
            <Input
              id="robo-budget"
              inputMode="numeric"
              value={String(budget)}
              onChange={(event) => setBudget(Number(event.target.value.replace(/[^0-9.]/g, "")) || 0)}
            />
            <p className="text-[11px] leading-relaxed text-muted">
              売買 {view.plan.orders} 件。手数料の目安 {formatUsd(view.plan.commissionUsd)}（1回 $0.35）。3ポイント未満か25ドル未満はそのまま。株数は端数。
            </p>
            <GapLine budget={view.plan.budget} current={view.plan.currentUsd} />
            <ul className="space-y-2">
              {trades.map((line) => (
                <li key={line.ticker} className="border-t border-line pt-2 text-sm">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium">{line.ticker}</span>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[11px]",
                        line.action === "buy" && "bg-sage-soft text-sage",
                        line.action === "sell" && "bg-rust-soft text-rust",
                        line.action === "hold" && "bg-chip text-muted",
                      )}
                    >
                      {actionLabel(line.action)}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted">
                    今 {formatShares(line.currentShares)}株 {formatUsd(line.currentUsd)} → 目標 {formatShares(line.nextShares)}株 {formatUsd(line.price != null ? line.nextShares * line.price : line.targetUsd)}
                    {line.price != null ? ` · 終値 ${formatUsd(line.price)}` : ""}
                  </p>
                </li>
              ))}
            </ul>
            <details className="rounded-xl bg-chip px-3 py-2">
              <summary className="min-h-11 cursor-pointer text-sm leading-[2.75rem]">今の枠を入れる（この端末だけ）</summary>
              <p className="pb-2 text-[11px] leading-relaxed text-muted">株数と取得単価はサーバに送らない。個別株の保有とは混ぜない。</p>
              <div className="space-y-2 pb-2">
                {ROBO_UNIVERSE.map((asset) => {
                  const position = positions.find((row) => row.ticker === asset.ticker);
                  return (
                    <div key={asset.ticker} className="grid grid-cols-[4.5rem_1fr_1fr] items-center gap-2">
                      <span className="text-xs">{asset.ticker}</span>
                      <Input
                        aria-label={`${asset.ticker}の株数`}
                        inputMode="decimal"
                        placeholder="株数"
                        value={position ? String(position.shares) : ""}
                        onChange={(event) => updatePosition(asset.ticker, event.target.value, position?.avgCost ?? null)}
                      />
                      <Input
                        aria-label={`${asset.ticker}の取得単価`}
                        inputMode="decimal"
                        placeholder="取得単価"
                        value={position?.avgCost ?? ""}
                        onChange={(event) => updatePosition(asset.ticker, String(position?.shares ?? ""), event.target.value === "" ? null : Number(event.target.value))}
                      />
                    </div>
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-2 pb-2">
                {seed.length > 0 && (
                  <Button type="button" variant="outline" onClick={() => setPositions(seed)}>
                    サーバの枠を入れる
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setPositions([]);
                    setBudget(DEFAULT_BUDGET);
                  }}
                >
                  入力を消す
                </Button>
              </div>
            </details>
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-medium">過去の成績（学習に使っていない月）</h2>
            {primary ? (
              <>
                <p className="text-sm leading-relaxed">{primary.sentence}</p>
                <p className="text-[11px] leading-relaxed text-muted">{primary.feeNote}</p>
                <div className="grid gap-2">
                  <PerfCard label="AI枠" perf={primary.ml} />
                  <PerfCard label="ルールだけ" perf={primary.rule} />
                  <PerfCard label="SPYを持つだけ" perf={primary.spy} />
                  <PerfCard label="60/40（SPYとIEF）" perf={primary.sixtyForty} />
                </div>
                <p className="text-[11px] text-muted">
                  {primary.ml.start} 〜 {primary.ml.end} · 元手 {formatUsd(primary.budget)} · シャープは無リスク金利を0として計算
                </p>
              </>
            ) : (
              <p className="text-sm text-muted">学習月数が足りないので、成績はまだ出さない。</p>
            )}
            <p className="text-sm leading-relaxed">{payload.hitText}</p>
            {large && (
              <details className="rounded-2xl border border-line bg-elev px-3 py-2">
                <summary className="min-h-11 cursor-pointer text-sm leading-[2.75rem]">元手を1万ドルにした場合</summary>
                <p className="pb-2 text-[11px] leading-relaxed text-muted">手数料の比率が下がる。中身のルールは同じ。</p>
                <div className="grid gap-2 pb-3">
                  <PerfCard label="AI枠" perf={large.ml} />
                  <PerfCard label="ルールだけ" perf={large.rule} />
                  <PerfCard label="SPYを持つだけ" perf={large.spy} />
                  <PerfCard label="60/40（SPYとIEF）" perf={large.sixtyForty} />
                </div>
              </details>
            )}
          </section>

          <section className="rounded-2xl border border-line bg-elev px-3 py-3">
            <h2 className="text-sm font-medium">AIがよく見た材料</h2>
            <p className="mt-1 text-[11px] leading-relaxed text-muted">学習後の月で、来月のリターンを分けるときに効いた割合。大きいほどよく使った、という意味で、当たる保証ではない。</p>
            <ul className="mt-3 space-y-2">
              {payload.importance.map((row) => (
                <li key={row.label}>
                  <div className="flex justify-between gap-3 text-sm">
                    <span>{row.label}</span>
                    <span className="tabular-nums text-muted">{formatPct(row.share, 0)}</span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-track">
                    <div className="h-full rounded-full bg-ink/70" style={{ width: `${Math.min(100, row.share * 100)}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <details className="rounded-2xl border border-line bg-elev px-3 py-2">
            <summary className="min-h-11 cursor-pointer text-sm leading-[2.75rem]">やり方と限界</summary>
            <ul className="list-disc space-y-1 py-2 pl-4 text-[11px] leading-relaxed text-muted">
              {payload.assumptions.map((line) => (
                <li key={line}>{line}</li>
              ))}
              {payload.limitations.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </details>
        </>
      )}
    </div>
  );

  function updatePosition(ticker: string, sharesText: string, avgCost: number | null) {
    const shares = Number(sharesText);
    setPositions((current) => {
      const next = current.filter((row) => row.ticker !== ticker);
      if (Number.isFinite(shares) && shares > 0) {
        next.push({ ticker, shares, avgCost: avgCost != null && Number.isFinite(avgCost) && avgCost > 0 ? avgCost : null });
      }
      return next;
    });
  }
}

function GapLine({ budget, current }: { budget: number; current: number }) {
  const gap = budget - current;
  if (Math.abs(gap) < 25) return null;
  const text =
    gap > 0
      ? `目標の合計は${formatUsd(budget)}。今の評価は${formatUsd(current)}。差の${formatUsd(gap)}は、この枠に足す想定。`
      : `今の評価は目標より${formatUsd(-gap)}大きい。その分はこの枠の外に出す想定。`;
  return <p className="text-[11px] leading-relaxed text-muted">{text}</p>;
}

function PerfCard({ label, perf }: { label: string; perf: BudgetResult["ml"] }) {
  return (
    <article className="rounded-2xl border border-line bg-elev px-3 py-3">
      <h3 className="text-sm font-medium">{label}</h3>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
        <Stat k="年率" v={formatPct(perf.cagr)} />
        <Stat k="最大下落" v={formatPct(perf.maxDrawdown == null ? null : Math.abs(perf.maxDrawdown))} />
        <Stat k="値動き" v={formatPct(perf.volatility)} />
        <Stat k="シャープ" v={perf.sharpe == null ? "—" : perf.sharpe.toFixed(1)} />
        <Stat k="最悪の月" v={formatPct(perf.worstMonth)} />
        <Stat k="入れ替え" v={perf.turnover == null ? "—" : `年${formatPct(perf.turnover, 0)}`} />
      </dl>
    </article>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2 border-b border-line/70 py-1">
      <dt className="text-muted">{k}</dt>
      <dd className="tabular-nums">{v}</dd>
    </div>
  );
}
