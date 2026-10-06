import { cn } from "@/lib/utils";

/** Compact second line under a ticker: company name · GICS sector (optional sub-industry on sm+). */
export function TickerMetaLine({
  name,
  sector,
  industry,
  className,
}: {
  name: string;
  sector: string;
  industry?: string | null;
  className?: string;
}) {
  const head = [name, sector].filter((part) => part.trim().length > 0);
  if (head.length === 0) return null;
  return (
    <p className={cn("truncate text-[11px] leading-snug text-muted", className)}>
      {head.join(" · ")}
      {industry ? <span className="hidden sm:inline">{` · ${industry}`}</span> : null}
    </p>
  );
}
