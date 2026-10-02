import fs from "fs";
import path from "path";
import { addDays, etWallTimeMs, todayEt } from "./calendar";
import { FORM4_HIGH_SELL_USD, FORM4_MIN_SELL_USD } from "./constants";
import { jst, type AlertItem, type AlertPriority } from "./alerts";
import { filingIndexUrl } from "./edgar-anthropic";
import { isIgnoredTicker } from "./holdings";
import type { Watchlist } from "./types";

export const SEC_CIK_PATH = path.join(process.cwd(), "data", "sec_cik.json");

/** Filings accepted within this many days stay in the feed (covers a long weekend). */
export const FILING_WINDOW_DAYS = 4;

/** Each company's submissions list is re-read at most this often. */
export const SUBMISSIONS_TTL_MS = 30 * 60 * 1000;

/** 424B2 is left out: banks file hundreds of structured-note supplements a week under it. */
export const OFFERING_FORMS = new Set(["424B1", "424B3", "424B4", "424B5", "424B7"]);

/** Watchlist groups whose 424B filings are mostly debt and note programs. */
export const OFFERING_EXCLUDED_GROUPS = new Set(["financials"]);

export const HIGH_8K_ITEMS = new Set(["1.01", "1.02", "1.03", "1.05", "2.01", "3.01", "4.02", "5.01"]);

/** Earnings releases, Reg FD decks, exhibits only, and vote results. */
export const NOISE_8K_ITEMS = new Set(["2.02", "7.01", "9.01", "5.07"]);

const ITEM_LABELS: Record<string, string> = {
  "1.01": "重要な契約の締結",
  "1.02": "重要な契約の終了",
  "1.03": "破産・管財人",
  "1.05": "重大なサイバー事故",
  "2.01": "買収・売却の完了",
  "2.02": "決算発表",
  "2.03": "借入・債務の発生",
  "2.04": "債務の期限前弁済事由",
  "2.05": "リストラ費用",
  "2.06": "減損",
  "3.01": "上場廃止・上場基準違反の通知",
  "3.02": "未登録株式の発行",
  "3.03": "株主の権利の変更",
  "4.01": "監査法人の交代",
  "4.02": "過去の決算が信頼できない（修正再表示）",
  "5.01": "支配権の変更",
  "5.02": "役員・取締役の退任・選任",
  "5.03": "定款・決算期の変更",
  "5.07": "株主総会の結果",
  "7.01": "Reg FD開示",
  "8.01": "その他の重要事項",
  "9.01": "財務諸表・添付書類",
};

export function itemLabel(item: string): string {
  return ITEM_LABELS[item] ?? "その他";
}

export type FilingTarget = { cik: number; ticker: string; group: string };

/** One entry per CIK (dual share classes share a filer), ignored tickers left out. */
export function filingTargets(watchlist: Watchlist, ciks: Record<string, number>): FilingTarget[] {
  const seen = new Set<number>();
  const out: FilingTarget[] = [];
  for (const group of watchlist.groups) {
    for (const { ticker } of group.tickers) {
      const cik = ciks[ticker];
      if (!cik || isIgnoredTicker(ticker) || seen.has(cik)) continue;
      seen.add(cik);
      out.push({ cik, ticker, group: group.id });
    }
  }
  return out;
}

export function loadSecCiks(file = SEC_CIK_PATH): Record<string, number> {
  const doc = JSON.parse(fs.readFileSync(file, "utf8")) as { ciks?: Record<string, unknown> };
  const out: Record<string, number> = {};
  for (const [ticker, cik] of Object.entries(doc.ciks ?? {})) {
    if (typeof cik === "number" && Number.isInteger(cik) && cik > 0) out[ticker] = cik;
  }
  return out;
}

export function submissionsUrl(cik: number): string {
  return `https://data.sec.gov/submissions/CIK${String(cik).padStart(10, "0")}.json`;
}

export type RecentFiling = {
  accession: string;
  form: string;
  filingDate: string;
  /** UTC ISO acceptance time. */
  acceptedAt: string;
  items: string[];
  primaryDocument: string;
};

const WATCHED_FORMS = new Set(["8-K", "8-K/A", "4", ...OFFERING_FORMS]);

