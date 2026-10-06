import type { Quote } from "@/lib/types";
import { cn } from "@/lib/utils";

const STYLE: Record<Quote["verdict"]["state"], string> = {
  見送り: "bg-rust-soft text-rust border border-rust/30",
  待ち: "bg-copper-soft text-copper border border-copper/30",
  候補: "bg-sage-soft text-sage border border-sage/30",
};

/** Large monitoring verdict beside the price (not a buy recommendation). */
export function CardVerdict({ verdict, className }: { verdict: Quote["verdict"]; className?: string }) {
  return (
    <div className={cn("mb-1", className)}>
      <div
        className={cn(
          "inline-block rounded-lg px-2.5 py-1 text-sm font-semibold leading-none tracking-tight",
          STYLE[verdict.state],
        )}
      >
        {verdict.state}
      </div>
      <p className="mt-1 max-w-[11rem] text-[10px] leading-snug text-muted">{verdict.reason}</p>
    </div>
  );
}
