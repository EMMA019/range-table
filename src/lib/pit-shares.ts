/** PIT shares outstanding for market-cap (EDGAR companyfacts). */

/** Do not use CommonStockSharesIssued — often mis-scaled vs outstanding (e.g. HOLX 300B "issued"). */
const SHARE_TAGS: Array<[string, string]> = [
  ["dei", "EntityCommonStockSharesOutstanding"],
  ["us-gaap", "CommonStockSharesOutstanding"],
  ["us-gaap", "WeightedAverageNumberOfSharesOutstandingBasic"],
  ["us-gaap", "WeightedAverageNumberOfDilutedSharesOutstanding"],
];

const STRICT_SHARE_TAGS = SHARE_TAGS.slice(0, 2);

/** Reject bogus EDGAR points (authorized / mis-tagged issued counts). */
const MAX_REASONABLE_SHARES = 20_000_000_000;

function sharesFromTags(
  json: unknown,
  asOf: string,
  tags: Array<[string, string]>,
): number | null {
  if (!json || typeof json !== "object" || !("facts" in json)) return null;
  const facts = (json as { facts: Record<string, Record<string, { units?: Record<string, Array<{ end?: string; val?: number }>> }>> })
    .facts;
  let bestEnd = "";
  let bestPri = tags.length;
  let bestVal: number | null = null;
  for (let pri = 0; pri < tags.length; pri += 1) {
    const [ns, tag] = tags[pri];
    const block = facts[ns]?.[tag]?.units?.shares;
    if (!block) continue;
    for (const p of block) {
      if (
        !p.end ||
        p.end > asOf ||
        !Number.isFinite(p.val) ||
        (p.val ?? 0) <= 0 ||
        (p.val ?? 0) > MAX_REASONABLE_SHARES
      ) {
        continue;
      }
      if (p.end > bestEnd || (p.end === bestEnd && pri < bestPri)) {
        bestEnd = p.end;
        bestPri = pri;
        bestVal = p.val!;
      }
    }
  }
  return bestVal;
}

/** Latest shares with period end <= asOf; prefers dei/gaap outstanding over weighted-average fallbacks. */
export function sharesOutstandingAsOf(json: unknown, asOf: string): number | null {
  return sharesFromTags(json, asOf, SHARE_TAGS);
}

/** Pre-fix behavior: outstanding tags only (no weighted-average fallback). */
export function sharesOutstandingAsOfStrict(json: unknown, asOf: string): number | null {
  return sharesFromTags(json, asOf, STRICT_SHARE_TAGS);
}
