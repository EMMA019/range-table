import { BASIS } from "@/lib/copy";
import { formatShares10, sharesCostWarn } from "@/lib/format";
import { cn } from "@/lib/utils";

export function Shares10({
  shares,
  cost,
}: {
  shares: number | null;
  cost: number | null;
}) {
  const text = formatShares10(shares, cost);
  if (text === "—") {
    return <span title={BASIS.shares10}>—</span>;
  }
  const slash = text.indexOf(" / ");
  const count = text.slice(0, slash);
  const dollars = text.slice(slash + 3);
  return (
    <span title={BASIS.shares10}>
      {count} /{" "}
      <span className={cn(sharesCostWarn(cost) && "text-rust")}>{dollars}</span>
    </span>
  );
}
