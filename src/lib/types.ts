export type EarningsStatus = "confirmed" | "estimated";

export type EarningsInput = {
  date: string;
  status: EarningsStatus;
};

export type WatchTicker = {
  ticker: string;
  description: string;
  notes: string;
  tags: string[];
  watchOnly: boolean;
  earnings: EarningsInput | null;
};

export type WatchGroup = {
  id: string;
  name: string;
  tickers: WatchTicker[];
};

export type Watchlist = {
  groups: WatchGroup[];
};

export type Bar = {
  date: string;
  o: number;
  h: number;
  l: number;
  c: number;
};

export type Quote = {
  close: number;
  closeDate: string;
  ma20: number;
  devPct: number;
  low20: number;
  high20: number;
  priorHigh20: number;
  boxPct: number;
  atr14: number;
  brokeHigh: boolean;
  gapWarning: boolean;
};

export type EarningsView = {
  date: string;
  status: EarningsStatus;
  state: "upcoming" | "today" | "past";
  tradingDays: number | null;
  warn: boolean;
};

export type EpsSnapshot = {
  trailingEps: number | null;
  forwardEps: number | null;
};

export type PeView = {
  trailingEps: number | null;
  forwardEps: number | null;
  trailingPe: number | null;
  forwardPe: number | null;
  recovering: boolean;
};

export type TickerRow = {
  ticker: string;
  sectorId: string;
  sector: string;
  description: string;
  notes: string;
  tags: string[];
  watchOnly: boolean;
  earnings: EarningsView | null;
  quote: Quote | null;
  pe: PeView;
  error: string | null;
  errorDetail: string | null;
};

export type IndexRow = {
  ticker: string;
  quote: Quote | null;
  error: string | null;
};

export type MarketPayload = {
  fetchedAt: number;
  fetchedAtJst: string;
  ttlMs: number;
  barDate: string | null;
  excludedPartial: boolean;
  source: string;
  indices: IndexRow[];
  rows: TickerRow[];
  okCount: number;
  failCount: number;
};

export type ChartBar = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  ma20: number | null;
};

export type ChartPayload = {
  ticker: string;
  bars: ChartBar[];
  low20: number;
  high20: number;
  priorHigh20: number;
  closeDate: string;
};
