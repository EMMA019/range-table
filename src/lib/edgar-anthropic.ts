import { etWallTimeMs } from "./calendar";
import { jst, type AlertItem } from "./alerts";

/**
 * Anthropic's public IPO registration. Name search on EDGAR returns many SPV funds with
 * "Anthropic" in their names, and full-text search returns other issuers' prospectuses that
 * merely mention Anthropic, so only the filer's own exact name counts.
 */
export const ANTHROPIC_FILER_NAMES = new Set(["ANTHROPIC PBC", "ANTHROPIC INC", "ANTHROPIC HOLDINGS INC", "ANTHROPIC PBC INC"]);

/** Registration and pricing forms. 424B4 is the final prospectus after pricing. */
export const ANTHROPIC_FORMS = new Set(["S-1", "S-1/A", "S-1MEF", "F-1", "F-1/A", "424B4"]);

/** Latest-filings feeds to read on every sweep. The type filter is a prefix, so S-1 also returns S-1/A. */
export const CURRENT_FEED_TYPES = ["S-1", "F-1", "424B4"];

export const ANTHROPIC_WINDOW_DAYS = 30;

export type FeedEntry = {
  form: string;
  company: string;
  cik: string;
  accession: string;
  updated: string;
  url: string;
};

export type FullTextHit = {
  form: string;
  accession: string;
  fileDate: string;
  filers: Array<{ name: string; cik: string }>;
};

export function currentFeedUrl(type: string): string {
  return `https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=${encodeURIComponent(type)}&company=&dateb=&owner=include&start=0&count=100&output=atom`;
}

export function fullTextUrl(startDate: string, endDate: string): string {
  const forms = [...ANTHROPIC_FORMS].join(",");
  return `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent('"Anthropic"')}&forms=${encodeURIComponent(forms)}&dateRange=custom&startdt=${startDate}&enddt=${endDate}`;
}

export function filingIndexUrl(cik: string, accession: string): string {
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replace(/-/g, "")}/${accession}-index.htm`;
}

function decode(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

/** Entries of EDGAR's "Latest Filings" Atom feed. Title: "S-1 - Name (0001234567) (Filer)". */
export function parseCurrentFeed(xml: string): FeedEntry[] {
  const out: FeedEntry[] = [];
  for (const match of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const body = match[1];
    const title = decode(/<title>([\s\S]*?)<\/title>/.exec(body)?.[1] ?? "").trim();
    const parsed = /^(.+?) - (.+) \((\d{10})\) \(([^)]+)\)$/.exec(title);
    const accession = /accession-number=([\d-]{20})/.exec(body)?.[1] ?? "";
    const updated = /<updated>([^<]+)<\/updated>/.exec(body)?.[1] ?? "";
    const url = decode(/<link[^>]*href="([^"]+)"/.exec(body)?.[1] ?? "");
    if (!parsed || !accession || !updated) continue;
    out.push({ form: parsed[1].trim(), company: parsed[2].trim(), cik: parsed[3], accession, updated, url });
  }
  return out;
}

/** Hits of efts full-text search. display_names look like "Name  (TICK)  (CIK 0001234567)". */
export function parseFullTextHits(json: unknown): FullTextHit[] {
  const hits = (json as { hits?: { hits?: Array<{ _source?: Record<string, unknown> }> } })?.hits?.hits;
  if (!Array.isArray(hits)) return [];
  const out: FullTextHit[] = [];
  for (const hit of hits) {
    const source = hit?._source;
    if (!source) continue;
    const form = typeof source.form === "string" ? source.form : "";
    const accession = typeof source.adsh === "string" ? source.adsh : "";
    const fileDate = typeof source.file_date === "string" ? source.file_date : "";
    const names = Array.isArray(source.display_names) ? source.display_names.filter((n): n is string => typeof n === "string") : [];
    if (!form || !accession || !fileDate) continue;
    out.push({
      form,
      accession,
      fileDate,
      filers: names.map((raw) => ({
        name: raw.replace(/\s*\(CIK \d+\)\s*$/, "").replace(/\s*\([A-Z0-9.\-, ]+\)\s*$/, "").trim(),
        cik: /\(CIK (\d+)\)/.exec(raw)?.[1] ?? "",
      })),
    });
  }
  return out;
}

export function normalizeFilerName(name: string): string {
  return name
    .toUpperCase()
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isAnthropicFiler(name: string): boolean {
  return ANTHROPIC_FILER_NAMES.has(normalizeFilerName(name));
}

type Found = { form: string; accession: string; cik: string; company: string; eventAt: string; url: string };

/**
 * Anthropic's own registration filings from both sources, one item per accession.
 * The feed's exact acceptance time wins over the search hit's file date.
 */
export function anthropicAlerts(feed: FeedEntry[], hits: FullTextHit[], now: Date): AlertItem[] {
  const found = new Map<string, Found>();
  for (const hit of hits) {
    if (!ANTHROPIC_FORMS.has(hit.form)) continue;
    const filer = hit.filers.find((item) => isAnthropicFiler(item.name));
    if (!filer) continue;
    found.set(hit.accession, {
      form: hit.form,
      accession: hit.accession,
      cik: filer.cik,
      company: filer.name,
      eventAt: new Date(etWallTimeMs(hit.fileDate, 0)).toISOString(),
      url: filingIndexUrl(filer.cik, hit.accession),
    });
  }
  for (const entry of feed) {
    if (!ANTHROPIC_FORMS.has(entry.form) || !isAnthropicFiler(entry.company)) continue;
    const at = Date.parse(entry.updated);
    found.set(entry.accession, {
      form: entry.form,
      accession: entry.accession,
      cik: entry.cik,
      company: entry.company,
      eventAt: Number.isFinite(at) ? new Date(at).toISOString() : now.toISOString(),
      url: entry.url || filingIndexUrl(entry.cik, entry.accession),
    });
  }
  const cutoff = now.getTime() - ANTHROPIC_WINDOW_DAYS * 86_400_000;
  return [...found.values()]
    .filter((item) => Date.parse(item.eventAt) >= cutoff)
    .map((item) => {
      const pricing = item.form === "424B4";
      return {
        id: `sec:${item.accession}:anthropic`,
        kind: "anthropic_s1" as const,
        priority: "critical" as const,
        ticker: null,
        title: pricing
          ? `Anthropic 最終目論見書（424B4）提出：IPO価格が決まった`
          : `Anthropic IPO登録届出（${item.form}）が公開提出された`,
        body: [
          `提出者 ${item.company}（CIK ${item.cik}）/ 受付 ${jst(item.eventAt)}`,
          pricing ? "価格決定後の目論見書。" : "公開提出から価格決定までは通常2週間以上ある。",
        ].join("\n"),
        eventAt: item.eventAt,
        eventAtJst: jst(item.eventAt),
        url: item.url,
        flags: [],
        facts: { form: item.form, accession: item.accession, cik: item.cik, filer: item.company },
      };
    });
}
