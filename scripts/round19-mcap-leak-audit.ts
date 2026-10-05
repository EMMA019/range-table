/**
 * Inventory-only scan of PIT mcap leaks. Does not change pit-mcap ranking.
 *
 *   SEC_USER_AGENT='range-table you@example.com' npx tsx scripts/round19-mcap-leak-audit.ts
 *
 * Cache (gitignored): data/.cache/pit/ and data/.cache/round19-mcap-audit/
 * Writes: docs/ROUND19_MCAP_LEAK_AUDIT_ja.md
 */
import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import zlib from "node:zlib";
import { PIT_TICKER_ALIASES } from "../src/lib/pit-cik";
import { buildPitCikMapForTickers } from "../src/lib/pit-cik";
import { pitPaths, pitPriceTicker, PIT_CACHE, loadPitBars } from "../src/lib/pit-dataset";
import { buildPitFactsIndex, loadMergedPitFacts } from "../src/lib/pit-facts-index";
import { pitMarketCapAtDate } from "../src/lib/pit-mcap";
import { forwardShareMultiplier, loadPitSplits, normalizeYahooSplits, savePitSplits, nominalCloseFromAdjusted, type PitSplit } from "../src/lib/pit-splits";
import { sharesOutstandingPit } from "../src/lib/pit-shares";
import {
  SAKA_END,
  SAKA_START,
  filterEligibleCandidates,
  profitabilityStatus,
  rebalanceDates,
  tradingDaysFromBars,
  type ProfitabilityStatus,
  type SakaCandidateContext,
  type SakaGicsInfo,
} from "../src/lib/round19-saka";
import { isSemiSubIndustry } from "../src/lib/round19-saka";
import { loadSp500PitFiles, membersOnDate, uniqueTickersInRange, type Sp500Interval } from "../src/lib/sp500-pit";
import type { Bar } from "../src/lib/types";
import { parseChart, type YahooSplit } from "../src/lib/yahoo";

const DOC = path.join(process.cwd(), "docs", "ROUND19_MCAP_LEAK_AUDIT_ja.md");
const OUT_DIR = path.join(process.cwd(), "data", ".cache", "round19-mcap-audit");
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

type YahooShare = { shares: number; marketCap: number | null; price: number | null };

type Snap = {
  pit: number;
  ref: number;
  adj: number | null;
  profit: ProfitabilityStatus;
  hasPrice: boolean;
  inIndex: boolean;
  sh0: number;
  fwd: number;
  factEnd: string | null;
  mAdj: number;
  mNom: number;
  upcoming: number;
};

type LeakRow = {
  date: string;
  ticker: string;
  kind: "算出不可" | "偽急落" | "参照上位なのにPIT下位" | "ティッカー変更" | "穴埋め";
  reason: string;
  wrong: string;
  right: string;
  note: string;
  refRank: number | null;
  pitRank: number | null;
  gap: number;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function fmtUsd(n: number): string {
  if (!(n > 0)) return "算出不可";
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)}兆ドル`;
  return `${Math.round(n / 1e8)}億ドル`;
}

function rankTxt(rank: number | null, pit: number): string {
  if (!(pit > 0)) return "順位なし（算出不可）";
  return rank == null ? "順位なし" : `${rank}位`;
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
}

function barOnOrBefore(bars: Bar[], date: string): Bar | null {
  let lo = 0;
  let hi = bars.length - 1;
  let best: Bar | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].date <= date) {
      best = bars[mid];
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return best;
}

function upcomingSplitFactor(splits: PitSplit[], asOf: string): number {
  const end = new Date(Date.parse(`${asOf}T12:00:00Z`) + 400 * 86_400_000).toISOString().slice(0, 10);
  let m = 1;
  for (const sp of splits) {
    if (sp.date > asOf && sp.date <= end) m *= sp.numerator / sp.denominator;
  }
  return m;
}

function httpsGet(url: string, headers: Record<string, string>, maxBytes: number): Promise<{ status: number; body: Buffer; setCookie: string[] }> {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: target.hostname,
        path: `${target.pathname}${target.search}`,
        method: "GET",
        headers,
        timeout: 40_000,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const encoding = String(res.headers["content-encoding"] ?? "");
        const stream =
          encoding.includes("gzip") ? res.pipe(zlib.createGunzip()) : encoding.includes("deflate") ? res.pipe(zlib.createInflate()) : res;
        const chunks: Buffer[] = [];
        let received = 0;
        const setCookie = res.headers["set-cookie"] ?? [];
        stream.on("data", (chunk: Buffer) => {
          received += chunk.length;
          if (received > maxBytes) {
            res.destroy();
            reject(new Error(`too large ${received}`));
            return;
          }
          chunks.push(chunk);
        });
        stream.on("end", () => resolve({ status, body: Buffer.concat(chunks), setCookie }));
        stream.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end();
  });
}

async function yahooSession(): Promise<{ cookie: string; crumb: string }> {
  const first = await httpsGet("https://fc.yahoo.com", { "User-Agent": UA }, 1_000_000);
  const cookie = first.setCookie.map((c) => c.split(";")[0]).join("; ");
  const crumbRes = await httpsGet("https://query1.finance.yahoo.com/v1/test/getcrumb", { "User-Agent": UA, Cookie: cookie }, 100_000);
  const crumb = crumbRes.body.toString("utf8").trim();
  if (!crumb || crumb.includes(" ")) throw new Error(`yahoo crumb failed: ${crumb.slice(0, 80)}`);
  return { cookie, crumb };
}

async function fetchChart(symbol: string): Promise<{ bars: Bar[]; splits: PitSplit[] }> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=20y&events=div%2Csplit&includePrePost=false`;
  let last = "chart failed";
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const res = await httpsGet(url, { "User-Agent": UA, Accept: "application/json" }, 8_000_000);
      if (res.status === 429) {
        await sleep(2000 * (attempt + 1));
        last = "429";
        continue;
      }
      if (res.status < 200 || res.status >= 300) {
        last = `HTTP ${res.status}`;
        await sleep(400);
        continue;
      }
      const json = JSON.parse(res.body.toString("utf8")) as {
        chart?: { result?: Array<{ events?: { splits?: Record<string, YahooSplit> } } | null> };
      };
      const result = json.chart?.result?.[0];
      if (!result) throw new Error("empty chart");
      const parsed = parseChart(result as Parameters<typeof parseChart>[0], Date.now() / 1000, 4500, {
        useTotalReturn: true,
      });
      const rawSplits = Object.values(result.events?.splits ?? {});
      return { bars: parsed.bars, splits: normalizeYahooSplits(rawSplits) };
    } catch (e) {
      last = e instanceof Error ? e.message : String(e);
      await sleep(500 * (attempt + 1));
    }
  }
  throw new Error(last);
}

