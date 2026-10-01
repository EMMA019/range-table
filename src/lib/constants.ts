/** Thresholds and windows. The UI labels these in Japanese so the basis stays visible. */
export const BENCHMARKS = ["SPY", "QQQ", "SOXX"] as const;

export const CACHE_TTL_MS = 15 * 60 * 1000;

export const BOX_WINDOW = 20;
export const ATR_WINDOW = 14;
export const CHART_SESSIONS = 66;

/** Box position at or under this percent is "near the bottom". */
export const BOX_BOTTOM_MAX = 20;
/** Box position at or over this percent is "near the top". */
export const BOX_TOP_MIN = 80;

export const EARNINGS_WARN_DAYS = 5;

/** A one-day close move at least this large flags a possible split or spinoff. */
export const GAP_THRESHOLD = 0.35;

export const FETCH_CONCURRENCY = 6;
