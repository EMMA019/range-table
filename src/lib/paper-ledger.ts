export type PaperLine = "25" | "35";

export type PaperPosition = {
  id: string;
  ticker: string;
  line: PaperLine;
  entry: number;
  shares: number;
  stop: number;
  target: number;
  openedOn: string;
};

export type PaperClose = PaperPosition & {
  exit: number;
  closedOn: string;
  pnl: number;
};

export type PaperDay = {
  date: string;
  realizedUsd: number;
  unrealizedUsd: number;
  open: number;
  trades: number;
};

export type PaperLedger = {
  v: 1;
  positions: PaperPosition[];
  closed: PaperClose[];
  days: PaperDay[];
};

export const PAPER_LEDGER_KEY = "rt.paper.v1";

export function emptyLedger(): PaperLedger {
  return { v: 1, positions: [], closed: [], days: [] };
}

function cents(value: number): number {
  return Math.round(value * 100) / 100;
}

export function canOpen(ledger: PaperLedger, ticker: string, line: PaperLine): boolean {
  const key = ticker.trim().toUpperCase();
  const open = ledger.positions.filter((row) => row.ticker === key);
  if (open.length >= 2) return false;
  return !open.some((row) => row.line === line);
}

export function openPosition(
  ledger: PaperLedger,
  input: Omit<PaperPosition, "id" | "ticker"> & { ticker: string },
): PaperLedger | null {
  const ticker = input.ticker.trim().toUpperCase();
  if (!canOpen(ledger, ticker, input.line)) return null;
  if (!(input.shares >= 1) || !(input.entry > input.stop) || !(input.target > 0)) return null;
  const position: PaperPosition = {
    id: `${ticker}|${input.line}|${input.openedOn}`,
    ticker,
    line: input.line,
    entry: input.entry,
    shares: input.shares,
    stop: input.stop,
    target: input.target,
    openedOn: input.openedOn,
  };
  return { ...ledger, positions: [...ledger.positions, position] };
}

export function closePosition(ledger: PaperLedger, id: string, exit: number, closedOn: string): PaperLedger | null {
  const position = ledger.positions.find((row) => row.id === id);
  if (!position || !(exit > 0)) return null;
  const pnl = cents((exit - position.entry) * position.shares);
  const closed: PaperClose = { ...position, exit, closedOn, pnl };
  return {
    ...ledger,
    positions: ledger.positions.filter((row) => row.id !== id),
    closed: [...ledger.closed, closed],
  };
}

export function unrealized(position: PaperPosition, mark: number | null | undefined): number | null {
  if (mark == null || !Number.isFinite(mark)) return null;
  return cents((mark - position.entry) * position.shares);
}

export function daySnapshot(ledger: PaperLedger, date: string, marks: ReadonlyMap<string, number>): PaperDay {
  const realized = ledger.closed.filter((row) => row.closedOn === date).reduce((sum, row) => sum + row.pnl, 0);
  let unreal = 0;
  for (const position of ledger.positions) {
    const pnl = unrealized(position, marks.get(position.ticker));
    if (pnl != null) unreal += pnl;
  }
  const trades =
    ledger.positions.filter((row) => row.openedOn === date).length +
    ledger.closed.filter((row) => row.closedOn === date).length;
  return {
    date,
    realizedUsd: cents(realized),
    unrealizedUsd: cents(unreal),
    open: ledger.positions.length,
    trades,
  };
}

export function upsertDay(ledger: PaperLedger, day: PaperDay): PaperLedger {
  const days = [...ledger.days.filter((row) => row.date !== day.date), day];
  days.sort((a, b) => a.date.localeCompare(b.date));
  return { ...ledger, days };
}

function isPosition(value: unknown): value is PaperPosition {
  if (!value || typeof value !== "object") return false;
  const row = value as PaperPosition;
  return (
    typeof row.id === "string" &&
    typeof row.ticker === "string" &&
    (row.line === "25" || row.line === "35") &&
    typeof row.entry === "number" &&
    typeof row.shares === "number" &&
    typeof row.stop === "number" &&
    typeof row.target === "number" &&
    typeof row.openedOn === "string"
  );
}

export function parseLedger(text: string | null | undefined): PaperLedger {
  if (!text) return emptyLedger();
  try {
    const parsed = JSON.parse(text) as Partial<PaperLedger>;
    if (parsed.v !== 1) return emptyLedger();
    const positions = Array.isArray(parsed.positions) ? parsed.positions.filter(isPosition) : [];
    const closed = Array.isArray(parsed.closed)
      ? parsed.closed.filter((row): row is PaperClose => isPosition(row) && typeof (row as PaperClose).exit === "number" && typeof (row as PaperClose).pnl === "number" && typeof (row as PaperClose).closedOn === "string")
      : [];
    const days = Array.isArray(parsed.days)
      ? parsed.days.filter((row): row is PaperDay => {
          if (!row || typeof row !== "object") return false;
          const day = row as PaperDay;
          return typeof day.date === "string" && typeof day.realizedUsd === "number" && typeof day.unrealizedUsd === "number" && typeof day.open === "number" && typeof day.trades === "number";
        })
      : [];
    return { v: 1, positions, closed, days };
  } catch {
    return emptyLedger();
  }
}

export function loadLedger(storage: Pick<Storage, "getItem">): PaperLedger {
  try {
    return parseLedger(storage.getItem(PAPER_LEDGER_KEY));
  } catch {
    return emptyLedger();
  }
}

export function saveLedger(ledger: PaperLedger, storage: Pick<Storage, "setItem">): void {
  storage.setItem(PAPER_LEDGER_KEY, JSON.stringify(ledger));
}
