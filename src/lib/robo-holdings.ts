import { parseHoldingsJson } from "./holdings";
import { sanitizePositions, type SleevePosition } from "./robo-model";

/** Sleeve positions only. Kept apart from HOLDINGS_JSON so individual stocks stay out of this frame. */
export const ROBO_HOLDINGS_ENV = "ROBO_HOLDINGS_JSON";

export function roboHoldingsFromEnv(env: Record<string, string | undefined> = process.env): SleevePosition[] {
  const parsed = parseHoldingsJson(env[ROBO_HOLDINGS_ENV]);
  return sanitizePositions(parsed.holdings);
}
