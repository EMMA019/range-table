import { ALERT_MIN_ATR_PCT, ATR_COST_WARN, CORR_HIGH, PICK_WATCH_PRICE } from "./constants";

/** Red flags are reasons to stop; the rest are cautions. Nothing here places an order. */
export type PrecheckFlag =
  | "earnings5d"
  | "belowDefense"
  | "cashShort"
  | "priceOver450"
  | "costOver450"
  | "atrUnder3"
  | "corrHigh"
  | "notInOk"
  | "usesUnsettled";

export const RED_FLAGS = new Set<PrecheckFlag>(["earnings5d", "belowDefense", "cashShort"]);

export const FLAG_TEXT: Record<PrecheckFlag, string> = {
  earnings5d: "決算まで5営業日以内",
  belowDefense: "20日安値まで下がると防衛ラインを割る",
  cashShort: "現金（未決済を含む）が足りない",
  priceOver450: `1株が$${PICK_WATCH_PRICE}超`,
  costOver450: `買付額が$${ATR_COST_WARN}超`,
  atrUnder3: `ATRが終値の${ALERT_MIN_ATR_PCT}%未満`,
  corrHigh: `保有と相関${CORR_HIGH}超`,
  notInOk: "25–35%帯（±2pt）の買い候補ではない",
  usesUnsettled: "未決済の資金を使う",
};