async function fetchShares(symbol: string, session: { cookie: string; crumb: string }): Promise<YahooShare | null> {
  const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=defaultKeyStatistics,price&crumb=${encodeURIComponent(session.crumb)}`;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const res = await httpsGet(url, { "User-Agent": UA, Cookie: session.cookie, Accept: "application/json" }, 2_000_000);
    if (res.status === 429) {
      await sleep(1500 * (attempt + 1));
      continue;
    }
    if (res.status === 401) return null;
    if (res.status < 200 || res.status >= 300) return null;
    const json = JSON.parse(res.body.toString("utf8")) as {
      quoteSummary?: {
        result?: Array<{
          price?: { marketCap?: { raw?: number }; regularMarketPrice?: { raw?: number } };
          defaultKeyStatistics?: { sharesOutstanding?: { raw?: number } };
        }>;
      };
    };
    const row = json.quoteSummary?.result?.[0];
    const shares = row?.defaultKeyStatistics?.sharesOutstanding?.raw;
    if (typeof shares !== "number" || !(shares > 0)) return null;
    const marketCap = row?.price?.marketCap?.raw ?? null;
    const price = row?.price?.regularMarketPrice?.raw ?? null;
    return { shares, marketCap: typeof marketCap === "number" ? marketCap : null, price: typeof price === "number" ? price : null };
  }
  return null;
}

async function fetchFacts(cik: number, userAgent: string): Promise<unknown> {
  const url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10, "0")}.json`;
  let last = "facts failed";
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const res = await httpsGet(
        url,
        { "User-Agent": userAgent, Accept: "application/json", "Accept-Encoding": "gzip, deflate" },
        48_000_000,
      );
      if (res.status === 429 || res.status === 403) {
        await sleep(5000 * (attempt + 1));
        last = `HTTP ${res.status}`;
        continue;
      }
      if (res.status < 200 || res.status >= 300) {
        last = `HTTP ${res.status}`;
        await sleep(400);
        continue;
      }
      return JSON.parse(res.body.toString("utf8"));
    } catch (e) {
      last = e instanceof Error ? e.message : String(e);
      await sleep(800 * (attempt + 1));
    }
  }
  throw new Error(last);
}

function writeJson(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
}

async function ensurePrices(tickers: string[]) {
  const paths = pitPaths(PIT_CACHE);
  fs.mkdirSync(paths.prices, { recursive: true });
  const groups = new Map<string, string[]>();
  for (const t of tickers) {
    const y = pitPriceTicker(t).replace(/\./g, "-");
    const list = groups.get(y) ?? [];
    list.push(t);
    groups.set(y, list);
  }
  let n = 0;
  const failed: string[] = [];
  for (const [ySym, members] of groups) {
    const needBars = members.some((t) => loadPitBars(t, PIT_CACHE).length < 200);
    const needSplits = members.some((t) => !fs.existsSync(path.join(paths.root, "splits", `${t.replace(/\./g, "-")}.json`)));
    if (!needBars && !needSplits) continue;
    n += 1;
    try {
      const { bars, splits } = await fetchChart(ySym);
      for (const t of members) {
        const sym = t.replace(/\./g, "-");
        if (needBars) fs.writeFileSync(path.join(paths.prices, `${sym}.json`), JSON.stringify(bars));
        if (needSplits) savePitSplits(t, splits, paths.root);
      }
      if (n % 40 === 0) console.error(`[audit] charts ${n}/${groups.size} ${ySym} bars=${bars.length} splits=${splits.length}`);
      await sleep(120);
    } catch (e) {
      failed.push(`${ySym}:${e instanceof Error ? e.message : e}`);
      console.error(`[audit] chart skip ${ySym}`, e instanceof Error ? e.message : e);
    }
  }
  return { symbols: groups.size, failed };
}

