import { ALERT_MIN_ATR_PCT } from "@/lib/constants";
import { atrPctOfPrice, formatDollar } from "@/lib/format";
import { cn } from "@/lib/utils";

/** ATR(14) in dollars plus percent of close, e.g. $0.62 (2.9%). Percent ≥3% uses sage (jab entry threshold). */
export function Atr14Value({
  atr14,
  close,
  className,
}: {
  atr14: number;
  close: number;
  className?: string;
}) {
  const pct = atrPctOfPrice(atr14, close);
  return (
    <span className={className}>
      <span className="font-mono font-medium tabular-nums text-ink">{formatDollar(atr14)}</span>
      {pct != null && (
        <span
          className={cn(
            "font-mono font-medium tabular-nums",
            pct >= ALERT_MIN_ATR_PCT ? "text-sage" : "text-ink",
          )}
        >
          {" "}
          ({pct.toFixed(1)}%)
        </span>
      )}
    </span>
  );
}
