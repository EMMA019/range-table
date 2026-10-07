import type { ClosedTrade } from "./trade-log";

export type WeekBench = {
  from: string | null;
  to: string | null;
  sessions: string[];
  returns: { SPY: number | null; QQQ: number | null; SOXX: number | null };
};

export type WeeklyPnl = {
  pnlAfterFees: number;
  fees: number;
  pnlExBiggestWin: number | null;
  biggestWin: { symbol: string; pnl: number } | null;
  trades: number;
};

export type PaperHorizon = {
  bookId: string;
  plus5: number | null;
  plus10: number | null;
  sessions: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;

/** Last `n` session dates and the close-to-close return over that span. */
export function weekBench(
  series: Record<string, Array<{ date: string; c: number }> | undefined>,
  n = 5,
): WeekBench {
  const spy = series.SPY ?? [];
  const sessions = spy.slice(-n).map((bar) => bar.date);
  const from = sessions.length >= 2 ? sessions[0] : null;
  const to = sessions.at(-1) ?? null;
  return {
    from,
    to,
    sessions,
    returns: {
      SPY: spanReturn(series.SPY, n),
      QQQ: spanReturn(series.QQQ, n),
      SOXX: spanReturn(series.SOXX, n),
    },
  };
}

function spanReturn(bars: Array<{ date: string; c: number }> | undefined, n: number): number | null {
  if (!bars || bars.length < n + 1) return null;
  const end = bars[bars.length - 1].c;
  const start = bars[bars.length - 1 - n].c;
  if (!(start > 0) || !Number.isFinite(end)) return null;
  return round4(end / start - 1);
}

/** Realized P/L for trades closed on the benchmark window. FIFO pnl is already after fees. */
export function weeklyPnl(trades: ClosedTrade[], sessions: string[]): WeeklyPnl {
  const days = new Set(sessions);
  const week = trades.filter((trade) => days.has(trade.closeDate));
  const pnlAfterFees = round2(week.reduce((sum, trade) => sum + trade.pnl, 0));
  const fees = round2(week.reduce((sum, trade) => sum + trade.fees, 0));
  const wins = week.filter((trade) => trade.pnl > 0);
  const biggest = wins.reduce<ClosedTrade | null>((best, trade) => (best == null || trade.pnl > best.pnl ? trade : best), null);
  const pnlExBiggestWin = biggest == null ? null : round2(pnlAfterFees - biggest.pnl);
  return {
    pnlAfterFees,
    fees,
    pnlExBiggestWin,
    biggestWin: biggest ? { symbol: biggest.symbol, pnl: biggest.pnl } : null,
    trades: week.length,
  };
}

/**
 * Equity change from the first paper session to 5 and 10 sessions later.
 * Null until that many daily marks exist. This does not invent a return.
 */
export function paperHorizon(
  bookId: string,
  daily: Array<{ date: string; equity: number }>,
): PaperHorizon {
  const base = daily[0]?.equity;
  const at = (sessions: number) => {
    const row = daily[sessions];
    if (base == null || !(base > 0) || !row || !(row.equity > 0)) return null;
    return round4(row.equity / base - 1);
  };
  return { bookId, plus5: at(5), plus10: at(10), sessions: daily.length };
}
