export type EarningsStatus = "confirmed" | "estimated";

/** pre = before the open, post = after the close. Null means the session was not recorded. */
export type EarningsSession = "pre" | "post";

export type EarningsInput = {
  date: string;
  status: EarningsStatus;
  session?: EarningsSession | null;
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

/** 60-day correlation versus SOXX, on the two-decimal figure. */
export type SoxxTag = "半導体・AI寄り" | "中間" | "低相関";

/**
 * One weekly read of the latest close.
 * rebound = 週内で底タッチ→反発, wait = 底で待ち, avoid = 安値更新＋20日線が下向き.
 * earnings replaces rebound when the next report is inside 5 trading days.
 */
export type WeeklyCall =
  | "週内で底タッチ→反発"
  | "底で待ち"
  | "安値更新＋20日線が下向き"
  | "決算5営業日以内";

/** Week-shaped stats from bars that end on the latest close. No later session is included. */
export type WeeklyStats = {
  /** Box position 5 trading days earlier. Null until 25 closes exist. */
  boxPctPrev: number | null;
  /** Box position of the last 10 sessions, oldest first. Each day uses only bars through that day. */
  boxPctSpark: number[];
  /** Close ÷ close 5 trading days earlier − 1, in percent. */
  weekChangePct: number | null;
  /** Latest close inside the last 5 sessions' high–low, 0–100. */
  weekClosePos: number | null;
  /** How many of the last 5 sessions closed above the prior close. */
  upDays: number | null;
  /** Some session this week printed a low inside that day's own bottom 15% of the 20-day box. */
  touchedBottom: boolean;
  /** The latest session printed the current 20-day low. */
  newLowLast: boolean;
  /** 20-day low − 0.5×ATR(14). */
  stop: number;
  /** floor($15 / (close−stop)), then capped so shares×close ≤ $450. 0 when one share risks more than $15. */
  shares: number;
  /** shares × (close − stop). 0 when shares is 0. */
  riskUsd: number;
  /** ATR(14) ÷ close × 100, two decimals. */
  atrPct: number;
  /** atrPct < 3. */
  narrowRange: boolean;
  /** Price rules for 週内で底タッチ→反発, before the earnings exclusion. */
  reboundSetup: boolean;
};

export type Quote = {
  close: number;
  closeDate: string;
  ma20: number;
  devPct: number;
  low20: number;
  high20: number;
  priorHigh20: number;
  /** Reference: last 5 sessions high/low (not the primary box). */
  low5: number | null;
  high5: number | null;
  low10: number | null;
  high10: number | null;
  boxPct: number;
  atr14: number;
  /** Shares so one ATR(14) move is about $10. Null when ATR is missing. */
  shares10: number | null;
  /** shares10 × close. Null when ATR is missing. */
  cost10: number | null;
  brokeHigh: boolean;
  gapWarning: boolean;
  /** Recent one-day discontinuity (spin-off etc.) that makes the 20-day box unreliable. */
  corpActionWarning: { date: string; pctMove: number } | null;
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
  /** Sessions since the last bar in the 20-day window that printed low20 / high20. */
  low20DaysAgo: number;
  high20DaysAgo: number;
  /** Falling-knife guard — see detectDowntrend in downtrend.ts. */
  downtrend: {
    active: boolean;
    reason: string | null;
    lowDaysAgo: number;
    highDaysAgo: number;
  };
  /** How the latest week sits in the 20-day box. Same bars as the rest of the quote. */
  weekly: WeeklyStats;
  /** Monitoring label (見送り / 待ち / 候補). Not a buy recommendation. */
  verdict: {
    state: "見送り" | "待ち" | "候補";
    reason: string;
  };
};

export type EarningsView = {
  date: string;
  status: EarningsStatus;
  state: "upcoming" | "today" | "past";
  tradingDays: number | null;
  warn: boolean;
  /** 寄り前 / 引け後. Null when nobody recorded the session. */
  session?: EarningsSession | null;
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
  /** Short company name (e.g. Johnson & Johnson). */
  name: string;
  /** GICS sector label (Japanese). */
  sector: string;
  /** GICS sub-industry when known. */
  industry: string | null;
  sectorId: string;
  /** Watchlist group or index membership label (was `sector` before meta). */
  groupName: string;
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
  /** Band of corrSoxx. Null when correlation is missing. */
  soxxTag: SoxxTag | null;
  /** Weekly badge after the earnings exclusion. Null when the quote is missing or no badge applies. */
  weeklyCall: WeeklyCall | null;
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
  /** Latest research note that tags this ticker. Null when data/research_papers.json has none. */
  research: {
    date: string;
    title: string;
    mark: "効く" | "様子見" | "今は無視";
    lag: "すぐ" | "1〜2年" | "もっと先" | null;
  } | null;
};

export type IndexRow = {
  ticker: string;
  quote: Quote | null;
  error: string | null;
};

/** S&P 500 + Nasdaq-100 monitor coverage (see data/monitor_index.json). */
export type MonitorMeta = {
  asOfDate: string;
  unionCount: number;
  watchlistCount: number;
  indexOnlyCount: number;
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
  /** Curated watchlist rows (data/watchlist.yaml). */
  rows: TickerRow[];
  /** Index-only tickers (union minus watchlist). Same shape; sectorId is `index`. */
  indexRows: TickerRow[];
  monitor: MonitorMeta | null;
  okCount: number;
  failCount: number;
  /** Index-only rows without a usable quote. */
  indexFailCount: number;
  /** Rows showing bars from an earlier fetch. */
  staleCount: number;
  /** Latest USD/JPY daily close (Yahoo JPY=X). */
  usdJpy: { rate: number; date: string } | null;
  /** SOXX versus its 20-day average, plus the three market checks. */
  weather: {
    soxx: { close: number; ma20: number; above: boolean; devPct: number } | null;
    checks: Array<{ id: "spy200" | "breadth" | "vix"; label: string; ok: boolean | null; detail: string }>;
    cautious: boolean;
    events: Array<{ date: string; label: string }>;
    note: string | null;
  };
  /** Defense line and account center. Share-based loss stays on the holdings page. */
  policy: { defenseLineJpy: number; accountCenterJpy: number; cushionJpy: number };
  /** Close-to-close return over the last five SPY sessions. */
  weekBench: {
    from: string | null;
    to: string | null;
    sessions: string[];
    returns: { SPY: number | null; QQQ: number | null; SOXX: number | null };
  };
  themeDemand: {
    asOf: string | null;
    signals: Array<{
      id: string;
      label: string;
      change: "strengthened" | "weakened" | "unchanged" | null;
      reason: string | null;
    }>;
  };
  themeSlots: Array<{
    ticker: string;
    theme: "power" | "cooling" | "networking" | "edge" | "physical-ai";
    themeLabel: string;
    corrSoxx: number | null;
    lowCorr: boolean;
  }>;
  /** Survey notes from data/research_papers.json. Empty when the file has none. */
  researchPapers: Array<{
    id: string;
    title: string;
    date: string;
    url: string | null;
    summary: string | null;
    companyTech: string | null;
    lag: "すぐ" | "1〜2年" | "もっと先" | null;
    tickers: string[];
    mark: "効く" | "様子見" | "今は無視";
  }>;
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
  low20DaysAgo: number;
  high20DaysAgo: number;
  downtrend: Quote["downtrend"];
  verdict: Quote["verdict"];
};

export type PickCard = {
  ticker: string;
  name: string;
  /** GICS sector from ticker_meta.json. */
  sector: string;
  industry: string | null;
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
