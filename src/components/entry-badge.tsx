import { entrySignalClass, entrySignalLabel } from "@/lib/format";
import type { EntrySignal } from "@/lib/types";
import { cn } from "@/lib/utils";

export function EntryBadge({ signal, className }: { signal: EntrySignal; className?: string }) {
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[10px]", entrySignalClass(signal), className)}>
      {entrySignalLabel(signal)}
    </span>
  );
}
