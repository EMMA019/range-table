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
  /** Share volume. Split-adjusted the same way as price when a raw split is applied. */
  v: number;
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
  /** Percent change of the 20-day average versus 5 trading days earlier. Null until 25 closes exist. */
  maSlopePct: number | null;
  /** Latest completed bar's share volume. Null when that bar has no volume. */
  volume: number | null;
  /** Average share volume of the 20 completed bars before the latest one. */
  avgVolume20: number | null;
  /** Latest volume ÷ prior 20-day average. Null when the average is not positive. */
  volumeRatio: number | null;
  /** Average of close × volume over those same prior 20 bars. */
  avgDollarVolume20: number | null;
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
  /** Upstream status or reason. Null when at least one EPS value was returned. */
  error: string | null;
};

export type PeView = {
  trailingEps: number | null;
  forwardEps: number | null;
  trailingPe: number | null;
  forwardPe: number | null;
  recovering: boolean;
  error: string | null;
  errorDetail: string | null;
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
