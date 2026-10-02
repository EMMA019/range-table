"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CHIPS, SORT_OPTIONS, type ChipKey, type SortId } from "@/lib/copy";
import { formatPe } from "@/lib/pe";
import {
  earningsBadge,
  formatAge,
  formatDev,
  formatAtr,
  formatCompactShares,
  formatCorr,
  formatPx,
  formatVolumeRatio,
  guideLineText,
  reboundText,
  shortDate,
  slopeLabel,
} from "@/lib/format";
import type { MarketPayload, TickerRow } from "@/lib/types";
import { cn } from "@/lib/utils";
import { applyView, atTop, continuedBreakout, continuedBreakoutText, sectorsOf, volumeSurge, volumeThin, withDividers, zoneOf, type ViewFilters } from "@/lib/view";
import { BoxBar } from "./box-bar";
import { Shares10 } from "./shares10";
import { DetailPanel } from "./detail-panel";
import { Glossary } from "./glossary";
import { SiteNav } from "./site-nav";
import { ThemeToggle } from "./theme-toggle";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

const SORTS = new Set<string>(SORT_OPTIONS.map((option) => option.id));

const CHIP_PARAM: Record<ChipKey, string> = {
  bottom: "bottom",
  top: "top",
  breakout: "breakout",
  continued: "cont",
  surge: "surge",
  earnings: "earn",
  lowCorr: "lowcorr",
  rebound: "rebound",
  hideWatch: "hideWatch",
};

