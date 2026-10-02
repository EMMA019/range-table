import { addDays, todayEt } from "./calendar";
import { formatJst } from "./format";
import type { AlertItem, AlertSourceStatus } from "./alerts";
import { edgarGet, edgarGate, secUserAgent, SEC_USER_AGENT_ENV } from "./edgar-client";
import {
  anthropicAlerts,
  ANTHROPIC_WINDOW_DAYS,
  CURRENT_FEED_TYPES,
  currentFeedUrl,
  fullTextUrl,
  parseCurrentFeed,
  parseFullTextHits,
  type FeedEntry,
  type FullTextHit,
} from "./edgar-anthropic";

/** A sweep at most this often. Each poll after that kicks one, and the answer waits briefly. */
export const EDGAR_SWEEP_MS = 15 * 60 * 1000;

export type EdgarSweep = {
  /** Named parts run in order; a part that throws records its error and keeps its last items. */
  parts: Array<{ id: string; run: (now: Date) => Promise<AlertItem[]> }>;
};

type PartState = { items: AlertItem[]; error: string | null; at: number | null };

type State = {
  parts: Record<string, PartState>;
  running: Promise<void> | null;
  lastStart: number | null;
  lastDone: number | null;
};

const state: State = { parts: {}, running: null, lastStart: null, lastDone: null };

let sweep: EdgarSweep = { parts: [{ id: "anthropic", run: runAnthropicCheck }] };

/** Later PRs append the per-ticker filing part here. */
export function registerEdgarPart(id: string, run: (now: Date) => Promise<AlertItem[]>): void {
  if (sweep.parts.some((part) => part.id === id)) return;
  sweep = { parts: [...sweep.parts, { id, run }] };
}

export async function runAnthropicCheck(now: Date): Promise<AlertItem[]> {
  const feed: FeedEntry[] = [];
  for (const type of CURRENT_FEED_TYPES) {
    feed.push(...parseCurrentFeed(await edgarGet(currentFeedUrl(type), "application/atom+xml")));
  }
  const today = todayEt(now);
  const start = addDays(today, -ANTHROPIC_WINDOW_DAYS);
  let hits: FullTextHit[] = [];
  try {
    hits = parseFullTextHits(JSON.parse(await edgarGet(fullTextUrl(start, today))));
  } catch (error) {
    console.error("[range] edgar full-text", error instanceof Error ? error.message : error);
  }
  return anthropicAlerts(feed, hits, now);
}

/**
 * Starts a sweep when the last one is older than EDGAR_SWEEP_MS and waits up to `waitMs` for it.
 * The alerts answer then uses whatever finished; `complete: false` asks the poller to come back.
 */
export async function refreshEdgar(waitMs: number, now = new Date()): Promise<void> {
  if (!edgarEnabled()) return;
  const due = state.lastStart == null || now.getTime() - state.lastStart >= EDGAR_SWEEP_MS;
  if (due && !state.running) {
    state.lastStart = now.getTime();
    state.running = runSweep().finally(() => {
      state.running = null;
      state.lastDone = Date.now();
    });
  }
  if (!state.running || waitMs <= 0) return;
  await Promise.race([state.running, new Promise((resolve) => setTimeout(resolve, waitMs))]);
}

async function runSweep(): Promise<void> {
  for (const part of sweep.parts) {
    const prev = state.parts[part.id] ?? { items: [], error: null, at: null };
    try {
      const items = await part.run(new Date());
      state.parts[part.id] = { items, error: null, at: Date.now() };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[range] edgar ${part.id}`, message);
      state.parts[part.id] = { ...prev, error: message.slice(0, 160) };
    }
  }
}

export function edgarItems(): AlertItem[] {
  return Object.values(state.parts).flatMap((part) => part.items);
}

let enabledCheck: () => boolean = () => secUserAgent() != null;

export function edgarEnabled(): boolean {
  return enabledCheck();
}

export function edgarStatus(): AlertSourceStatus {
  if (!edgarEnabled()) {
    return {
      ok: false,
      enabled: false,
      checkedAtJst: null,
      error: `${SEC_USER_AGENT_ENV} が未設定。連絡先メール入りのUser-Agentが無いとSECは403を返す`,
      complete: true,
    };
  }
  const errors = Object.entries(state.parts)
    .filter(([, part]) => part.error)
    .map(([id, part]) => `${id}: ${part.error}`);
  const cooldown = edgarGate.remainingMs();
  const doneAll = sweep.parts.every((part) => state.parts[part.id]?.at != null || state.parts[part.id]?.error);
  return {
    ok: errors.length === 0,
    enabled: true,
    checkedAtJst: state.lastDone ? formatJst(new Date(state.lastDone)) : null,
    error: errors.length > 0 ? errors.join(" / ") : cooldown > 0 ? `SECの制限で${Math.ceil(cooldown / 1000)}秒待機中` : null,
    complete: !state.running && doneAll,
  };
}

/** Test hook. */
export function setEdgarSweep(next: EdgarSweep, enabled: () => boolean = () => true): void {
  sweep = next;
  enabledCheck = enabled;
}

/** Test hook. */
export function resetEdgarState(): void {
  state.parts = {};
  state.running = null;
  state.lastStart = null;
  state.lastDone = null;
}
