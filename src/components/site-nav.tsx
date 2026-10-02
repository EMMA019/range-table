import Link from "next/link";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/", label: "レンジ表" },
  { href: "/picks", label: "チーム注目" },
  { href: "/alerts", label: "アラート" },
  { href: "/log", label: "取引ログ" },
] as const;

export type NavPath = (typeof TABS)[number]["href"];

export function SiteNav({ current }: { current: NavPath }) {
  return (
    <nav aria-label="ページ" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-3 [scrollbar-width:none]">
      {TABS.map((tab) => {
        const on = tab.href === current;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={on ? "page" : undefined}
            className={cn(
              "flex h-11 shrink-0 items-center rounded-full border px-3 text-sm",
              on ? "border-ink bg-ink text-bg" : "border-line bg-elev text-ink",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