export function Dashboard() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [query, setQuery] = useState("");
  const [data, setData] = useState<MarketPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const openedHere = useRef(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
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
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setNow(Date.now());
      if (data && Date.now() - data.fetchedAt >= data.ttlMs) void load(true);
    }, 30_000);
    const onVis = () => {
      if (document.visibilityState === "visible") void load(true);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [data, load]);

  const filters = useMemo<ViewFilters>(() => {
    const sort = sp.get("sort");
    return {
      sector: sp.get("g") || "all",
      bottom: sp.get("bottom") === "1",
      top: sp.get("top") === "1",
      breakout: sp.get("breakout") === "1",
      continued: sp.get("cont") === "1",
      surge: sp.get("surge") === "1",
      earnings: sp.get("earn") === "1",
      lowCorr: sp.get("lowcorr") === "1",
      rebound: sp.get("rebound") === "1",
      hideWatch: sp.get("hideWatch") === "1",
      sort: SORTS.has(sort ?? "") ? (sort as SortId) : "boxAsc",
      q: query,
    };
  }, [sp, query]);

  const ticker = sp.get("t");

  const commit = useCallback(
    (patch: Record<string, string | null>, history: "push" | "replace") => {
      const next = new URLSearchParams(sp.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (!value) next.delete(key);
        else next.set(key, value);
      }
      const qs = next.toString();
      const url = qs ? `${pathname}?${qs}` : pathname;
      if (history === "push") router.push(url, { scroll: false });
      else router.replace(url, { scroll: false });
    },
    [pathname, router, sp],
  );

  const openTicker = (symbol: string) => {
    openedHere.current = true;
    commit({ t: symbol }, "push");
  };

  const closeTicker = () => {
    if (openedHere.current) {
      openedHere.current = false;
      router.back();
      return;
    }
    commit({ t: null }, "replace");
  };

  useEffect(() => {
    if (!ticker) openedHere.current = false;
  }, [ticker]);

  useEffect(() => {
    if (!ticker) return;
    const mq = window.matchMedia("(min-width: 1024px)");
    if (mq.matches) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [ticker]);

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const visible = useMemo(() => applyView(rows, filters), [rows, filters]);
  const items = useMemo(() => withDividers(visible, filters.sort), [visible, filters.sort]);
  const sectors = useMemo(() => sectorsOf(rows), [rows]);
  const selected = rows.find((row) => row.ticker === ticker) ?? null;
  const filtersOn =
    filters.sector !== "all" ||
    filters.bottom ||
    filters.top ||
    filters.breakout ||
    filters.continued ||
    filters.surge ||
    filters.earnings ||
    filters.lowCorr ||
    filters.rebound ||
    filters.hideWatch ||
    query.trim().length > 0;

  function toggleChip(key: ChipKey) {
    const param = CHIP_PARAM[key];
    commit({ [param]: sp.get(param) === "1" ? null : "1" }, "replace");
  }

  function clearFilters() {
    setQuery("");
    commit(
      {
        g: null,
        bottom: null,
        top: null,
        breakout: null,
        cont: null,
        surge: null,
        earn: null,
        lowcorr: null,
        rebound: null,
        hideWatch: null,
        sort: null,
      },
      "replace",
    );
  }

  const sortLabel = SORT_OPTIONS.find((option) => option.id === filters.sort)?.label ?? "箱の底から";

  return (
    <div className="mx-auto min-h-dvh w-full max-w-lg lg:grid lg:h-dvh lg:max-w-6xl lg:grid-cols-[26rem_minmax(0,1fr)] lg:overflow-hidden">
      <div className="lg:h-dvh lg:overflow-y-auto lg:border-r lg:border-line">
        <header className="sticky top-0 z-20 border-b border-line bg-bg/95 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur">
          <div className="flex items-center gap-3 pb-2">
            <RangeMark />
            <div className="min-w-0 flex-1">
              <h1 className="text-lg font-semibold leading-none tracking-tight">レンジ表</h1>
              <p className="mt-1 truncate text-[11px] text-muted">
                {data?.barDate ? `終値日 ${data.barDate}` : "終値日 —"}
                {data ? ` · ${formatAge(data.fetchedAt, now)}` : ""}
              </p>
            </div>
            <ThemeToggle />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void load(false)}
              disabled={refreshing || loading}
            >
              {refreshing ? "取得中" : "更新"}
            </Button>
          </div>
          <SiteNav current="/" />
          <div className="flex flex-wrap gap-2 pb-3">
            {CHIPS.map((chip) => {
              const on = filters[chip.key];
              return (
                <button
                  key={chip.key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleChip(chip.key)}
                  className={cn(
                    "h-11 shrink-0 rounded-full border px-3 text-sm",
                    on ? "border-ink bg-ink text-bg" : "border-line bg-elev text-ink",
                  )}
                >
                  {chip.label}
                </button>
              );
            })}
          </div>
        </header>

        <div className="space-y-3 px-4 py-3">
          {data && (
            <div className="grid grid-cols-3 gap-2">
              {data.indices.map((index) => (
                <IndexCell key={index.ticker} ticker={index.ticker} quote={index.quote} error={index.error} />
              ))}
            </div>
          )}
          {data?.excludedPartial && (
            <p className="text-xs leading-relaxed text-muted">
              米国市場の場中なので、未確定の当日足は除き、直前の確定日足で計算している。
            </p>
          )}
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="ティッカー・説明"
            aria-label="ティッカー・説明で絞り込む"
            autoComplete="off"
            enterKeyHint="search"
          />
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-[11px] text-muted">
              セクター
              <select
                className="mt-1 h-11 w-full rounded-xl border border-line bg-elev px-2 text-base text-ink"
                value={filters.sector}
                onChange={(event) =>
                  commit({ g: event.target.value === "all" ? null : event.target.value }, "replace")
                }
              >
                <option value="all">すべて {rows.length}</option>
                {sectors.map((sector) => (
                  <option key={sector.id} value={sector.id}>
                    {sector.name} {sector.count}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-[11px] text-muted">
              並び
              <select
                className="mt-1 h-11 w-full rounded-xl border border-line bg-elev px-2 text-base text-ink"
                value={filters.sort}
                onChange={(event) =>
                  commit(
                    { sort: event.target.value === "boxAsc" ? null : event.target.value },
                    "replace",
                  )
                }
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex items-center justify-between gap-3 text-xs text-muted">
            <p>
              {data ? `${visible.length} / ${rows.length}銘柄` : "銘柄"} · {sortLabel}
            </p>
            {filtersOn && (
              <button type="button" className="min-h-11 text-ink underline-offset-2 hover:underline" onClick={clearFilters}>
                条件を外す
              </button>
            )}
          </div>
        </div>

        {error && !data && (
          <div className="mx-4 rounded-2xl bg-rust-soft px-4 py-4 text-sm text-rust">
            <p>{error}</p>
            <Button type="button" className="mt-3" variant="outline" onClick={() => void load(false)}>
              再取得
            </Button>
          </div>
        )}
        {error && data && (
          <p className="mx-4 mb-3 rounded-xl bg-rust-soft px-3 py-2 text-xs text-rust">{error}</p>
        )}
        {data && data.failCount > 0 && (
          <p className="mx-4 mb-3 rounded-xl bg-rust-soft px-3 py-2 text-xs leading-relaxed text-rust">
            {data.failCount}銘柄は日足を取れなかった。一覧の下に理由がある。
          </p>
        )}

        {loading && !data && (
          <div className="space-y-2 px-4">
            <p className="text-sm text-muted">全銘柄の日足を取っています。初回は数十秒かかることがある。</p>
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="h-28 animate-pulse rounded-2xl bg-elev motion-reduce:animate-none" />
            ))}
          </div>
        )}

        {data && visible.length === 0 && (
          <div className="mx-4 rounded-2xl border border-line bg-elev px-4 py-6 text-sm">
            <p>この条件の銘柄はない。</p>
            <Button type="button" variant="outline" className="mt-3" onClick={clearFilters}>
              条件を外す
            </Button>
          </div>
        )}

        <ul className="space-y-2 px-4 pb-4">
          {items.map((item) =>
            item.type === "divider" ? (
              <li key={item.id} className="px-1 pt-3 text-[11px] font-medium tracking-wide text-muted">
                {item.label}
              </li>
            ) : (
              <li key={item.row.ticker}>
                <TickerCard
                  row={item.row}
                  selected={item.row.ticker === ticker}
                  onOpen={openTicker}
                />
              </li>
            ),
          )}
        </ul>

        <div className="space-y-4 px-4 pb-[max(2rem,env(safe-area-inset-bottom))]">
          <Glossary />
          <footer className="text-[11px] leading-relaxed text-muted">
            <p>読み取り専用。証券口座にはつながっていない。注文は出さない。</p>
            <p className="mt-1">{data?.source ?? "価格は米ドル。日足から計算する。"}</p>
            <p className="mt-1">15分より頻繁には取りにいかない。銘柄の追加と削除は data/watchlist.yaml。</p>
          </footer>
        </div>
      </div>

      <aside
        className={cn(
          ticker
            ? "fixed inset-0 z-40 overflow-y-auto bg-bg lg:static lg:z-auto lg:h-dvh lg:overflow-y-auto lg:bg-transparent"
            : "hidden lg:block lg:h-dvh lg:overflow-y-auto",
        )}
      >
        {ticker ? (
          <DetailPanel row={selected} missingTicker={selected ? null : ticker} onClose={closeTicker} />
        ) : (
          <div className="px-8 py-10">
            <h2 className="text-xl font-semibold">銘柄を選ぶ</h2>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-muted">
              箱の位置は、直近20本の安値から高値までのどこに終値があるか。0%が底、100%が天井。底で買い、天井で全部売る見方のための表。
            </p>
            <Glossary className="mt-6" />
          </div>
        )}
      </aside>
    </div>
  );
}

