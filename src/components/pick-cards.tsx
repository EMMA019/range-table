import { BoxBar } from "@/components/box-bar";
import { EntryBadge } from "@/components/entry-badge";
import { Shares10 } from "@/components/shares10";
import {
  PICK_DISTANCE_NOTE,
  PICK_ENTRY_BADGE,
  PICK_WATCH_BADGE,
} from "@/lib/copy";
import {
  earningsBadge,
  formatAtr,
  formatDev,
  formatEarnings,
  formatPx,
  formatRs,
  formatVolumeRatio,
  guideLineText,
  reboundText,
  shortDate,
} from "@/lib/format";
import type { PickCard } from "@/lib/types";
import { cn } from "@/lib/utils";
import { TickerMetaLine } from "@/components/ticker-meta-line";

export function PickCards({ picks }: { picks: PickCard[] }) {
  return (
    <div className="space-y-3">
      <p className="text-[11px] leading-relaxed text-muted">{PICK_DISTANCE_NOTE}</p>
      {picks.map((pick, index) => (
        <PickCardView key={`${pick.ticker}-${index}`} pick={pick} />
      ))}
    </div>
  );
}

function PickCardView({ pick }: { pick: PickCard }) {
  const quote = pick.quote;
  const badges = [
    pick.entryZone ? PICK_ENTRY_BADGE : null,
    pick.watchOnly ? PICK_WATCH_BADGE : null,
    earningsBadge(pick.earnings),
  ].filter((badge): badge is string => Boolean(badge));

  return (
    <article className="rounded-2xl border border-line bg-elev px-3 py-3 shadow-[var(--shadow)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <h2 className="font-mono text-base font-medium">{pick.ticker}</h2>
          </div>
          <TickerMetaLine name={pick.name} sector={pick.sector} industry={pick.industry} className="mt-0.5" />
          {pick.genre && <p className="mt-0.5 text-[11px] text-muted">{pick.genre}</p>}
          {(quote || badges.length > 0) && (
            <div className="mt-1 flex flex-wrap gap-1">
              {quote && <EntryBadge signal={quote.entrySignal} />}
              {badges.map((badge) => (
                <span
                  key={badge}
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10px]",
                    badge === PICK_WATCH_BADGE ? "bg-chip text-muted" : "bg-rust-soft text-rust",
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
        <div className="mt-3 space-y-2">
          <BoxBar pct={quote.boxPct} />
          <p className="text-[11px] leading-relaxed text-muted">{guideLineText(quote.line15, quote.line25)}</p>
          <p className="text-[11px] text-ink">{reboundText(quote.reboundDays)}</p>
          <p className="text-[11px] text-muted">{formatEarnings(pick.earnings)}</p>
          <p className="text-[11px] text-muted">
            対SPY <b className="font-mono font-medium tabular-nums text-ink">{formatRs(pick.rs20)}</b>
          </p>
          <p className="text-[11px] text-muted">
            ATR(14) <b className="font-mono font-medium text-ink tabular-nums">{formatAtr(quote.atr14)}</b>
            {" · "}
            <b className="font-mono font-medium text-ink tabular-nums">
              <Shares10 shares={quote.shares10} cost={quote.cost10} />
            </b>
          </p>
          <p className="text-[11px] text-muted">
            20日安値 {formatPx(quote.low20)} · 高値 {formatPx(quote.high20)}
            {quote.volumeRatio != null ? ` · 出来高 ${formatVolumeRatio(quote.volumeRatio)}` : ""}
          </p>
        </div>
      ) : (
        <>
          <p className="mt-2 text-[11px] text-muted">{formatEarnings(pick.earnings)}</p>
          <p className="mt-3 text-sm text-muted">{pick.error ?? "日足がまだない"}</p>
        </>
      )}

      <dl className="mt-3 space-y-2 text-sm">
        <Line
          label="エントリー"
          price={pick.entryLine}
          distance={pick.entryDistancePct}
          basis={pick.entryBasis}
        />
        <Line
          label="見直し"
          price={pick.reviewLine}
          distance={pick.reviewDistancePct}
          basis={pick.reviewBasis}
        />
      </dl>

      {pick.thesisFacts && (
        <p className="mt-3 text-sm leading-relaxed">
          <span className="text-muted">事実 </span>
          {pick.thesisFacts}
        </p>
      )}
      {pick.thesisHypothesis && (
        <p className="mt-1 text-sm leading-relaxed">
          <span className="text-muted">仮説 </span>
          {pick.thesisHypothesis}
        </p>
      )}
      <p className="mt-3 text-[11px] text-muted">
        {pick.recommendedBy}
        {pick.asOf ? ` · ${pick.asOf}` : ""}
      </p>
    </article>
  );
}

function Line({
  label,
  price,
  distance,
  basis,
}: {
  label: string;
  price: number;
  distance: number | null;
  basis: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <dt className="text-muted">
          {label} <span className="font-mono tabular-nums text-ink">{formatPx(price)}</span>
        </dt>
        <dd className="font-mono tabular-nums">{distance == null ? "—" : formatDev(distance)}</dd>
      </div>
      {basis && <p className="text-[11px] leading-relaxed text-muted">{basis}</p>}
    </div>
  );
}
