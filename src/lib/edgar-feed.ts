import { addDays, todayEt } from "./calendar";
import { formatJst } from "./format";
import type { AlertItem, AlertSourceStatus } from "./alerts";
import { EdgarDisabledError, EdgarHttpError, edgarGet, edgarGate, secUserAgent, SEC_USER_AGENT_ENV } from "./edgar-client";
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
import {
  eightKAlert,
  filingTargets,
  form4Alert,
  form4SellSummary,
  form4XmlUrl,
  loadSecCiks,
  offeringAlert,
  parseForm4,
  parseSubmissions,
  submissionsUrl,
  SUBMISSIONS_TTL_MS,
  windowStart,
  type FilingTarget,
  type Form4Summary,
  type RecentFiling,
} from "./edgar-filings";
import { loadWatchlist } from "./watchlist";

/** A sweep at most this often. Each poll after that kicks one, and the answer waits briefly. */
export const EDGAR_SWEEP_MS = 15 * 60 * 1000;

/** A part that finished with a soft error (say, SEC throttled it halfway) still replaces its items. */
export type PartResult = { items: AlertItem[]; error: string | null };

export type EdgarSweep = {
  /** Named parts run in order; a part that throws records its error and keeps its last items. */
  parts: Array<{ id: string; run: (now: Date) => Promise<AlertItem[] | PartResult> }>;
};

type PartState = { items: AlertItem[]; error: string | null; at: number | null };

type State = {
  parts: Record<string, PartState>;
  running: Promise<void> | null;
  lastStart: number | null;
  lastDone: number | null;
};

const state: State = { parts: {}, running: null, lastStart: null, lastDone: null };

let sweep: EdgarSweep = {
  parts: [
    { id: "anthropic", run: runAnthropicCheck },
    { id: "filings", run: (now) => runFilingsCheck(now) },
  ],
};

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

type CompanyCache = { at: number; filings: RecentFiling[] };

/** Per CIK: the watched filings inside the window. Small, so the big submissions JSON is dropped at once. */
const companies = new Map<number, CompanyCache>();
/** Per accession: the sale summary, or null when the Form 4 is not an alert. Parsed once. */
const form4s = new Map<string, Form4Summary | null>();

export type FilingsIo = {
  targets: FilingTarget[];
  submissions: (cik: number) => Promise<unknown>;
  form4: (url: string) => Promise<string>;
};

function defaultIo(): FilingsIo {
  return {
    targets: filingTargets(loadWatchlist(), loadSecCiks()),
    submissions: async (cik) => JSON.parse(await edgarGet(submissionsUrl(cik))),
    form4: (url) => edgarGet(url, "application/xml"),
  };
}

function throttled(error: unknown): boolean {
  return error instanceof EdgarHttpError && (error.status === 403 || error.status === 429);
}

/**
 * 8-K, Form 4 sales and 424B offerings for every watchlist company, one company at a time
 * (one submissions JSON can be 4MB). A throttle stops the walk; what is cached still answers.
 */
export async function runFilingsCheck(now: Date, io: FilingsIo = defaultIo()): Promise<PartResult> {
  const window = windowStart(now);
  const items: AlertItem[] = [];
  const failed: string[] = [];
  let stopped: string | null = null;
  const keep = new Set<string>();

  for (const target of io.targets) {
    let cached = companies.get(target.cik);
    if (!stopped && (!cached || now.getTime() - cached.at >= SUBMISSIONS_TTL_MS)) {
      try {
        cached = { at: now.getTime(), filings: parseSubmissions(await io.submissions(target.cik), window.date) };
        companies.set(target.cik, cached);
      } catch (error) {
        if (error instanceof EdgarDisabledError) throw error;
        if (throttled(error)) stopped = `SECの制限で${target.ticker}以降は前回の結果`;
        else failed.push(target.ticker);
      }
    }
    for (const filing of cached?.filings ?? []) {
      if (Date.parse(filing.acceptedAt) < window.ms) continue;
      if (filing.form === "8-K" || filing.form === "8-K/A") {
        const item = eightKAlert(target, filing);
        if (item) items.push(item);
      } else if (filing.form === "4") {
        keep.add(filing.accession);
        if (!form4s.has(filing.accession)) {
          if (stopped) continue;
          try {
            form4s.set(filing.accession, form4SellSummary(parseForm4(await io.form4(form4XmlUrl(target.cik, filing.accession, filing.primaryDocument)))));
          } catch (error) {
            if (error instanceof EdgarDisabledError) throw error;
            if (throttled(error)) stopped = `SECの制限で${target.ticker}以降は前回の結果`;
            else failed.push(`${target.ticker} Form 4`);
            continue;
          }
        }
        const sale = form4s.get(filing.accession);
        if (sale) items.push(form4Alert(target, filing, sale));
      } else {
        const item = offeringAlert(target, filing);
        if (item) items.push(item);
      }
    }
  }
  for (const accession of form4s.keys()) if (!keep.has(accession)) form4s.delete(accession);

  const notes = [stopped, failed.length ? `読めなかった: ${failed.slice(0, 5).join(" ")}${failed.length > 5 ? ` ほか${failed.length - 5}件` : ""}` : null];
  return { items, error: notes.filter(Boolean).join(" / ") || null };
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
      const result = await part.run(new Date());
      const { items, error } = Array.isArray(result) ? { items: result, error: null } : result;
      state.parts[part.id] = { items, error: error ? error.slice(0, 160) : null, at: Date.now() };
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
  companies.clear();
  form4s.clear();
  state.parts = {};
  state.running = null;
  state.lastStart = null;
  state.lastDone = null;
}
