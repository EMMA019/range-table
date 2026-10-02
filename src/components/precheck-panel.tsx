"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { entrySignalClass, entrySignalLabel, formatDollar, formatYen } from "@/lib/format";
import type { PrecheckResult } from "@/lib/precheck";
import { FLAG_TEXT, RED_FLAGS } from "@/lib/precheck-flags";
import { cn } from "@/lib/utils";

const inputClass = "h-11 w-full rounded-xl border border-line bg-bg px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-copper";

export function PrecheckPanel({ tickers }: { tickers: string[] }) {
  const [ticker, setTicker] = useState("");
  const [shares, setShares] = useState("");
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PrecheckResult | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ticker.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/precheck", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker, shares: shares || null, price: price || null }),
      });
      const body = (await response.json()) as PrecheckResult | { error: string };
      if ("error" in body) {
        setResult(null);
        setError(body.error);
      } else {
        setResult(body);
        if (!shares) setShares(String(body.shares));
      }
    } catch {
      setError("チェックできなかった");
    } finally {
      setBusy(false);
    }
  }

  const red = result?.flags.filter((flag) => RED_FLAGS.has(flag)) ?? [];
  const yellow = result?.flags.filter((flag) => !RED_FLAGS.has(flag)) ?? [];

  return (
    <section className="rounded-2xl border border-line bg-elev px-3 py-3 shadow-[var(--shadow)]">
      <h2 className="text-sm font-medium">買う前チェック</h2>
      <form onSubmit={submit} className="mt-2 grid grid-cols-[1fr_5rem_5.5rem] gap-2">
        <input
          className={inputClass}
          list="precheck-tickers"
          placeholder="ティッカー"
          autoCapitalize="characters"
          value={ticker}
          onChange={(event) => {
            setTicker(event.target.value.toUpperCase());
            setShares("");
          }}
          aria-label="ティッカー"
        />
        <input className={inputClass} inputMode="numeric" placeholder="株数" value={shares} onChange={(event) => setShares(event.target.value)} aria-label="株数" />
        <input className={inputClass} inputMode="decimal" placeholder="価格" value={price} onChange={(event) => setPrice(event.target.value)} aria-label="価格（空なら終値）" />
        <datalist id="precheck-tickers">
          {tickers.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
        <Button type="submit" className="col-span-3" disabled={busy || !ticker.trim()}>
          {busy ? "確認中…" : "チェック"}
        </Button>
      </form>
      <p className="mt-1 text-[10px] text-muted">株数が空なら$10株数、価格が空なら確定終値。注文は出さない。</p>
      {error && <p className="mt-2 text-xs text-rust">{error}</p>}
      {result && (
        <div className="mt-3 space-y-2 text-xs">
          <div className="flex flex-wrap items-center gap-1">
            <span className="font-semibold">{result.ticker}</span>
            <span className={cn("rounded-full px-2 py-0.5 text-[10px]", entrySignalClass(result.entrySignal))}>{entrySignalLabel(result.entrySignal)}</span>
            <span className="ml-auto text-muted">
              {result.shares}株 × {formatDollar(result.price)}（{result.priceBasis === "close" ? `${result.closeDate} 終値` : "入力"}）= {formatDollar(result.cost)}
            </span>
          </div>
          {red.length + yellow.length === 0 ? (
            <p className="rounded-xl bg-sage-soft px-3 py-2 text-sage">止める理由も注意点も見つからない。</p>
          ) : (
            <ul className="space-y-1">
              {red.map((flag) => (
                <li key={flag} className="rounded-xl bg-rust-soft px-3 py-2 text-rust">
                  止める理由: {FLAG_TEXT[flag]}
                </li>
              ))}
              {yellow.map((flag) => (
                <li key={flag} className="rounded-xl bg-copper-soft px-3 py-2 text-copper">
                  注意: {FLAG_TEXT[flag]}
                </li>
              ))}
            </ul>
          )}
          <p className="text-muted">
            20日安値 {formatDollar(result.lossToLow20.low20)} までの損失 {formatDollar(result.lossToLow20.usd)}
            {result.lossToLow20.jpy != null ? `（${formatYen(result.lossToLow20.jpy)}）` : ""}
            {result.lossToLow20.cushionAfterJpy != null ? ` → 防衛ラインまで ${formatYen(result.lossToLow20.cushionAfterJpy)}` : ""}
          </p>
          <p className="text-muted">
            ATR {formatDollar(result.atr14)}（{result.atrPct.toFixed(1)}%）· 約定 {result.settlement.tradeDate} → 決済 {result.settlement.settleDate}
          </p>
          {result.settlement.note && <p className="text-copper">{result.settlement.note}</p>}
          <p className="text-muted">
            買った後の比率: {result.postWeights.map((row) => `${row.ticker} ${(row.weight * 100).toFixed(0)}%`).join(" · ")}
          </p>
          {result.corr.length > 0 && (
            <p className="text-muted">
              保有との相関（60日）:{" "}
              {result.corr.map((row) => (
                <span key={row.ticker} className={cn("mr-2", row.high && "text-rust")}>
                  {row.ticker} {row.value == null ? "—" : row.value.toFixed(2)}
                </span>
              ))}
              {result.corrBasket != null ? `· 保有全体 ${result.corrBasket.toFixed(2)}` : ""}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