/** The watched forms filed on or after `sinceDate`, from a submissions JSON. */
export function parseSubmissions(json: unknown, sinceDate: string): RecentFiling[] {
  const recent = (json as { filings?: { recent?: Record<string, unknown> } })?.filings?.recent;
  if (!recent) throw new Error("submissions に filings.recent が無い");
  const column = (key: string): unknown[] => (Array.isArray(recent[key]) ? (recent[key] as unknown[]) : []);
  const accession = column("accessionNumber");
  const form = column("form");
  const filingDate = column("filingDate");
  const accepted = column("acceptanceDateTime");
  const items = column("items");
  const primary = column("primaryDocument");
  const out: RecentFiling[] = [];
  for (let i = 0; i < accession.length; i += 1) {
    const date = String(filingDate[i] ?? "");
    const kind = String(form[i] ?? "");
    if (date < sinceDate || !WATCHED_FORMS.has(kind)) continue;
    const at = Date.parse(String(accepted[i] ?? ""));
    out.push({
      accession: String(accession[i]),
      form: kind,
      filingDate: date,
      acceptedAt: new Date(Number.isFinite(at) ? at : etWallTimeMs(date, 9 * 60)).toISOString(),
      items: String(items[i] ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      primaryDocument: String(primary[i] ?? ""),
    });
  }
  return out;
}

/** Null when every item is routine (earnings, Reg FD, exhibits, vote results). */
export function classify8k(items: string[]): { priority: AlertPriority; items: string[] } | null {
  if (items.length === 0) return { priority: "normal", items: [] };
  const meaningful = items.filter((item) => !NOISE_8K_ITEMS.has(item));
  if (meaningful.length === 0) return null;
  return { priority: meaningful.some((item) => HIGH_8K_ITEMS.has(item)) ? "high" : "normal", items: meaningful };
}

export type Form4Sale = { date: string; sharesSold: number; price: number | null };

export type Form4 = {
  documentType: string;
  owners: Array<{ name: string; role: string }>;
  /** The 2023 checkbox: the transaction was made under a Rule 10b5-1 plan. */
  aff10b5One: boolean;
  /** Any footnote mentions a 10b5-1 plan. */
  footnote10b5: boolean;
  sales: Form4Sale[];
};

function block(xml: string, tag: string): string[] {
  return [...xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g"))].map((match) => match[1]);
}

function text(xml: string, tag: string): string {
  const match = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml);
  return match ? decodeXml(match[1].trim()) : "";
}

/** `<tag>…<value>x</value>…</tag>`, staying inside the tag so a missing value does not borrow the next one. */
function valueOf(xml: string, tag: string): string {
  const inner = block(xml, tag)[0];
  return inner ? text(inner, "value") : "";
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function truthy(value: string): boolean {
  return /^(1|true)$/i.test(value);
}

export function parseForm4(xml: string): Form4 {
  const owners = block(xml, "reportingOwner").map((owner) => {
    const title = text(owner, "officerTitle");
    const role = title || (truthy(text(owner, "isDirector")) ? "取締役" : truthy(text(owner, "isTenPercentOwner")) ? "10%株主" : "");
    return { name: text(owner, "rptOwnerName"), role };
  });
  const sales: Form4Sale[] = [];
  for (const row of block(xml, "nonDerivativeTransaction")) {
    if (text(row, "transactionCode") !== "S") continue;
    const sharesSold = Number(valueOf(row, "transactionShares"));
    const price = Number(valueOf(row, "transactionPricePerShare"));
    if (!Number.isFinite(sharesSold) || sharesSold <= 0) continue;
    sales.push({
      date: valueOf(row, "transactionDate"),
      sharesSold,
      price: valueOf(row, "transactionPricePerShare") && Number.isFinite(price) && price > 0 ? price : null,
    });
  }
  const footnotes = block(xml, "footnotes").join(" ");
  return {
    documentType: text(xml, "documentType"),
    owners,
    aff10b5One: truthy(text(xml, "aff10b5One")),
    footnote10b5: /10b5-?1/i.test(footnotes),
    sales,
  };
}

/** The raw XML sits next to the rendered copy: drop the `xslF345X06/` style prefix. */
export function form4XmlUrl(cik: number, accession: string, primaryDocument: string): string {
  return `https://www.sec.gov/Archives/edgar/data/${cik}/${accession.replace(/-/g, "")}/${primaryDocument.replace(/^xsl[^/]+\//, "")}`;
}

export type Form4Summary = {
  owners: Form4["owners"];
  valueUsd: number;
  sharesSold: number;
  avgPrice: number | null;
  firstDate: string;
  lastDate: string;
};

/** Discretionary open-market sales at or above the floor; null for buys, planned sales, and small ones. */
export function form4SellSummary(doc: Form4): Form4Summary | null {
  if (doc.aff10b5One || doc.footnote10b5 || doc.sales.length === 0) return null;
  const sharesSold = doc.sales.reduce((sum, sale) => sum + sale.sharesSold, 0);
  const priced = doc.sales.filter((sale) => sale.price != null);
  const valueUsd = priced.reduce((sum, sale) => sum + sale.sharesSold * (sale.price ?? 0), 0);
  if (valueUsd < FORM4_MIN_SELL_USD) return null;
  const pricedShares = priced.reduce((sum, sale) => sum + sale.sharesSold, 0);
  const dates = doc.sales.map((sale) => sale.date).filter(Boolean).sort();
  return {
    owners: doc.owners,
    valueUsd,
    sharesSold,
    avgPrice: pricedShares > 0 ? valueUsd / pricedShares : null,
    firstDate: dates[0] ?? "",
    lastDate: dates.at(-1) ?? "",
  };
}

function usdShort(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  return `$${Math.round(value / 1000)}K`;
}

function base(target: FilingTarget, filing: RecentFiling) {
  return {
    id: `sec:${filing.accession}`,
    ticker: target.ticker,
    eventAt: filing.acceptedAt,
    eventAtJst: jst(filing.acceptedAt),
    url: filingIndexUrl(String(target.cik), filing.accession),
  };
}

export function eightKAlert(target: FilingTarget, filing: RecentFiling): AlertItem | null {
  const verdict = classify8k(filing.items);
  if (!verdict) return null;
  const labels = verdict.items.map((item) => `Item ${item} ${itemLabel(item)}`);
  const head = verdict.items[0] ? itemLabel(verdict.items[0]) : "Item 不明";
  const amended = filing.form === "8-K/A";
  return {
    ...base(target, filing),
    kind: "sec_8k",
    priority: verdict.priority,
    title: `${target.ticker} ${filing.form}：${head}${verdict.items.length > 1 ? " ほか" : ""}`,
    body: [labels.join(" / ") || "Item の記載なし", `受付 ${jst(filing.acceptedAt)}`].join("\n"),
    flags: amended ? ["amended"] : [],
    facts: { form: filing.form, accession: filing.accession, cik: target.cik, items: filing.items.join(",") },
  };
}

export function form4Alert(target: FilingTarget, filing: RecentFiling, sale: Form4Summary): AlertItem {
  const who = sale.owners.map((owner) => (owner.role ? `${owner.name}（${owner.role}）` : owner.name)).join("、");
  const when = sale.firstDate === sale.lastDate ? sale.firstDate : `${sale.firstDate}〜${sale.lastDate}`;
  const price = sale.avgPrice != null ? `平均 $${sale.avgPrice.toFixed(2)}` : "価格記載なし";
  return {
    ...base(target, filing),
    kind: "sec_form4_sell",
    priority: sale.valueUsd >= FORM4_HIGH_SELL_USD ? "high" : "normal",
    title: `${target.ticker} インサイダー売却 ${usdShort(sale.valueUsd)}（10b5-1計画外）`,
    body: [`${who} が ${Math.round(sale.sharesSold).toLocaleString("en-US")}株を${price}で売却（${when}）`, `受付 ${jst(filing.acceptedAt)}`].join("\n"),
    flags: [],
    facts: {
      form: filing.form,
      accession: filing.accession,
      cik: target.cik,
      valueUsd: Math.round(sale.valueUsd),
      sharesSold: sale.sharesSold,
      avgPrice: sale.avgPrice != null ? Number(sale.avgPrice.toFixed(4)) : null,
      seller: who,
    },
  };
}

const OFFERING_NOTE: Record<string, string> = {
  "424B1": "公募・売出の最終目論見書",
  "424B3": "登録済み証券の目論見書補足（売出・交換・社債のことも）",
  "424B4": "価格決定後の最終目論見書（公募・売出）",
  "424B5": "シェルからの発行（増資・ATM・社債のどれか）",
  "424B7": "既存株主の売出の目論見書補足",
};

export function offeringAlert(target: FilingTarget, filing: RecentFiling): AlertItem | null {
  if (!OFFERING_FORMS.has(filing.form) || OFFERING_EXCLUDED_GROUPS.has(target.group)) return null;
  return {
    ...base(target, filing),
    kind: "sec_offering",
    priority: "normal",
    title: `${target.ticker} 目論見書 ${filing.form}：増資・売出の可能性`,
    body: [`${OFFERING_NOTE[filing.form] ?? "目論見書"}。株か社債かはリンク先で確認`, `受付 ${jst(filing.acceptedAt)}`].join("\n"),
    flags: [],
    facts: { form: filing.form, accession: filing.accession, cik: target.cik },
  };
}

export function windowStart(now: Date): { date: string; ms: number } {
  return { date: addDays(todayEt(now), -FILING_WINDOW_DAYS), ms: now.getTime() - FILING_WINDOW_DAYS * 86_400_000 };
}
