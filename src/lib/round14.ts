/** Pre-registration commit. Results must cite this and must not relax the rules. */
export const ROUND14_PREREG = "0de587a42425e23cabdef9b8e23f9e08a8161b17";

export const START = 3200;

export type YearSlice = { year: string; from: string; to: string };

/** Calendar years inside the window. The cut is the last session of that year, or the window end. */
export function yearSlices(sessions: readonly string[]): YearSlice[] {
  const out: YearSlice[] = [];
  let from = sessions[0] ?? "";
  for (let i = 0; i < sessions.length; i += 1) {
    const date = sessions[i];
    const next = sessions[i + 1];
    const end = !next || next.slice(0, 4) !== date.slice(0, 4);
    if (!end) continue;
    out.push({ year: date.slice(0, 4), from, to: date });
    from = next ?? "";
  }
  return out;
}

/** Equity at `to` minus equity at the session before `from`, or the starting capital when `from` is the first session. */
export function equityChange(daily: readonly { date: string; equity: number }[], from: string, to: string, capital: number): number {
  const end = daily.find((row) => row.date === to);
  if (!end) throw new Error(`年末の評価がない ${to}`);
  const prior = [...daily].reverse().find((row) => row.date < from);
  const start = prior ? prior.equity : capital;
  return Math.round((end.equity - start) * 100) / 100;
}