export function DashboardFallback() {
  return (
    <div className="mx-auto min-h-dvh w-full max-w-lg px-4 pt-6">
      <h1 className="text-lg font-semibold">レンジ表</h1>
      <div className="mt-3">
        <SiteNav current="/" />
      </div>
      <p className="text-sm text-muted">日足を集めています。</p>
      <div className="mt-4 space-y-2">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="h-28 animate-pulse rounded-2xl bg-elev motion-reduce:animate-none" />
        ))}
      </div>
    </div>
  );
}

function RangeMark() {
  return (
    <span className="relative h-3 w-8 shrink-0 rounded-full bg-track" aria-hidden>
      <span className="absolute left-[22%] top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-copper" />
    </span>
  );
}

function IndexCell({
  ticker,
  quote,
  error,
}: {
  ticker: string;
  quote: MarketPayload["indices"][number]["quote"];
  error: string | null;
}) {
  const dev = quote ? quote.devPct : 0;
  return (
    <div className="rounded-xl border border-line bg-elev px-2 py-2">
      <div className="text-[11px] text-muted">{ticker}</div>
      {quote ? (
        <>
          <div className="font-mono text-sm tabular-nums">{formatPx(quote.close)}</div>
          <div className="text-[10px] text-muted">終値 {shortDate(quote.closeDate)}</div>
          <div
            className={cn(
              "mt-1 font-mono text-sm tabular-nums",
              dev < 0 && "text-rust",
              dev > 0 && "text-sage",
            )}
          >
            {formatDev(quote.devPct)}
          </div>
          <div className="text-[10px] leading-tight text-muted">20日線から</div>
        </>
      ) : (
        <p className="mt-1 text-[11px] text-rust">{error ?? "取得失敗"}</p>
      )}
    </div>
  );
}

