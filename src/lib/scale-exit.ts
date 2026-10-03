export type ScaleQty = "half" | "rest" | "all";

export type ScaleAction = {
  qty: ScaleQty;
  price: number;
  timing: "open" | "intraday" | "close";
  reason: "target" | "stop" | "timeout" | "window";
};

/** Midpoint shares round down. Quantity 1 leaves the whole lot for the top. An inactive midpoint does the same. */
export function legSplit(qty: number, midActive: boolean): { halfLeft: number; restLeft: number } {
  if (!midActive || qty < 2) return { halfLeft: 0, restLeft: qty };
  const halfLeft = Math.floor(qty / 2);
  return { halfLeft, restLeft: qty - halfLeft };
}

/**
 * One session of the locked scale-out.
 * `open` is the gap check after the entry session. `rest` is the high and the close.
 * A null midpoint or top is already inactive.
 */
export function scaleActions(args: {
  phase: "open" | "rest";
  isEntryDay: boolean;
  open: number;
  high: number;
  close: number;
  entry: number;
  mid: number | null;
  top: number | null;
  stop: number | null;
  halfOpen: boolean;
  restOpen: boolean;
  timeStop: boolean;
  timeout: boolean;
}): ScaleAction[] {
  const out: ScaleAction[] = [];
  let half = args.halfOpen;
  let rest = args.restOpen;

  const sell = (qty: ScaleQty, price: number, timing: ScaleAction["timing"], reason: ScaleAction["reason"]) => {
    if (qty === "half") {
      if (!half) return;
      half = false;
    } else if (qty === "rest") {
      if (!rest) return;
      rest = false;
    } else if (half || rest) {
      half = false;
      rest = false;
    } else return;
    out.push({ qty, price, timing, reason });
  };

  if (args.phase === "open") {
    if (args.isEntryDay) return [];
    if (args.top != null && args.open >= args.top) sell("all", args.open, "open", "target");
    else if (args.mid != null && args.open >= args.mid && half) sell("half", args.open, "open", "target");
    else if (args.stop != null && args.open < args.stop) sell("all", args.open, "open", "stop");
    return out;
  }

  if (args.top != null && args.high >= args.top) {
    if (half && args.mid != null) sell("half", args.mid, "intraday", "target");
    if (rest) sell("rest", args.top, "intraday", "target");
  } else if (half && args.mid != null && args.high >= args.mid) {
    sell("half", args.mid, "intraday", "target");
  }
  if (!half && !rest) return out;
  if (args.stop != null && args.close < args.stop) sell("all", args.close, "close", "stop");
  else if (args.timeStop && args.close <= args.entry) sell("all", args.close, "close", "window");
  else if (args.timeout) sell("all", args.close, "close", "timeout");
  return out;
}

type ScaleBar = { o: number; h: number; c: number };

/** Index of the session that sells the last share. The half leg does not change that index. */
export function scaleFlatIndex(
  bars: readonly ScaleBar[],
  entryIndex: number,
  plan: {
    entry: number;
    mid: number | null;
    top: number | null;
    stop: number | null;
    timeStopIndex: number | null;
    maxHold: number;
  },
): number {
  const last = Math.min(bars.length - 1, entryIndex + plan.maxHold);
  let half = plan.mid != null;
  let rest = true;
  for (let j = entryIndex; j <= last; j += 1) {
    const bar = bars[j];
    const shared = {
      open: bar.o,
      high: bar.h,
      close: bar.c,
      entry: plan.entry,
      mid: plan.mid,
      top: plan.top,
      stop: plan.stop,
      timeStop: plan.timeStopIndex === j,
      timeout: j === entryIndex + plan.maxHold,
    };
    for (const phase of ["open", "rest"] as const) {
      const actions = scaleActions({ ...shared, phase, isEntryDay: j === entryIndex, halfOpen: half, restOpen: rest });
      for (const action of actions) {
        if (action.qty === "half") half = false;
        else if (action.qty === "rest") rest = false;
        else {
          half = false;
          rest = false;
        }
      }
      if (!half && !rest) return j;
    }
  }
  return last;
}
