import Link from "next/link";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/", label: "レンジ表" },
  { href: "/picks", label: "チーム注目" },
] as const;

export function SiteNav({ current }: { current: "/" | "/picks" }) {
  return (
    <nav aria-label="ページ" className="flex gap-2 pb-3">
      {TABS.map((tab) => {
        const on = tab.href === current;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={on ? "page" : undefined}
            className={cn(
              "flex h-11 items-center rounded-full border px-3 text-sm",
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
