/** Thresholds and windows. The UI labels these in Japanese so the basis stays visible. */
export const BENCHMARKS = ["SPY", "QQQ", "SOXX"] as const;

export const CACHE_TTL_MS = 15 * 60 * 1000;

/** Trailing and forward EPS change slowly, so a successful read is cached much longer than prices. */
export const EPS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** Failed or empty EPS reads are not kept for a day. Retry after this. */
export const EPS_FAIL_TTL_MS = 10 * 60 * 1000;

/** A timed-out read is retried quickly so the rest of the list is not stuck behind it. */
export const EPS_TIMEOUT_TTL_MS = 60 * 1000;

/** Yahoo rate limits are retried sooner than a hard failure, and slower than a timeout. */
export const EPS_RATE_LIMIT_TTL_MS = 3 * 60 * 1000;

/** Background EPS warm-up. Small batches keep a single /api/market call from waiting on Yahoo. */
export const EPS_WARM_CONCURRENCY = 2;
export const EPS_WARM_BATCH = 6;
export const EPS_WARM_PAUSE_MS = 700;
export const EPS_WARM_GAP_MS = 350;
export const EPS_REQUEST_TIMEOUT_MS = 22_000;

/** Trailing P/E at least this many times forward P/E is flagged as recovering earnings. */
export const PE_RECOVERY_MULTIPLE = 2;

export const BOX_WINDOW = 20;
/** Trading days between the current 20-day average and the earlier one. */
export const MA_SLOPE_LOOKBACK = 5;
/** Absolute slope under this percent is labeled flat. */
export const MA_SLOPE_FLAT_PCT = 1;
export const ATR_WINDOW = 14;
export const CHART_SESSIONS = 66;

/** Box position at or under this percent is "near the bottom". */
export const BOX_BOTTOM_MAX = 20;
/** Box position at or over this percent is "near the top". */
export const BOX_TOP_MIN = 80;

/** Latest volume under this multiple of the prior 20-day average is thin. */
export const VOLUME_THIN_RATIO = 0.7;
/** Latest volume at or over this multiple of the prior 20-day average is a surge. */
export const VOLUME_SURGE_RATIO = 1.5;
/** A breakout below this multiple of the prior 20-day average lacks volume confirmation. */
export const VOLUME_CONFIRM_RATIO = 1;

export const EARNINGS_WARN_DAYS = 5;

/** A one-day close move at least this large flags a possible split or spinoff. */
export const GAP_THRESHOLD = 0.35;

/** Parallel Yahoo chart reads. Kept small so a cold start does not spike the 512MB instance. */
export const FETCH_CONCURRENCY = 5;