async function ensureShares(tickers: string[]) {
  const file = path.join(pitPaths(PIT_CACHE).root, "yahoo_shares.json");
  const cached: Record<string, YahooShare> = fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, YahooShare>) : {};
  const groups = new Map<string, string[]>();
  for (const t of tickers) {
    const y = pitPriceTicker(t).replace(/\./g, "-");
    const list = groups.get(y) ?? [];
    list.push(t);
    groups.set(y, list);
  }
  const pending = [...groups.keys()].filter((y) => !groups.get(y)!.every((t) => cached[t]?.shares > 0));
  if (!pending.length) return cached;
  const session = await yahooSession();
  let n = 0;
  for (const ySym of pending) {
    n += 1;
    try {
      const row = await fetchShares(ySym, session);
      if (row) for (const t of groups.get(ySym) ?? []) cached[t] = row;
    } catch (e) {
      console.error(`[audit] shares skip ${ySym}`, e instanceof Error ? e.message : e);
    }
    if (n % 50 === 0) {
      writeJson(file, cached);
      console.error(`[audit] shares ${n}/${pending.length}`);
    }
    await sleep(90);
  }
  writeJson(file, cached);
  return cached;
}

async function ensureFacts(tickers: string[], cikOf: Map<string, number>, userAgent: string) {
  const dir = pitPaths(PIT_CACHE).facts;
  fs.mkdirSync(dir, { recursive: true });
  const byCik = new Map<number, string[]>();
  for (const t of tickers) {
    const cik = cikOf.get(t);
    if (!cik) continue;
    const list = byCik.get(cik) ?? [];
    list.push(t);
    byCik.set(cik, list);
  }
  const sup = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "pit_facts_supplement_cik.json"), "utf8")) as {
    cik?: Record<string, number>;
  };
  for (const cik of new Set(Object.values(sup.cik ?? {}))) {
    if (!byCik.has(cik)) byCik.set(cik, []);
  }
  let n = 0;
  const failed: string[] = [];
  for (const [cik, members] of byCik) {
    const dests = members.map((t) => path.join(dir, `${t}.json`));
    const supPath = path.join(dir, `_supplement_cik_${cik}.json`);
    const isSupplementOnly = members.length === 0;
    const have = isSupplementOnly ? fs.existsSync(supPath) : dests.every((f) => fs.existsSync(f));
    if (have) continue;
    n += 1;
    try {
      const json = await fetchFacts(cik, userAgent);
      const text = JSON.stringify(json);
      for (const f of dests) fs.writeFileSync(f, text);
      if (isSupplementOnly || Object.values(sup.cik ?? {}).includes(cik)) fs.writeFileSync(supPath, text);
      if (n % 25 === 0) console.error(`[audit] facts ${n} cik=${cik}`);
      await sleep(160);
    } catch (e) {
      failed.push(`${cik}:${e instanceof Error ? e.message : e}`);
      console.error(`[audit] facts skip ${cik}`, e instanceof Error ? e.message : e);
    }
  }
  return { groups: byCik.size, fetched: n, failed };
}

function gicsInfo(gics: Map<string, { sector: string; subIndustry: string }>, t: string): SakaGicsInfo | null {
  const g = gics.get(t);
  if (!g) return null;
  return { sector: g.sector, subIndustry: g.subIndustry, semiBucket: isSemiSubIndustry(g.subIndustry) };
}

function buildReason(pit: number, ref: number, snap: Snap, pxRatio: number | null): string {
  const px = pxRatio == null ? "—" : pxRatio.toFixed(2);
  const head =
    `事実: PIT ${fmtUsd(pit)}、Yahoo参照 ${fmtUsd(ref)}、前四半期比 adjclose ${px}、` +
    `EDGAR株数 ${snap.sh0 > 0 ? snap.sh0.toLocaleString("en-US") : "なし"}（factEnd ${snap.factEnd ?? "—"}、前方分割 ×${snap.fwd.toFixed(2)}）、` +
    `mAdj ${fmtUsd(snap.mAdj)}、mNom ${fmtUsd(snap.mNom)}、asOf後400日の分割 ×${snap.upcoming.toFixed(2)}。`;
  const overCap = Math.max(snap.mAdj, snap.mNom) >= 4e12;
  if (!(pit > 0) && overCap) {
    return `${head} 事実（コード）: pit-mcap.ts は候補を 1e9 超かつ 4e12 未満に限る。試算が 4兆ドル以上なので 0 になる。`;
  }
  if (!(pit > 0) && !(snap.sh0 > 0)) {
    return `${head} 推定: 株数ファクトが無く pitMarketCap が 0。`;
  }
  if (!(pit > 0)) {
    return `${head} 推定: 価格と株数はあるが pitMarketCap が 0（候補フィルタで落ちた）。`;
  }
  if (snap.upcoming > 1.5 && snap.mNom > snap.mAdj * 2 && Math.abs(pit - snap.mAdj) / snap.mAdj < 0.08) {
    return `${head} 事実: PIT が mAdj と一致し mNom はそれより大きい。推定: asOf から 400 日以内の分割ヒューリスティックが名義時価を捨て、調整終値×株数を返している。`;
  }
  if (ref > 0 && pit < ref * 0.5 && (pxRatio == null || pxRatio >= 0.7)) {
    return `${head} 推定: 価格は大きく崩れていないのに PIT が参照の半分未満。株数と分割の対応ずれ。`;
  }
  return head;
}

