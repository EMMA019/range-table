import {
  ATR_MIN_PCT,
  BOX_BOTTOM_MAX,
  BOX_TOP_MIN,
  CORR_LOW_MAX,
  EARNINGS_WARN_DAYS,
  MA_SLOPE_FLAT_PCT,
  MA_SLOPE_LOOKBACK,
  PE_RECOVERY_MULTIPLE,
} from "./constants";
import { EARNINGS_AVOID_BADGE } from "./format";

export const BASIS = {
  close: "確定した日足の終値。場中の未確定の足は入れない",
  ma20: "直近20本の終値の単純平均",
  dev: "(終値 − 20日線) ÷ 20日線",
  low20: "直近20本の安値の最小",
  high20: "直近20本の高値の最大",
  range5: "参考: 直近5本の安値〜高値（20日箱の主指標ではない）",
  range10: "参考: 直近10本の安値〜高値（20日箱の主指標ではない）",
  box: "(終値 − 20日安値) ÷ (20日高値 − 20日安値)。0%が底、100%が天井",
  atr: "直近14本の真の値幅の平均。真の値幅は、高値−安値・|高値−前日終値|・|安値−前日終値|の最大",
  shares10: "1日の平均値幅(ATR14)で$10取るのに必要な株数と金額",
  breakout: "終値が、当日を含まない直前20本の高値より上。箱が一段上に移った印",
  earnings: `米国東部の今日を含めず、翌営業日から決算日までのNYSE営業日。${EARNINGS_WARN_DAYS}営業日以内で印`,
  priorHigh: "当日を含まない直前20本の高値の最大",
  trailingPe: "直近の確定終値 ÷ 過去12か月のEPS。EPSがマイナスなら赤字",
  forwardPe: "直近の確定終値 ÷ アナリスト予想EPS。予想EPSがマイナスなら赤字",
  recovering: `実績PERが予想PERの${PE_RECOVERY_MULTIPLE}倍以上。過去12か月の利益が薄く、予想利益の方が大きい`,
  slope: `Yahoo Finance の確定終値で作った20日単純移動平均。今日の値 ÷ ${MA_SLOPE_LOOKBACK}営業日前の値 − 1。±${MA_SLOPE_FLAT_PCT}%未満は横ばい`,
  volume: "出来高=Yahoo日足。倍率=直近日の出来高÷直前20日平均。薄商い<0.7倍、急増≧1.5倍。売買代金=終値×出来高の20日平均。",
  corr: "60営業日の日次リターン相関。保有バスケット=非公開設定(HOLDINGS_JSON)の株数×最新終値で加重。ONDSは除外。未設定なら—。",
  rs: "終値 ÷ 20本前の終値 − 1。同じ計算の SPY を引いた差。強いほど上",
  guide: "20日箱(直近20営業日の高値・安値)から計算。反発=20日安値後の連続陽線数",
  entryInOk: "反発が1日以上続き、終値が20日箱の15%〜25%にある。",
  entryEarly: "終値が15%ラインより下、または箱の底付近で反発がまだ確認できない。",
  entryChase: "終値が25%ラインを超え、箱の位置は50%以下。",
  entryLate: "箱の位置が50%を超えており、新規は遅い。",
} as const;

export const CORR_NOTE = BASIS.corr;

export const VOLUME_NOTE = BASIS.volume;

export const TOP_BREAKOUT_NOTE =
  "上抜け=終値が当日を除く直前20本の高値超え。天井と決めつけて売る前に確認する目安。買いサインではありません。";

export const CORP_ACTION_BADGE = "⚠ 分割/スピンオフ疑い（箱は参考外）";
export const DOWNTREND_BADGE = "↘ 下げトレンド（高値・安値切り下げ）";

/** Tag shared by the old S&P jab list, so those names still filter as one group. */
export const JAB_TAG = "安定ジャブ";
/** Sector-dropdown id for that tag. `jab_sp500` is the previous group id. */
export const JAB_SECTOR_ID = "jab";

/** Tag shared by the original 22-name IBKR list. */
export const IBKR_TAG = "IBKR元リスト";
/** Sector-dropdown id for that tag. Same id the old group used. */
export const IBKR_SECTOR_ID = "ibkr";

/** Virtual sector menu entries. `legacy` ids keep older links working. */
export const TAG_SECTORS = [
  { id: IBKR_SECTOR_ID, tag: IBKR_TAG, legacy: [] as string[] },
  { id: JAB_SECTOR_ID, tag: JAB_TAG, legacy: ["jab_sp500"] },
] as const;

export const TEAM_PICKS_EMPTY = "チームの推奨は朝に更新されます";
export const PICK_ENTRY_BADGE = "エントリー圏";
export const PICK_WATCH_BADGE = "監視のみ";
export const PICK_EARNINGS_BADGE = EARNINGS_AVOID_BADGE;
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
  { id: "rsDesc", label: "対SPY強い順" },
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
  { key: "atrMin", label: `ATR ≥${ATR_MIN_PCT}%` },
  { key: "rebound", label: "反発待ち圏" },
  { key: "inOk", label: "IN OK!" },
  { key: "candidateVerdict", label: "候補のみ" },
  { key: "hideWatch", label: "監視のみを隠す" },
] as const;

export type ChipKey = (typeof CHIPS)[number]["key"];

/** Dashboard list scope (URL ?u=). Default **すべて** on open (`?u=all`); ウォッチリスト is `?u=watch`. */
export const UNIVERSE_SCOPES = [
  { id: "watch", label: "ウォッチリスト" },
  { id: "index", label: "指数監視のみ" },
  { id: "all", label: "すべて" },
] as const;

export type UniverseScopeId = (typeof UNIVERSE_SCOPES)[number]["id"];
