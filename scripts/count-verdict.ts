/**
 * Count verdict states from /api/market (all universe).
 *   npx tsx scripts/count-verdict.ts [baseUrl]
 */
const base = process.argv[2] ?? "https://range-table.onrender.com";

type Row = { ticker: string; quote: { verdict: { state: string }; downtrend: { active: boolean } } | null };

async function main() {
  const res = await fetch(`${base}/api/market?u=all`, { cache: "no-store" });
  const body = (await res.json()) as { rows: Row[]; indexRows: Row[] };
  const all = [...body.rows, ...body.indexRows].filter((r) => r.quote);
  const counts = { 見送り: 0, 待ち: 0, 候補: 0 };
  for (const row of all) {
    const state = row.quote!.verdict.state as keyof typeof counts;
    if (state in counts) counts[state] += 1;
  }
  const chtr = all.find((r) => r.ticker === "CHTR");
  console.log(JSON.stringify({ total: all.length, counts, CHTR: chtr?.quote?.verdict ?? null, CHTR_downtrend: chtr?.quote?.downtrend ?? null }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