function TickerCard({
  row,
  selected,
  onOpen,
}: {
  row: TickerRow;
  selected: boolean;
  onOpen: (ticker: string) => void;
}) {
  const quote = row.quote;
  const zone = quote ? zoneOf(quote.boxPct) : null;
  const badges = [
    quote?.brokeHigh ? "上抜け" : null,
    earningsBadge(row.earnings),
    row.watchOnly ? "監視のみ" : null,
    quote?.gapWarning ? "価格が飛んでいる" : null,
    row.tags.includes("高ボラ") ? "高ボラ" : null,
    row.pe.recovering ? "利益回復中" : null,
    quote && continuedBreakout(quote) ? continuedBreakoutText(quote) : null,
    quote && atTop(quote) && !quote.brokeHigh ? "箱の天井付近" : null,
    quote && volumeThin(quote) ? "薄商い" : null,
    quote && volumeSurge(quote) ? "出来高急増" : null,
  ].filter((badge): badge is string => Boolean(badge));

  return (
    <button
      type="button"
      onClick={() => onOpen(row.ticker)}
      aria-pressed={selected}
      className={cn(
        "w-full rounded-2xl border border-line bg-elev px-3 py-3 text-left shadow-[var(--shadow)]",
        "border-l-4",
        zone === "bottom" && "border-l-copper",
        zone === "top" && "border-l-sage",
        zone === "mid" && "border-l-line",
        !quote && "border-l-rust",
        selected && "ring-2 ring-copper",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-mono text-base font-medium tracking-wide">{row.ticker}</span>
            <span className="text-[11px] text-muted">
              {row.sector}
              {row.sectorLabel ? ` · ${row.sectorLabel}` : ""}
            </span>
          </div>
          {badges.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {badges.map((badge) => (
                <span
                  key={badge}
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10px]",
                    badge === "監視のみ" ||
                    badge === "高ボラ" ||
                    badge === "利益回復中" ||
                    badge === "箱の天井付近" ||
                    badge === "薄商い"
                      ? "bg-chip text-muted"
                      : "bg-rust-soft text-rust",
                  )}
                >
                  {badge}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="text-right">
          <div className="font-mono text-lg tabular-nums">{quote ? formatPx(quote.close) : "—"}</div>
          <div className="text-[11px] text-muted">{quote ? `終値 ${shortDate(quote.closeDate)}` : "終値"}</div>
        </div>
      </div>
      {quote ? (
        <>
          <div className="mt-2">
            <div className="mb-1 text-[11px] text-muted">箱の位置</div>
            <BoxBar pct={quote.boxPct} />
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-muted">{guideLineText(quote.line15, quote.line25)}</p>
          <p className="text-[11px] text-ink">{reboundText(quote.reboundDays)}</p>
          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-muted">
            <span>
              20日線{" "}
              <b
                className={cn(
                  "font-mono font-medium tabular-nums",
                  quote.devPct < 0 && "text-rust",
                  quote.devPct > 0 && "text-sage",
                  quote.devPct === 0 && "text-ink",
                )}
              >
                {formatDev(quote.devPct)}
              </b>
              {quote.maSlopePct != null && (
                <>
                  {" "}
                  <b
                    className={cn(
                      "font-medium",
                      slopeLabel(quote.maSlopePct) === "下向き" && "text-rust",
                      slopeLabel(quote.maSlopePct) === "上向き" && "text-sage",
                    )}
                  >
                    {slopeLabel(quote.maSlopePct)}
                  </b>
                </>
              )}
            </span>
            <span>
              ATR(14) <b className="font-mono font-medium text-ink tabular-nums">{formatAtr(quote.atr14)}</b>
              {" · "}
              <b className="font-mono font-medium text-ink tabular-nums">
                <Shares10 shares={quote.shares10} cost={quote.cost10} />
              </b>
            </span>
            <span>
              20日安値 <b className="font-mono font-medium text-ink tabular-nums">{formatPx(quote.low20)}</b>
            </span>
            <span>
              20日高値 <b className="font-mono font-medium text-ink tabular-nums">{formatPx(quote.high20)}</b>
            </span>
          </div>
        </>
      ) : (
        <p className="mt-2 text-sm text-rust">
          {row.error}
          {row.errorDetail && row.errorDetail !== row.error ? `（${row.errorDetail}）` : ""}
        </p>
      )}
      <p className="mt-2 text-[11px] leading-snug text-muted">
        実績PER{" "}
        <b className="font-mono font-medium text-ink tabular-nums">
          {formatPe(quote?.close, row.pe.trailingEps)}
        </b>
        {" / "}
        予想PER{" "}
        <b className="font-mono font-medium text-ink tabular-nums">
          {formatPe(quote?.close, row.pe.forwardEps)}
        </b>
        {row.pe.error && <span className="text-rust"> · {row.pe.error}</span>}
        {quote && (
          <>
            {" · "}
            出来高{" "}
            <b className="font-mono font-medium text-ink tabular-nums">
              {quote.volumeRatio == null ? "—" : formatVolumeRatio(quote.volumeRatio)}
            </b>{" "}
            <b className="font-mono font-medium text-ink tabular-nums">
              {quote.volume == null ? "—" : formatCompactShares(quote.volume)}
            </b>
          </>
        )}
      </p>
      <p className="mt-1 text-[11px] text-muted">
        相関 保有
        <b className="font-mono font-medium text-ink tabular-nums">{formatCorr(row.corrBasket)}</b>
        {" / SOXX"}
        <b className="font-mono font-medium text-ink tabular-nums">{formatCorr(row.corrSoxx)}</b>
      </p>
    </button>
  );
}
