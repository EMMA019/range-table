import fs from "node:fs";
import path from "node:path";
import { isIgnoredTicker } from "./holdings";

export const RESEARCH_MARKS = ["効く", "様子見", "今は無視"] as const;
export type ResearchMark = (typeof RESEARCH_MARKS)[number];

export const RESEARCH_LAGS = ["すぐ", "1〜2年", "もっと先"] as const;
export type ResearchLag = (typeof RESEARCH_LAGS)[number];

export type ResearchPaper = {
  id: string;
  title: string;
  date: string;
  url: string | null;
  /** Plain-language note. Null when the file omitted it. */
  summary: string | null;
  /** Named company technology, or the explicit 「企業技術の明示なし」. Null when omitted. */
  companyTech: string | null;
  /** When a demand effect would show up. Null when the file omitted it. */
  lag: ResearchLag | null;
  tickers: string[];
  mark: ResearchMark;
};

export type ResearchMention = {
  date: string;
  title: string;
  mark: ResearchMark;
  lag: ResearchLag | null;
};

const PAPERS_PATH = path.join(process.cwd(), "data", "research_papers.json");

export function parseResearchPapers(json: unknown): ResearchPaper[] {
  const root = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  const rows = Array.isArray(root.papers) ? root.papers : [];
  const marks = new Set<string>(RESEARCH_MARKS);
  const lags = new Set<string>(RESEARCH_LAGS);
  const out: ResearchPaper[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id.trim() : "";
    const title = typeof row.title === "string" ? row.title.trim() : "";
    const date = typeof row.date === "string" ? row.date : "";
    const mark = typeof row.mark === "string" ? row.mark : "";
    if (!id || !title || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !marks.has(mark)) continue;
    const tickers = (Array.isArray(row.tickers) ? row.tickers : [])
      .filter((ticker): ticker is string => typeof ticker === "string")
      .map((ticker) => ticker.trim().toUpperCase())
      .filter((ticker) => ticker && !isIgnoredTicker(ticker))
      .slice(0, 2);
    const lag = typeof row.lag === "string" ? row.lag.trim() : "";
    const summary = typeof row.summary === "string" ? row.summary.trim() : "";
    const companyTech = typeof row.companyTech === "string" ? row.companyTech.trim() : "";
    out.push({
      id,
      title,
      date,
      url: typeof row.url === "string" && row.url.trim() ? row.url.trim() : null,
      summary: summary || null,
      companyTech: companyTech || null,
      lag: lags.has(lag) ? (lag as ResearchLag) : null,
      tickers,
      mark: mark as ResearchMark,
    });
  }
  return out;
}

export function loadResearchPapers(file = PAPERS_PATH): ResearchPaper[] {
  try {
    return parseResearchPapers(JSON.parse(fs.readFileSync(file, "utf8")) as unknown);
  } catch {
    return [];
  }
}

/** Latest paper that tags the ticker. ONDS is never tagged. */
export function latestResearch(ticker: string, papers: ResearchPaper[]): ResearchMention | null {
  const symbol = ticker.trim().toUpperCase();
  if (isIgnoredTicker(symbol)) return null;
  const hits = papers.filter((paper) => paper.tickers.includes(symbol));
  hits.sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  const top = hits[0];
  if (!top) return null;
  return { date: top.date, title: top.title, mark: top.mark, lag: top.lag };
}

export function researchByTicker(tickers: string[], papers: ResearchPaper[]): Map<string, ResearchMention> {
  const map = new Map<string, ResearchMention>();
  for (const ticker of tickers) {
    const mention = latestResearch(ticker, papers);
    if (mention) map.set(ticker, mention);
  }
  return map;
}
