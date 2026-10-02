import type { AlertItem, AlertPriority } from "@/lib/alerts";
import { cn } from "@/lib/utils";

const PRIORITY_LABEL: Record<AlertPriority, string> = {
  critical: "最重要",
  high: "要確認",
  normal: "参考",
  low: "低",
};

const PRIORITY_CLASS: Record<AlertPriority, string> = {
  critical: "bg-rust text-bg",
  high: "bg-rust-soft text-rust",
  normal: "bg-chip text-ink",
  low: "bg-chip text-muted",
};

const FLAG_LABEL: Record<string, string> = {
  no_earnings_date: "決算日未登録",
  price_over_450: "1株$450超",
  stale_data: "前回の日足",
  amended: "訂正",
};

export function AlertCards({ items }: { items: AlertItem[] }) {
  return (
    <div className="space-y-3">
      {items.map((item) => (
        <article key={item.id} className="rounded-2xl border border-line bg-elev px-3 py-3 shadow-[var(--shadow)]">
          <div className="flex flex-wrap items-center gap-1">
            <span className={cn("rounded-full px-2 py-0.5 text-[10px]", PRIORITY_CLASS[item.priority])}>
              {PRIORITY_LABEL[item.priority]}
            </span>
            {item.flags.map((flag) => (
              <span key={flag} className="rounded-full bg-chip px-2 py-0.5 text-[10px] text-muted">
                {FLAG_LABEL[flag] ?? flag}
              </span>
            ))}
            <span className="ml-auto text-[11px] text-muted">{item.eventAtJst}</span>
          </div>
          <h2 className="mt-2 text-sm font-medium leading-snug">{item.title}</h2>
          <p className="mt-1 whitespace-pre-line text-[11px] leading-relaxed text-muted">{item.body}</p>
          {item.url && (
            <a
              href={item.url}
              className="mt-2 inline-flex min-h-11 items-center text-xs text-ink underline underline-offset-2"
              target={item.url.startsWith("http") ? "_blank" : undefined}
              rel="noreferrer"
            >
              {item.url.includes("sec.gov") ? "EDGARで開く" : "詳細"}
            </a>
          )}
        </article>
      ))}
    </div>
  );
}
