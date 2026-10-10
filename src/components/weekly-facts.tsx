import type { ReactNode } from "react";
import { BoxSpark } from "@/components/box-spark";
import { formatPx } from "@/lib/format";
import type { Quote, SoxxTag, WeeklyCall } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  WEEKLY_CALL,
  boxWeekText,
  formatUpDays,
  formatWeekChange,
  formatWeekClosePos,
  weeklyBadgeText,
  weeklySharesText,
} from "@/lib/weekly";

export function WeeklyBadge({ call }: { call: WeeklyCall }) {
  const rebound = call === WEEKLY_CALL.rebound;
  const wait = call === WEEKLY_CALL.wait;
  const avoid = call === WEEKLY_CALL.avoid;
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[10px]",
        rebound && "bg-sage-soft text-sage",
        wait && "bg-copper-soft text-copper",
        (avoid || call === WEEKLY_CALL.earnings) && "bg-rust-soft text-rust",
      )}
    >
      {weeklyBadgeText(call)}
    </span>
  );
}

export function SoxxTagChip({ tag }: { tag: SoxxTag }) {
  return <span className="rounded-full bg-chip px-2 py-0.5 text-[10px] text-muted">{tag}</span>;
}

/** Week columns, sparkline, and the stop next to the 15/25/35% lines. Sizing only — no order. */
export function WeeklyFacts({ quote }: { quote: Quote }) {
  const week = quote.weekly;
  const move = boxWeekText(week.boxPctPrev, quote.boxPct);
  const changeUp = week.weekChangePct != null && week.weekChangePct > 0;
  const changeDown = week.weekChangePct != null && week.weekChangePct < 0;
  return (
    <div className="mt-2">
      <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-[11px] min-[420px]:grid-cols-4">
        <WeekCell label="箱% 先週→今週">
          <b
            className={cn(
              "font-mono font-medium tabular-nums",
              move.direction === "up" && "text-sage",
              move.direction === "down" && "text-rust",
              (move.direction === "flat" || move.direction === "none") && "text-ink",
            )}
          >
            {move.text}
          </b>
        </WeekCell>
        <WeekCell label="週間%">
          <b
            className={cn(
              "font-mono font-medium tabular-nums",
              changeUp && "text-sage",
              changeDown && "text-rust",
              !changeUp && !changeDown && "text-ink",
            )}
          >
            {formatWeekChange(week.weekChangePct)}
          </b>
        </WeekCell>
        <WeekCell label="週の引け位置">
          <b className="font-mono font-medium text-ink tabular-nums">{formatWeekClosePos(week.weekClosePos)}</b>
        </WeekCell>
        <WeekCell label="上昇日数">
          <b className="font-mono font-medium text-ink tabular-nums">{formatUpDays(week.upDays)}</b>
        </WeekCell>
      </div>
      {week.boxPctSpark.length >= 2 && (
        <div className="mt-1.5 flex items-center gap-2">
          <span className="text-[11px] text-muted">直近{week.boxPctSpark.length}日の箱%</span>
          <BoxSpark values={week.boxPctSpark} />
        </div>
      )}
      <p className="mt-2 text-[11px] leading-relaxed text-muted">
        15%ライン ${formatPx(quote.line15)} / 25%ライン ${formatPx(quote.line25)} / 35%ライン ${formatPx(quote.line35)}
      </p>
      <p className="text-[11px] leading-relaxed text-ink">
        損切り <b className="font-mono font-medium tabular-nums">${formatPx(week.stop)}</b>
        {" · "}
        株数 <b className="font-mono font-medium tabular-nums">{weeklySharesText(week, quote.close)}</b>
      </p>
    </div>
  );
}

function WeekCell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] text-muted">{label}</div>
      <div className="break-words">{children}</div>
    </div>
  );
}