function esc(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

async function main() {
  const userAgent = process.env.SEC_USER_AGENT?.trim() ?? "";
  if (!/\S+@\S+\.\S+/.test(userAgent)) {
    console.error("SEC_USER_AGENT with a contact email is required for companyfacts");
    process.exit(1);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const { intervals, gics } = await loadSp500PitFiles(PIT_CACHE);
  const universe = uniqueTickersInRange(intervals, SAKA_START, SAKA_END);
  const tickers = [...new Set([...universe, "SPY"])];
  console.error(`[audit] universe ${universe.length}`);

  const cikResolved = await buildPitCikMapForTickers(
    PIT_CACHE,
    gics,
    universe,
    undefined,
  );
  const cikOfNum = new Map<string, number>();
  for (const [t, r] of cikResolved) cikOfNum.set(t, r.cik);

  const chartPromise = ensurePrices(tickers);
  const factsPromise = ensureFacts(universe, cikOfNum, userAgent);
  const [charts, facts] = await Promise.all([chartPromise, factsPromise]);
  const shares = await ensureShares(universe);
  console.error(`[audit] charts failed ${charts.failed.length} facts failed ${facts.failed.length} shares ${Object.keys(shares).length}`);

  const spy = loadPitBars("SPY", PIT_CACHE);
  if (spy.length < 500) throw new Error("SPY bars missing");
  const calendar = tradingDaysFromBars(spy);
  const rebals = rebalanceDates(calendar, SAKA_START, SAKA_END);
  const memberCache = new Map<string, string[]>();
  const membersOn = (date: string) => {
    const hit = memberCache.get(date);
    if (hit) return hit;
    const list = membersOnDate(intervals, date);
    memberCache.set(date, list);
    return list;
  };

  const factsIndex = buildPitFactsIndex(PIT_CACHE);
  const barsBy = new Map<string, Bar[]>();
  const splitsBy = new Map<string, PitSplit[]>();
  const factsBy = new Map<string, unknown>();
  for (const t of universe) {
    const bars = loadPitBars(t, PIT_CACHE);
    if (bars.length) barsBy.set(t, bars);
    splitsBy.set(t, loadPitSplits(t, PIT_CACHE));
  }
  let loadedFacts = 0;
  for (const t of universe) {
    const json = loadMergedPitFacts(t, cikOfNum.get(t) ?? null, factsIndex, PIT_CACHE);
    if (json) {
      factsBy.set(t, json);
      loadedFacts += 1;
    }
  }
  console.error(`[audit] loaded facts ${loadedFacts} prices ${barsBy.size} rebals ${rebals.length}`);

  const snaps = new Map<string, Map<string, Snap>>();
  const closeOf = (t: string, date: string) => barOnOrBefore(barsBy.get(t) ?? [], date)?.c ?? null;

  for (const t of universe) {
    const per = new Map<string, Snap>();
    const bars = barsBy.get(t) ?? [];
    const splits = splitsBy.get(t) ?? [];
    const factsJson = factsBy.get(t);
    const yShares = shares[t]?.shares ?? 0;
    for (const date of rebals) {
      const bar = barOnOrBefore(bars, date);
      const point = factsJson ? sharesOutstandingPit(factsJson, date) : null;
      const sh0 = point?.shares ?? 0;
      const fwd = point ? forwardShareMultiplier(splits, point.factEnd, date) : 1;
      const sh = sh0 > 0 ? sh0 * fwd : 0;
      const adj = bar?.c ?? null;
      const nominal =
        bar == null
          ? 0
          : bar.mcapC != null && bar.mcapC > 0
            ? bar.mcapC
            : nominalCloseFromAdjusted(bar.c, bar.date, splits);
      const pit = bars.length ? pitMarketCapAtDate(bars, factsJson, date, splits) : 0;
      const ref = adj != null && yShares > 0 ? adj * yShares : 0;
      per.set(date, {
        pit,
        ref,
        adj,
        profit: profitabilityStatus(factsJson, date),
        hasPrice: adj != null && adj > 0,
        inIndex: false,
        sh0,
        fwd,
        factEnd: point?.factEnd ?? null,
        mAdj: adj != null && sh > 0 ? adj * sh : 0,
        mNom: nominal > 0 && sh > 0 ? nominal * sh : 0,
        upcoming: upcomingSplitFactor(splits, date),
      });
    }
    snaps.set(t, per);
  }

  const ctxFor = (date: string): SakaCandidateContext => ({
    calendar,
    closeHistory: new Map(),
    gicsOf: (t) => gicsInfo(gics, t),
    mcap: (t) => snaps.get(t)?.get(date)?.pit ?? 0,
    sharesLookup: () => ({ shares: 0, stale: true }),
    profitable: (t) => snaps.get(t)?.get(date)?.profit === "profitable",
    hasPrice: (t) => snaps.get(t)?.get(date)?.hasPrice ?? false,
    cikOf: (t) => cikOfNum.get(t) ?? null,
  });

  type Ranked = { t: string; pit: number; ref: number; pitRank: number | null; refRank: number | null };
  const rankedByDate = new Map<string, Ranked[]>();
  const pitTop15 = new Map<string, string[]>();

  for (const date of rebals) {
    const members = new Set(membersOn(date));
    for (const t of members) {
      const s = snaps.get(t)?.get(date);
      if (s) s.inIndex = true;
    }
    const eligible = filterEligibleCandidates([...members], date, ctxFor(date));
    const rows = eligible.map((t) => {
      const s = snaps.get(t)!.get(date)!;
      return { t, pit: s.pit, ref: s.ref };
    });
    const byPit = rows.filter((r) => r.pit > 0).sort((a, b) => b.pit - a.pit || a.t.localeCompare(b.t));
    const byRef = rows.filter((r) => r.ref > 0).sort((a, b) => b.ref - a.ref || a.t.localeCompare(b.t));
    const pitRank = new Map(byPit.map((r, i) => [r.t, i + 1]));
    const refRank = new Map(byRef.map((r, i) => [r.t, i + 1]));
    rankedByDate.set(
      date,
      rows.map((r) => ({
        t: r.t,
        pit: r.pit,
        ref: r.ref,
        pitRank: pitRank.get(r.t) ?? null,
        refRank: refRank.get(r.t) ?? null,
      })),
    );
    pitTop15.set(date, byPit.slice(0, 15).map((r) => r.t));
  }

  const rankOf = (date: string, ticker: string) => rankedByDate.get(date)?.find((r) => r.t === ticker) ?? null;

  const rows: LeakRow[] = [];
  const seen = new Set<string>();
  const push = (row: LeakRow) => {
    const k = `${row.date}|${row.ticker}|${row.kind}`;
    if (seen.has(k)) return;
    seen.add(k);
    rows.push(row);
  };

  for (let i = 0; i < rebals.length; i += 1) {
    const date = rebals[i]!;
    const prev = i > 0 ? rebals[i - 1]! : null;
    for (const row of rankedByDate.get(date) ?? []) {
      const snap = snaps.get(row.t)!.get(date)!;
      const prevSnap = prev ? snaps.get(row.t)?.get(prev) : undefined;
      const prevRank = prev ? rankOf(prev, row.t) : null;
      const pxRatio = prevSnap?.adj && snap.adj ? snap.adj / prevSnap.adj : null;
      const pitRatio = prevSnap && prevSnap.pit > 0 && snap.pit > 0 ? snap.pit / prevSnap.pit : null;
      const priceOk = pxRatio == null || pxRatio >= 0.7;
      const collapsed = !(snap.pit > 0) || (pitRatio != null && pitRatio < 0.55) || (snap.ref > 0 && snap.pit > 0 && snap.pit < snap.ref * 0.45);
      const priorTop = (prevRank?.pitRank ?? 99) <= 20;
      const crashed =
        priorTop &&
        priceOk &&
        collapsed &&
        ((row.pitRank ?? 999) >= (prevRank?.pitRank ?? 0) + 25 || (row.pitRank ?? 999) >= 40 || !(snap.pit > 0));
      const uncomputable =
        !(snap.pit > 0) &&
        ((row.refRank ?? 999) <= 40 || snap.ref >= 100e9 || (prevRank?.pitRank ?? 999) <= 30);
      const refTopPitLow =
        (row.refRank ?? 999) <= 15 &&
        ((row.pitRank ?? 999) > 30 || !(snap.pit > 0)) &&
        priceOk &&
        (!(snap.pit > 0) || (snap.ref > 0 && snap.pit < snap.ref * 0.5));

      let kind: LeakRow["kind"] | null = null;
      if (crashed) kind = !(snap.pit > 0) ? "算出不可" : "偽急落";
      else if (uncomputable) kind = "算出不可";
      else if (refTopPitLow) kind = "参照上位なのにPIT下位";
      if (!kind) continue;
      const otherClass = otherShareClassNote(row.t, date, cikOfNum, rankOf);
      push({
        date,
        ticker: row.t,
        kind,
        reason: buildReason(snap.pit, snap.ref, snap, pxRatio),
        wrong: `${rankTxt(row.pitRank, snap.pit)} / PIT ${fmtUsd(snap.pit)}`,
        right:
          row.refRank == null
            ? `参照時価 ${fmtUsd(snap.ref)}（現行株数×adjclose。順位なし）`
            : `参照 ${row.refRank}位 / ${fmtUsd(snap.ref)}（現行株数×adjclose）`,
        note: otherClass,
        refRank: row.refRank,
        pitRank: row.pitRank,
        gap: (row.pitRank ?? 400) - (row.refRank ?? prevRank?.pitRank ?? 1),
      });
    }
  }

  const renameAppendix: string[] = [];
  const intervalsByTicker = new Map<string, Sp500Interval[]>();
  for (const row of intervals) {
    const list = intervalsByTicker.get(row.ticker) ?? [];
    list.push(row);
    intervalsByTicker.set(row.ticker, list);
  }
  const byCik = new Map<number, Sp500Interval[]>();
  for (const t of universe) {
    const cik = cikOfNum.get(t);
    if (!cik) continue;
    for (const row of intervalsByTicker.get(t) ?? []) {
      const list = byCik.get(cik) ?? [];
      list.push(row);
      byCik.set(cik, list);
    }
  }
  const renameKeys = new Set<string>();
  for (const [cik, list] of byCik) {
    for (const a of list) {
      if (!a.endDate) continue;
      for (const b of list) {
        if (a.ticker === b.ticker) continue;
        const gap = daysBetween(a.endDate, b.startDate);
        if (gap < -1 || gap > 3) continue;
        const date = rebals.find((d) => d > a.endDate! && membersOn(d).includes(b.ticker) && !membersOn(d).includes(a.ticker));
        if (!date) continue;
        const key = `${a.ticker}->${b.ticker}@${date}`;
        if (renameKeys.has(key)) continue;
        renameKeys.add(key);
        const prev = rebals[rebals.indexOf(date) - 1];
        const prevRank = prev ? rankOf(prev, a.ticker) : null;
        const nowB = rankOf(date, b.ticker);
        const snapB = snaps.get(b.ticker)?.get(date);
        push({
          date,
          ticker: `${a.ticker}→${b.ticker}`,
          kind: "ティッカー変更",
          reason:
            `事実: 会員区間 ${a.ticker} ${a.startDate}～${a.endDate}、${b.ticker} ${b.startDate}～${b.endDate ?? "継続"}。同一 CIK ${cik}。` +
            `終了日と開始日の差は ${gap} 日。${date} のメンバー集合では ${a.ticker} が消え ${b.ticker} だけが残るため、シミュレータは売却＋新規買いになる。`,
          wrong: prevRank
            ? `${a.ticker} は構成外扱い（直前 ${prev} は PIT ${rankTxt(prevRank.pitRank, prevRank.pit)}）`
            : `${a.ticker} は構成外扱い`,
          right: nowB
            ? `${b.ticker} 参照 ${nowB.refRank ?? "—"}位 / PIT ${rankTxt(nowB.pitRank, snapB?.pit ?? 0)}（同一会社）`
            : `${b.ticker} は eligible 外（黒字・価格・セクターを確認）`,
          note: "価格エイリアスはあっても会員名簿はティッカー別のまま。",
          refRank: nowB?.refRank ?? null,
          pitRank: nowB?.pitRank ?? null,
          gap: 0,
        });
      }
    }
  }
  for (const [oldT, newT] of Object.entries(PIT_TICKER_ALIASES)) {
    const a = (intervalsByTicker.get(oldT) ?? []).find((r) => r.endDate);
    const b = (intervalsByTicker.get(newT) ?? [])[0];
    if (!a?.endDate || !b) continue;
    const gap = daysBetween(a.endDate, b.startDate);
    if (gap < -1 || gap > 3) continue;
    const ca = cikOfNum.get(oldT);
    const cb = cikOfNum.get(newT);
    if (ca && cb && ca === cb) continue;
    renameAppendix.push(`- ${oldT}→${newT}: 区間は隣接（差 ${gap} 日）だが CIK ${ca ?? "?"} と ${cb ?? "?"}。合併・買収としてリークに数えない。`);
  }

  for (let i = 0; i < rebals.length; i += 1) {
    const date = rebals[i]!;
    const prev = i > 0 ? rebals[i - 1]! : null;
    const dropped = rows.filter(
      (r) =>
        r.date === date &&
        (r.kind === "算出不可" || r.kind === "偽急落" || r.kind === "参照上位なのにPIT下位") &&
        (r.refRank ?? 99) <= 15,
    );
    if (!dropped.length) continue;
    const droppedNames = dropped.map((r) => r.ticker.split("→")[0]).join(", ");
    const prevBook = new Set(prev ? pitTop15.get(prev) ?? [] : []);
    for (const t of pitTop15.get(date) ?? []) {
      const info = rankOf(date, t);
      if (!info || (info.refRank ?? 0) <= 15) continue;
      if ((info.refRank ?? 0) <= 15) continue;
      push({
        date,
        ticker: t,
        kind: "穴埋め",
        reason: `事実: PIT 時価上位15に入っているが、Yahoo参照順位は ${info.refRank ?? "—"}位。この日は参照上位15から ${droppedNames} が落ちている。`,
        wrong: `PIT ${info.pitRank}位 / ${fmtUsd(info.pit)}（上位15入り）`,
        right: `参照 ${info.refRank}位 / ${fmtUsd(info.ref)}`,
        note: `${prevBook.has(t) ? "前四半期もPIT上位15" : "前四半期のPIT上位15にはいない"}。脱落: ${droppedNames}。`,
        refRank: info.refRank,
        pitRank: info.pitRank,
        gap: (info.pitRank ?? 0) - (info.refRank ?? 0),
      });
    }
  }

  const amznDate = rebals.find((d) => d.startsWith("2023-04"));
  const amzn = amznDate ? snaps.get("AMZN")?.get(amznDate) : undefined;
  const amznRank = amznDate ? rankOf(amznDate, "AMZN") : null;

  const kindOrder = ["算出不可", "偽急落", "参照上位なのにPIT下位", "ティッカー変更", "穴埋め"] as const;
  rows.sort((a, b) => a.date.localeCompare(b.date) || kindOrder.indexOf(a.kind) - kindOrder.indexOf(b.kind) || a.ticker.localeCompare(b.ticker));

  const counts = Object.fromEntries(kindOrder.map((k) => [k, rows.filter((r) => r.kind === k).length])) as Record<(typeof kindOrder)[number], number>;
  const worst = rows
    .filter((r) => r.kind !== "穴埋め" && r.kind !== "ティッカー変更")
    .sort((a, b) => (a.refRank ?? 999) - (b.refRank ?? 999) || b.gap - a.gap || a.date.localeCompare(b.date))
    .slice(0, 10);

  const withPrice = universe.filter((t) => (barsBy.get(t)?.length ?? 0) > 200).length;
  const withShares = universe.filter((t) => (shares[t]?.shares ?? 0) > 0).length;
  const lines: string[] = [];
  lines.push("# Round 19 PIT 時価総額リーク在庫");
  lines.push("");
  lines.push("**状態:** 検出のみ。`src/lib/pit-mcap.ts` を含む本番の時価計算は変更していない。修正コミットはまだない。");
  lines.push(`**生成:** \`scripts/round19-mcap-leak-audit.ts\`（${new Date().toISOString().slice(0, 10)}）`);
  lines.push("**サイト非掲載。** v2 の探索はしていない。");
  lines.push("");
  lines.push("## 検出規則");
  lines.push("");
  lines.push(`対象は ${SAKA_START} ～ ${SAKA_END} の四半期リバランス ${rebals.length} 日（SPY カレンダーの四半期初セッション。\`rebalanceDates\`）。`);
  lines.push("");
  lines.push("| 項目 | 定義 |");
  lines.push("|---|---|");
  lines.push("| PIT 時価 | 現行 `pitMarketCapAtDate`。本スキャンでは未修正 |");
  lines.push("| Yahoo 参照 | 取得日の `sharesOutstanding` × その日の adjclose（分割・配当調整済み終値）。現行株数なので、自社株買いの分だけ遠い過去は過少・増資の分だけ過大になり得る。四半期の価格比と、PIT との倍率を主に使う |");
  lines.push("| eligible | `filterEligibleCandidates`（テーマ除外、金融、価格あり、TTM 黒字、同一 CIK は優先株クラス）。mcap≤0 でも eligible には残る |");
  lines.push("| PIT 順位 | eligible のうち **mcap>0** だけを降順。0 は「順位なし（算出不可）」 |");
  lines.push("| 参照順位 | 同じ eligible のうち参照時価>0 の降順 |");
  lines.push("");
  lines.push("1. **算出不可:** eligible かつ PIT mcap≤0、かつ（参照順位≤40、または参照≥1000億ドル、または直前の PIT 順位≤30）。");
  lines.push("2. **偽急落:** 直前の PIT 順位≤20、価格（adjclose）の前四半期比≥0.70、PIT 時価が直前の 55% 未満または参照の 45% 未満または 0、かつ順位が 25 以上悪化するか 40 位以下。");
  lines.push("3. **参照上位なのに PIT 下位:** 参照順位≤15、PIT 順位>30 または算出不可、PIT が参照の半分未満（または 0）、価格比≥0.70。上の 2 つに当てはまらない継続ずれ。");
  lines.push("4. **ティッカー変更:** 同一 CIK で、旧区間の終了日と新区間の開始日の差が -1～3 日。その後の最初のリバランスで旧ティッカーがメンバーから消え、新しいティッカーだけが残る。CIK が違う隣接（合併）はリークにしない。");
  lines.push("5. **穴埋め:** その日に参照順位≤15 の脱落があり、PIT 時価上位 15 に入っているが参照順位は 15 位より悪い名前。上位 15 は plain mcap の採用枠（N=15）に合わせた。");
  lines.push("");
  lines.push("赤字（TTM・filed PIT）で eligible から落ちた銘柄はリークにしない。");
  lines.push("");
  lines.push("## カバレッジ");
  lines.push("");
  lines.push("| 項目 | 数 |");
  lines.push("|---|---:|");
  lines.push(`| PIT ユニーク銘柄 | ${universe.length} |`);
  lines.push(`| CIK 解決 | ${cikOfNum.size} |`);
  lines.push(`| 価格 200 本超 | ${withPrice} |`);
  lines.push(`| companyfacts 読込 | ${loadedFacts} |`);
  lines.push(`| Yahoo 現行株数 | ${withShares} |`);
  lines.push(`| リバランス日 | ${rebals.length} |`);
  lines.push(`| チャート取得失敗 | ${charts.failed.length} |`);
  lines.push(`| facts 取得失敗 | ${facts.failed.length} |`);
  lines.push("");
  if (charts.failed.length) lines.push(`チャート失敗（先頭）: ${charts.failed.slice(0, 12).join(", ")}`);
  if (facts.failed.length) lines.push(`facts 失敗（先頭）: ${facts.failed.slice(0, 12).join(", ")}`);
  lines.push("");
  lines.push("## 件数");
  lines.push("");
  lines.push("| 現象 | 件数 |");
  lines.push("|---|---:|");
  for (const k of kindOrder) lines.push(`| ${k} | ${counts[k]} |`);
  lines.push(`| 合計 | ${rows.length} |`);
  lines.push("");
  lines.push("## 大きいもの 10 件");
  lines.push("");
  lines.push("参照順位が良く、PIT との差が大きい順。穴埋めと改名は除く。");
  lines.push("");
  for (const r of worst) {
    lines.push(`- **${r.date} ${r.ticker}**（${r.kind}）: 誤 ${r.wrong}。見込み ${r.right}。`);
  }
  lines.push("");
  lines.push("## 在庫");
  lines.push("");
  lines.push("| リバランス日 | ティッカー | 現象 | 理由（推定・事実） | 当時の誤った eligible 順位 / mcap | 正しい順位の見込み（独立参照: Yahoo shares×unadj/adj close） | 備考 |");
  lines.push("|---|---|---|---|---|---|---|");
  for (const r of rows) {
    lines.push(`| ${r.date} | ${esc(r.ticker)} | ${r.kind} | ${esc(r.reason)} | ${esc(r.wrong)} | ${esc(r.right)} | ${esc(r.note)} |`);
  }
  lines.push("");
  lines.push("## 2023-04 AMZN はリークではない");
  lines.push("");
  if (amznDate && amzn) {
    const eligible = amzn.profit === "profitable";
    lines.push(
      `${amznDate} の AMZN は profitability=\`${amzn.profit}\`、PIT ${fmtUsd(amzn.pit)}、参照 ${fmtUsd(amzn.ref)}、eligible 順位 ${amznRank ? rankTxt(amznRank.pitRank, amznRank.pit) : "eligible 外"}。` +
        (amzn.profit === "loss"
          ? " TTM 赤字による除外で、在庫には載せていない。"
          : eligible
            ? " 黒字判定だったため、上の規則に当たれば表に出ている。"
            : " 黒字ではないため、時価リークとしては載せていない。"),
    );
  } else {
    lines.push("2023-04 のリバランス日または AMZN のスナップショットが取れなかった。");
  }
  lines.push("");
  lines.push("## 合併などでリークにしなかった隣接");
  lines.push("");
  lines.push(renameAppendix.length ? renameAppendix.join("\n") : "（なし）");
  lines.push("");
  lines.push("## 既知ケースの有無");
  lines.push("");
  const expect: Array<[string, string]> = [
    ["2025-10", "NVDA"],
    ["2026-07", "AAPL"],
    ["2026-07", "GOOGL"],
    ["2021-07", "AMZN"],
    ["2021-07", "GOOGL"],
    ["2023-07", "NVDA"],
    ["2022-07", "FB→META"],
  ];
  lines.push("| 目安 | ティッカー | 在庫にあるか |");
  lines.push("|---|---|---|");
  for (const [prefix, ticker] of expect) {
    const hit = rows.some((r) => r.date.startsWith(prefix) && (r.ticker === ticker || r.ticker.includes(ticker)));
    lines.push(`| ${prefix} | ${ticker} | ${hit ? "ある" : "ない"} |`);
  }
  lines.push("");
  lines.push("*参照の「unadj」は、adjclose が分割調整済みであることに加え、バーの `mcapC`（名義寄り）を理由欄の mNom に使っている。順位の独立参照そのものは現行株数×adjclose。*");
  lines.push("");

  fs.writeFileSync(DOC, lines.join("\n"));
  writeJson(path.join(OUT_DIR, "summary.json"), {
    counts,
    rebals: rebals.length,
    rows: rows.length,
    worst: worst.map((r) => ({ date: r.date, ticker: r.ticker, kind: r.kind })),
    amzn: amznDate ? { date: amznDate, profit: amzn?.profit, pit: amzn?.pit } : null,
  });
  console.log(JSON.stringify({ doc: DOC, counts, rows: rows.length, rebals: rebals.length }, null, 2));
}

function otherShareClassNote(
  ticker: string,
  date: string,
  cikOfNum: Map<string, number>,
  rankOf: (date: string, ticker: string) => { pitRank: number | null; refRank: number | null; pit: number } | null,
): string {
  const cik = cikOfNum.get(ticker);
  if (!cik) return "";
  const peers = [...cikOfNum.entries()].filter(([t, c]) => c === cik && t !== ticker).map(([t]) => t);
  if (!peers.length) return "";
  const bits = peers.map((p) => {
    const r = rankOf(date, p);
    return r ? `${p} PIT ${rankTxt(r.pitRank, r.pit)}` : `${p} は eligible 外`;
  });
  return `同一CIK: ${bits.join("; ")}`;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
