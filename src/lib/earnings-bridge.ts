import { reactionDay } from "./round2";
import type { FilingBlock } from "./bias";

/** Entry is the reaction day, or 1 to `within` sessions after it. */
export function entryAfterEarnings(entry: string, reactions: readonly string[], sessions: readonly string[], within = 5): boolean {
  const at = sessions.indexOf(entry);
  if (at < 0) return false;
  for (const reaction of reactions) {
    const event = sessions.indexOf(reaction);
    if (event < 0) continue;
    const distance = at - event;
    if (distance >= 0 && distance <= within) return true;
  }
  return false;
}

/**
 * Last bar on or before the session before the next reaction day after entry.
 * The trade can still exit earlier on a target or a stop.
 */
export function exitBarBeforeReaction(
  bars: readonly { date: string }[],
  entryDate: string,
  reactions: readonly string[],
  sessions: readonly string[],
): string | null {
  const at = sessions.indexOf(entryDate);
  if (at < 0) return null;
  let next = -1;
  for (const reaction of reactions) {
    const event = sessions.indexOf(reaction);
    if (event > at && (next < 0 || event < next)) next = event;
  }
  if (next <= 0) return null;
  const cap = sessions[next - 1];
  let chosen: string | null = null;
  for (const bar of bars) {
    if (bar.date < entryDate) continue;
    if (bar.date > cap) break;
    chosen = bar.date;
  }
  return chosen;
}

/** Reaction sessions from 8-K Item 2.02 acceptance timestamps. Undated filings are counted and skipped. */
export function reactionDaysFrom(blocks: readonly FilingBlock[], sessions: readonly string[]): { days: string[]; undated: number } {
  const days = new Set<string>();
  let undated = 0;
  for (const block of blocks) {
    const forms = block.form ?? [];
    const items = block.items ?? [];
    const accepted = block.acceptanceDateTime ?? [];
    for (let i = 0; i < forms.length; i += 1) {
      if (forms[i] !== "8-K") continue;
      const parts = (items[i] ?? "").split(",").map((part) => part.trim());
      if (!parts.includes("2.02")) continue;
      const stamp = accepted[i];
      if (!stamp) {
        undated += 1;
        continue;
      }
      const day = reactionDay(stamp, sessions);
      if (day) days.add(day);
    }
  }
  return { days: [...days].sort(), undated };
}
