import {
  BOX_BOTTOM_MAX,
  BOX_TOP_MIN,
  EARNINGS_WARN_DAYS,
} from "./constants";

export const BASIS = {
  close: "確定した日足の終値。場中の未確定の足は入れない",
  ma20: "直近20本の終値の単純平均",
  dev: "(終値 − 20日線) ÷ 20日線",
  low20: "直近20本の安値の最小",
  high20: "直近20本の高値の最大",
  box: "(終値 − 20日安値) ÷ (20日高値 − 20日安値)。0%が底、100%が天井",
  atr: "直近14本の真の値幅の平均。真の値幅は、高値−安値・|高値−前日終値|・|安値−前日終値|の最大",
  breakout: "終値が、当日を含まない直前20本の高値より上。箱が一段上に移った印",
  earnings: `米国東部の今日を含めず、翌営業日から決算日までのNYSE営業日。${EARNINGS_WARN_DAYS}営業日以内で印`,
  priorHigh: "当日を含まない直前20本の高値の最大",
} as const;

export const SORT_OPTIONS = [
  { id: "boxAsc", label: "箱の底から" },
  { id: "boxDesc", label: "箱の天井から" },
  { id: "devAsc", label: "20日線の下から" },
  { id: "earnAsc", label: "決算が近い順" },
] as const;

export type SortId = (typeof SORT_OPTIONS)[number]["id"];

export const CHIPS = [
  { key: "bottom", label: `箱の底 ≤${BOX_BOTTOM_MAX}%` },
  { key: "top", label: `箱の天井 ≥${BOX_TOP_MIN}%` },
  { key: "breakout", label: "20日高値を上抜け" },
  { key: "earnings", label: `決算 ≤${EARNINGS_WARN_DAYS}営業日` },
  { key: "hideWatch", label: "監視のみを隠す" },
] as const;

export type ChipKey = (typeof CHIPS)[number]["key"];
