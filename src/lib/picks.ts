import fs from "fs";
import path from "path";
import { PICK_WATCH_PRICE } from "./constants";
import { classifyEarnings } from "./earnings";
import type { PickCard, PickQuote, PickStatus, TeamPick } from "./types";

const PICKS_PATH = path.join(process.cwd(), "data", "team_picks.json");
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES = new Set<string>(["候補", "監視のみ"]);

export function loadTeamPicks(): TeamPick[] {
  const raw = fs.readFileSync(PICKS_PATH, "utf8");
  return parseTeamPicks(JSON.parse(raw) as unknown);
}

export function parseTeamPicks(json: unknown): TeamPick[] {
  if (!Array.isArray(json)) throw new Error("team_picks.json は配列である必要がある");
  return json.map((item, index) => parseOne(item, index));
}

/** Signed percent from the line to the close. Null until both numbers are positive. */
export function lineDistancePct(close: number | null | undefined, line: number): number | null {
  if (close == null || !Number.isFinite(close) || close <= 0) return null;
  if (!Number.isFinite(line) || line <= 0) return null;
  return ((close - line) / line) * 100;
}

export function buildPickCard(
  pick: TeamPick,
  quote: PickQuote | null,
  error: string | null,
  today: string,
): PickCard {
  const close = quote?.close;
  const earnings = pick.earningsDate
    ? classifyEarnings(today, { date: pick.earningsDate, status: "confirmed" })
    : null;
  return {
    ticker: pick.ticker,
    name: pick.name,
    genre: pick.genre,
    thesisFacts: pick.thesisFacts,
    thesisHypothesis: pick.thesisHypothesis,
    entryLine: pick.entryLine,
    entryBasis: pick.entryBasis,
    reviewLine: pick.reviewLine,
    reviewBasis: pick.reviewBasis,
    earningsDate: pick.earningsDate,
    earningsWarn: Boolean(earnings?.warn),
    status: pick.status,
    recommendedBy: pick.recommendedBy,
    asOf: pick.asOf,
    quote,
    error,
    entryDistancePct: lineDistancePct(close, pick.entryLine),
    reviewDistancePct: lineDistancePct(close, pick.reviewLine),
    entryZone: close != null && close <= pick.entryLine,
    watchOnly: pick.status === "監視のみ" || (close != null && close > PICK_WATCH_PRICE),
  };
}

function parseOne(item: unknown, index: number): TeamPick {
  if (!item || typeof item !== "object") {
    throw new Error(`team_picks[${index}] がオブジェクトではない`);
  }
  const row = item as Record<string, unknown>;
  const ticker = text(row, "ticker", index).toUpperCase();
  if (!ticker) throw new Error(`team_picks[${index}].ticker が空`);
  const status = text(row, "status", index);
  if (!STATUSES.has(status)) {
    throw new Error(`team_picks[${index}].status は「候補」か「監視のみ」`);
  }
  const earnings = row.earnings_date;
  if (earnings !== null && (typeof earnings !== "string" || !DATE.test(earnings))) {
    throw new Error(`team_picks[${index}].earnings_date は YYYY-MM-DD か null`);
  }
  return {
    ticker,
    name: text(row, "name", index),
    genre: text(row, "genre", index),
    thesisFacts: text(row, "thesis_facts", index),
    thesisHypothesis: text(row, "thesis_hypothesis", index),
    entryLine: positive(row, "entry_line", index),
    entryBasis: text(row, "entry_basis", index),
    reviewLine: positive(row, "review_line", index),
    reviewBasis: text(row, "review_basis", index),
    earningsDate: earnings,
    status: status as PickStatus,
    recommendedBy: text(row, "recommended_by", index),
    asOf: text(row, "as_of", index),
  };
}

function text(row: Record<string, unknown>, key: string, index: number): string {
  const value = row[key];
  if (typeof value !== "string") throw new Error(`team_picks[${index}].${key} は文字列`);
  return value;
}

function positive(row: Record<string, unknown>, key: string, index: number): number {
  const value = row[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`team_picks[${index}].${key} は正の数`);
  }
  return value;
}
