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
  /** Optional extra sector label. Null when the group name is the label shown on the card. */
  sectorLabel: string | null;
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
  /** Nominal close for historical market-cap (not split-back-adjusted). */
  mcapC?: number;
};

/** Where the latest close sits against the 15% and 25% lines of the 20-day box. */
export type EntrySignal = "in_ok" | "early" | "chase" | "late";

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
  /** Shares so one ATR(14) move is about $10. Null when ATR is missing. */
  shares10: number | null;
  /** shares10 × close. Null when ATR is missing. */
  cost10: number | null;
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
  /** 20-day low plus 15% of the 20-day range. Same box as boxPct. */
  line15: number;
  /** 20-day low plus 25% of the 20-day range. */
  line25: number;
  /** 20-day low plus 35% of the 20-day range. */
  line35: number;
  /**
   * Consecutive bullish candles after the latest 20-day low.
   * 0 when that low is the latest bar (安値更新中).
   * Null when the low is older than 10 sessions or the run stops before the latest bar.
   */
  reboundDays: number | null;
  /** in_ok inside 15–25% after a rebound, early below that, chase above 25% through 50%, late above 50%. */
  entrySignal: EntrySignal;
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
  /** Yahoo net income TTM or similar when EPS is empty. */
  ttmNetIncome?: number | null;
  profitSource?: string | null;
  /** Yahoo calendarEvents next earnings date (YYYY-MM-DD). */
  nextEarningsDate?: string | null;
};

export type ProfitabilityStatus = "profit" | "loss" | "unknown";

export type Profitability = {
  status: ProfitabilityStatus;
  source: string | null;
  ttmNetIncome: number | null;
  trailingEps: number | null;
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
  /** Japanese sector label. Null unless the watchlist row set `sector`. */
  sectorLabel: string | null;
  /** 60-day daily-return correlation versus the holdings basket. Null when the window is short. */
  corrBasket: number | null;
  /** 60-day daily-return correlation versus the basket file's benchmark (SOXX). */
  corrSoxx: number | null;
  /** 20-session return minus SPY's 20-session return on the same date. Null when either series is short. */
  rs20: number | null;
  /** Semiconductor or equipment watchlist group. */
  semi: boolean;
  /** HOLDINGS_JSON already has two semiconductor or equipment names. ONDS does not count. */
  semiFull: boolean;
  quote: Quote | null;
  pe: PeView;
  error: string | null;
  errorDetail: string | null;
  /** The quote comes from an earlier fetch because the latest one failed. */
  stale: boolean;
  profitability: Profitability;
  /** True when no next earnings date could be resolved. */
  earningsUnknown: boolean;
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
  /** The latest bar is today's and the close may still be revised (before 16:20 ET). */
  provisional: boolean;
  excludedPartial: boolean;
  source: string;
  indices: IndexRow[];
  rows: TickerRow[];
  okCount: number;
  failCount: number;
  /** Rows showing bars from an earlier fetch. */
  staleCount: number;
  /** Latest USD/JPY daily close (Yahoo JPY=X). */
  usdJpy: { rate: number; date: string } | null;
};

export type PickStatus = "候補" | "監視のみ";

export type TeamPick = {
  ticker: string;
  name: string;
  genre: string;
  thesisFacts: string;
  thesisHypothesis: string;
  entryLine: number;
  entryBasis: string;
  reviewLine: number;
  reviewBasis: string;
  earningsDate: string | null;
  status: PickStatus;
  recommendedBy: string;
  asOf: string;
};

/** The quote fields a team-pick card needs. The rest of the daily series stays in the shared cache. */
export type PickQuote = {
  close: number;
  closeDate: string;
  boxPct: number;
  low20: number;
  high20: number;
  volumeRatio: number | null;
  atr14: number;
  shares10: number | null;
  cost10: number | null;
  line15: number;
  line25: number;
  reboundDays: number | null;
  entrySignal: EntrySignal;
};

export type PickCard = {
  ticker: string;
  name: string;
  genre: string;
  thesisFacts: string;
  thesisHypothesis: string;
  entryLine: number;
  entryBasis: string;
  reviewLine: number;
  reviewBasis: string;
  earningsDate: string | null;
  earnings: EarningsView | null;
  earningsWarn: boolean;
  /** 20-session return minus SPY. Null when either series is short. */
  rs20: number | null;
  status: PickStatus;
  recommendedBy: string;
  asOf: string;
  quote: PickQuote | null;
  error: string | null;
  entryDistancePct: number | null;
  reviewDistancePct: number | null;
  entryZone: boolean;
  watchOnly: boolean;
};

export type PicksPayload = {
  fetchedAt: number;
  fetchedAtJst: string;
  empty: boolean;
  picks: PickCard[];
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
