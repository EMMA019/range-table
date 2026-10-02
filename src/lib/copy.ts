import {
  BOX_BOTTOM_MAX,
  BOX_TOP_MIN,
  CORR_LOW_MAX,
  EARNINGS_WARN_DAYS,
  MA_SLOPE_FLAT_PCT,
  MA_SLOPE_LOOKBACK,
  PE_RECOVERY_MULTIPLE,
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
  trailingPe: "直近の確定終値 ÷ 過去12か月のEPS。EPSがマイナスなら赤字",
  forwardPe: "直近の確定終値 ÷ アナリスト予想EPS。予想EPSがマイナスなら赤字",
  recovering: `実績PERが予想PERの${PE_RECOVERY_MULTIPLE}倍以上。過去12か月の利益が薄く、予想利益の方が大きい`,
  slope: `Yahoo Finance の確定終値で作った20日単純移動平均。今日の値 ÷ ${MA_SLOPE_LOOKBACK}営業日前の値 − 1。±${MA_SLOPE_FLAT_PCT}%未満は横ばい`,
  volume: "出来高=Yahoo日足。倍率=直近日の出来高÷直前20日平均。薄商い<0.7倍、急増≧1.5倍。売買代金=終値×出来高の20日平均。",
  corr: "60営業日の日次リターン相関。保有バスケット=data/corr_basket.json の株数×最新終値で加重。",
} as const;

export const CORR_NOTE = BASIS.corr;

export const VOLUME_NOTE = BASIS.volume;

export const TOP_BREAKOUT_NOTE =
  "上抜け=終値が当日を除く直前20本の高値超え。天井と決めつけて売る前に確認する目安。買いサインではありません。";

export const TEAM_PICKS_EMPTY = "チームの推奨は朝に更新されます";
export const PICK_ENTRY_BADGE = "エントリー圏";
export const PICK_WATCH_BADGE = "監視のみ";
export const PICK_EARNINGS_BADGE = "決算5営業日以内";
export const PICK_DISTANCE_NOTE = "距離=(終値 − ライン) ÷ ライン";

export const SORT_OPTIONS = [
  { id: "boxAsc", label: "箱の底から" },
  { id: "boxDesc", label: "箱の天井から" },
  { id: "devAsc", label: "20日線の下から" },
  { id: "earnAsc", label: "決算が近い順" },
  { id: "trailPeAsc", label: "実績PERの低い順" },
  { id: "fwdPeAsc", label: "予想PERの低い順" },
  { id: "slopeDesc", label: "20日線の上向きから" },
  { id: "volDesc", label: "出来高倍率の高い順" },
] as const;

export type SortId = (typeof SORT_OPTIONS)[number]["id"];

export const CHIPS = [
  { key: "bottom", label: `箱の底 ≤${BOX_BOTTOM_MAX}%` },
  { key: "top", label: `箱の天井 ≥${BOX_TOP_MIN}%` },
  { key: "breakout", label: "20日高値を上抜け" },
  { key: "continued", label: "上抜け継続" },
  { key: "surge", label: "出来高急増" },
  { key: "earnings", label: `決算 ≤${EARNINGS_WARN_DAYS}営業日` },
  { key: "lowCorr", label: `低相関 ≤${CORR_LOW_MAX}` },
  { key: "hideWatch", label: "監視のみを隠す" },
] as const;

export type ChipKey = (typeof CHIPS)[number]["key"];
