import { formatBox } from "@/lib/format";
import { zoneOf } from "@/lib/view";
import { cn } from "@/lib/utils";

export function BoxBar({ pct }: { pct: number }) {
  const zone = zoneOf(pct);
  const clamped = Math.min(100, Math.max(0, pct));
  return (
    <div className="flex items-center gap-2">
      <div
        className="relative h-2.5 flex-1 rounded-full bg-track"
        role="img"
        aria-label={`箱の位置 ${formatBox(pct)}。左が20日安値、右が20日高値`}
      >
        <div className="absolute inset-y-0 left-0 w-1/5 rounded-l-full bg-copper-soft" />
        <div className="absolute inset-y-0 right-0 w-1/5 rounded-r-full bg-sage-soft" />
        <div
          className={cn(
            "absolute top-1/2 h-4 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full",
            zone === "bottom" && "bg-copper",
            zone === "top" && "bg-sage",
            zone === "mid" && "bg-ink",
          )}
          style={{ left: `${clamped}%` }}
        />
      </div>
      <span
        className={cn(
          "w-14 shrink-0 text-right font-mono text-sm tabular-nums",
          zone === "bottom" && "text-copper",
          zone === "top" && "text-sage",
          zone === "mid" && "text-ink",
        )}
      >
        {formatBox(pct)}
      </span>
    </div>
  );
}
