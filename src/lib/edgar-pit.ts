/** PIT EDGAR companyfacts helpers (Round 19–compatible). */

type FactPoint = { end: string; val: number; fp?: string; form?: string };

/** TTM net income using quarters with `end` <= asOf only (PIT). */
export function ttmNetIncomeAsOf(json: unknown, asOf: string): number | null {
  if (!json || typeof json !== "object" || !("facts" in json)) return null;
  const facts = (json as { facts: Record<string, Record<string, { units?: Record<string, FactPoint[]> }>> }).facts;
  const tags = ["NetIncomeLoss", "NetIncomeLossAvailableToCommonStockholdersBasic", "ProfitLoss"];
  const namespaces = ["us-gaap", "us-gaap", "ifrs-full"];
  for (let i = 0; i < tags.length; i += 1) {
    const block = facts[namespaces[i]]?.[tags[i]]?.units?.USD;
    if (!block) continue;
    const quarterly = block
      .filter(
        (p) =>
          p.end <= asOf &&
          p.fp &&
          /^Q[1-4]$/i.test(p.fp) &&
          p.form !== "10-K" &&
          p.form !== "20-F" &&
          p.form !== "40-F" &&
          Number.isFinite(p.val),
      )
      .sort((a, b) => b.end.localeCompare(a.end));
    const seen = new Set<string>();
    const uniq: FactPoint[] = [];
    for (const point of quarterly) {
      if (seen.has(point.end)) continue;
      seen.add(point.end);
      uniq.push(point);
      if (uniq.length >= 4) break;
    }
    if (uniq.length >= 4) {
      const sum = uniq.reduce((t, p) => t + p.val, 0);
      return Number.isFinite(sum) ? sum : null;
    }
  }
  return null;
}
