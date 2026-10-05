/**
 * Refresh numeric lines on team picks from latest Yahoo daily bars (thesis text unchanged).
 *   npx tsx scripts/refresh-team-picks.ts
 *
 * Intended to run daily via .github/workflows/team-picks.yml after US close.
 */
import fs from "fs";
import path from "path";
import { todayEt } from "../src/lib/calendar";
import { loadTeamPicks, parseTeamPicks } from "../src/lib/picks";
import { fetchDailyBars } from "../src/lib/yahoo";

const OUT = path.join(process.cwd(), "data", "team_picks.json");

function minLow(bars: { date: string; l: number }[], sessions: number): { low: number; date: string } | null {
  if (bars.length < sessions) return null;
  const slice = bars.slice(-sessions);
  let best = slice[0]!;
  for (const b of slice) {
    if (b.l < best.l) best = b;
  }
  return { low: best.l, date: best.date };
}

function low20(bars: { l: number }[]): number | null {
  if (bars.length < 20) return null;
  const slice = bars.slice(-20);
  return Math.min(...slice.map((b) => b.l));
}

async function main() {
  const today = todayEt();
  const picks = loadTeamPicks();
  const out: Record<string, unknown>[] = [];

  for (const pick of picks) {
    const { bars } = await fetchDailyBars(pick.ticker, { range: "3mo", keep: 80, totalReturn: true });
    const last = bars.at(-1);
    const entry = minLow(bars, 10);
    const rev = low20(bars);
    const row: Record<string, unknown> = {
      ticker: pick.ticker,
      name: pick.name,
      genre: pick.genre,
      thesis_facts: pick.thesisFacts,
      thesis_hypothesis: pick.thesisHypothesis,
      entry_line: entry ? Math.round(entry.low * 100) / 100 : pick.entryLine,
      entry_basis: entry
        ? `直近安値 $${entry.low.toFixed(2)}（直近10営業日の最安値・${entry.date}、Yahoo日足、${today}）`
        : pick.entryBasis,
      review_line: rev != null ? Math.round(rev * 100) / 100 : pick.reviewLine,
      review_basis:
        rev != null && last
          ? `20日安値 $${rev.toFixed(2)}（基準日終値 ${last.date}、Yahoo日足、${today}）`
          : pick.reviewBasis,
      earnings_date: pick.earningsDate,
      status: pick.status,
      recommended_by: pick.recommendedBy,
      as_of: today,
    };
    out.push(row);
  }

  parseTeamPicks(out);
  fs.writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`Updated ${OUT} (${out.length} picks, as_of ${today})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
