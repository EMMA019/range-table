import { BOX_BOTTOM_MAX, BOX_REBOUND_MAX, BOX_TOP_MIN, ATR_MIN_PCT, CORR_LOW_MAX, VOLUME_CONFIRM_RATIO, VOLUME_SURGE_RATIO, VOLUME_THIN_RATIO } from "./constants";
import { TAG_SECTORS, type SortId } from "./copy";
import { boxShown } from "./format";
import type { Quote, TickerRow } from "./types";

export type ViewFilters = {
  sector: string;
  bottom: boolean;
  top: boolean;
  breakout: boolean;
  continued: boolean;
  surge: boolean;
  earnings: boolean;
  lowCorr: boolean;
  atrMin: boolean;
  rebound: boolean;
  inOk: boolean;
  hideWatch: boolean;
  sort: SortId;
  q: string;
};

export function atTop(quote: Quote): boolean {
  return boxShown(quote.boxPct) >= BOX_TOP_MIN;
}

export function continuedBreakout(quote: Quote): boolean {
  return atTop(quote) && quote.brokeHigh;
}

/** Same one-decimal rounding as the row, so a badge matches the 倍 it sits next to. */
function volumeRatioShown(ratio: number): number {
  return Math.round(ratio * 10) / 10;
}

export function volumeThin(quote: Quote): boolean {
  return quote.volumeRatio != null && volumeRatioShown(quote.volumeRatio) < VOLUME_THIN_RATIO;
}

export function volumeSurge(quote: Quote): boolean {
  return quote.volumeRatio != null && volumeRatioShown(quote.volumeRatio) >= VOLUME_SURGE_RATIO;
}

/** Box at or under 25% and at least one confirmed rebound day. */
export function waitingRebound(quote: Quote): boolean {
  return boxShown(quote.boxPct) <= BOX_REBOUND_MAX && quote.reboundDays != null && quote.reboundDays >= 1;
}

/** Two-decimal basket correlation at or under 0.3, including negatives. Missing correlation stays out. */
export function lowBasketCorr(row: TickerRow): boolean {
  if (row.corrBasket == null || !Number.isFinite(row.corrBasket)) return false;
  return Math.round(row.corrBasket * 100) / 100 <= CORR_LOW_MAX;
}

/** ATR(14) ÷ close × 100. Null when either value is missing or non-positive. */
export function atrPctOfClose(quote: Quote): number | null {
  if (!Number.isFinite(quote.close) || quote.close <= 0) return null;
  if (!Number.isFinite(quote.atr14) || quote.atr14 <= 0) return null;
  return (quote.atr14 / quote.close) * 100;
}

export function meetsAtrMinPct(quote: Quote, minPct = ATR_MIN_PCT): boolean {
  const pct = atrPctOfClose(quote);
  return pct != null && pct >= minPct;
}

const CONTINUED_LABEL = "上抜け継続？（売り急ぎ注意）";

export function continuedBreakoutText(quote: Quote): string {
  if (quote.volumeRatio != null && volumeRatioShown(quote.volumeRatio) < VOLUME_CONFIRM_RATIO) {
    return `${CONTINUED_LABEL}（出来高伴わず）`;
  }
  return CONTINUED_LABEL;
}

export function applyView(rows: TickerRow[], filters: ViewFilters): TickerRow[] {
  const query = filters.q.trim().toLowerCase();
  const filtered = rows.filter((row) => {
    const tagged = TAG_SECTORS.find(
      (item) => item.id === filters.sector || item.legacy.some((legacy) => legacy === filters.sector),
    );
    if (tagged) {
      if (!row.tags.includes(tagged.tag)) return false;
    } else if (filters.sector !== "all" && row.sectorId !== filters.sector) return false;
    if (filters.hideWatch && row.watchOnly) return false;
    if (filters.bottom) {
      if (!row.quote || boxShown(row.quote.boxPct) > BOX_BOTTOM_MAX) return false;
    }
    if (filters.top) {
      if (!row.quote || boxShown(row.quote.boxPct) < BOX_TOP_MIN) return false;
    }
    if (filters.breakout && !row.quote?.brokeHigh) return false;
    if (filters.continued && !(row.quote && continuedBreakout(row.quote))) return false;
    if (filters.surge && !(row.quote && volumeSurge(row.quote))) return false;
    if (filters.earnings && !row.earnings?.warn) return false;
    if (filters.lowCorr && !lowBasketCorr(row)) return false;
    if (filters.atrMin && !(row.quote && meetsAtrMinPct(row.quote))) return false;
    if (filters.rebound && !(row.quote && waitingRebound(row.quote))) return false;
    if (filters.inOk && row.quote?.entrySignal !== "in_ok") return false;
    if (query) {
      const hay = `${row.ticker} ${row.description} ${row.notes} ${row.sector} ${row.sectorLabel ?? ""} ${row.tags.join(" ")}`.toLowerCase();
      if (!hay.includes(query)) return false;
    }
    return true;
  });

  filtered.sort((a, b) => compareRows(a, b, filters.sort));
  return filtered;
}

function earnRank(row: TickerRow): number {
  const earnings = row.earnings;
  if (!earnings) return 20_000;
  if (earnings.state === "today") return 0;
  if (earnings.state === "upcoming") return earnings.tradingDays ?? 10_000;
  return 9_000;
}

function peRank(pe: number | null): number {
  if (pe == null || !Number.isFinite(pe) || !(pe > 0)) return Number.POSITIVE_INFINITY;
  return pe;
}

function compareRows(a: TickerRow, b: TickerRow, sort: SortId): number {
  if (sort === "earnAsc") {
    const d = earnRank(a) - earnRank(b);
    if (d !== 0) return d;
    return a.ticker.localeCompare(b.ticker);
  }

  if (sort === "volDesc") {
    const av = a.quote?.volumeRatio;
    const bv = b.quote?.volumeRatio;
    if (av == null && bv == null) return a.ticker.localeCompare(b.ticker);
    if (av == null) return 1;
    if (bv == null) return -1;
    if (av !== bv) return av > bv ? -1 : 1;
    return a.ticker.localeCompare(b.ticker);
  }

  if (sort === "rsDesc") {
    const av = a.rs20;
    const bv = b.rs20;
    if (av == null && bv == null) return a.ticker.localeCompare(b.ticker);
    if (av == null) return 1;
    if (bv == null) return -1;
    if (av !== bv) return av > bv ? -1 : 1;
    return a.ticker.localeCompare(b.ticker);
  }

  if (sort === "slopeDesc") {
    const av = a.quote?.maSlopePct;
    const bv = b.quote?.maSlopePct;
    if (av == null && bv == null) return a.ticker.localeCompare(b.ticker);
    if (av == null) return 1;
    if (bv == null) return -1;
    if (av !== bv) return av > bv ? -1 : 1;
    return a.ticker.localeCompare(b.ticker);
  }

  if (sort === "trailPeAsc" || sort === "fwdPeAsc") {
    const key = sort === "trailPeAsc" ? "trailingPe" : "forwardPe";
    const av = peRank(a.pe[key]);
    const bv = peRank(b.pe[key]);
    if (av !== bv) return av < bv ? -1 : 1;
    return a.ticker.localeCompare(b.ticker);
  }

  if (!a.quote && !b.quote) return a.ticker.localeCompare(b.ticker);
  if (!a.quote) return 1;
  if (!b.quote) return -1;

  if (sort === "devAsc") {
    const d = a.quote.devPct - b.quote.devPct;
    if (d !== 0) return d;
    return a.ticker.localeCompare(b.ticker);
  }

  const direction = sort === "boxDesc" ? -1 : 1;
  const d = (boxShown(a.quote.boxPct) - boxShown(b.quote.boxPct)) * direction;
  if (d !== 0) return d;
  return a.ticker.localeCompare(b.ticker);
}

export type Zone = "bottom" | "mid" | "top";

export function zoneOf(boxPct: number): Zone {
  const shown = boxShown(boxPct);
  if (shown <= BOX_BOTTOM_MAX) return "bottom";
  if (shown >= BOX_TOP_MIN) return "top";
  return "mid";
}

export type ListItem =
  | { type: "divider"; id: string; label: string }
  | { type: "row"; row: TickerRow };

const ZONE_LABEL: Record<Zone, string> = {
  bottom: `箱の底 ≤${BOX_BOTTOM_MAX}%`,
  mid: "箱の中ほど",
  top: `箱の天井 ≥${BOX_TOP_MIN}%`,
};

export function withDividers(rows: TickerRow[], sort: SortId): ListItem[] {
  const items: ListItem[] = [];
  let prev: string | null = null;
  const zoned = sort === "boxAsc" || sort === "boxDesc";

  for (const row of rows) {
    if (!row.quote) {
      if (prev !== "failed") {
        items.push({ type: "divider", id: "failed", label: "日足を取れなかった" });
        prev = "failed";
      }
      items.push({ type: "row", row });
      continue;
    }
    if (zoned) {
      const zone = zoneOf(row.quote.boxPct);
      if (zone !== prev) {
        items.push({ type: "divider", id: zone, label: ZONE_LABEL[zone] });
        prev = zone;
      }
    }
    items.push({ type: "row", row });
  }
  return items;
}

export function sectorsOf(rows: TickerRow[]): { id: string; name: string; count: number }[] {
  const out: { id: string; name: string; count: number }[] = [];
  for (const row of rows) {
    const found = out.find((sector) => sector.id === row.sectorId);
    if (found) found.count += 1;
    else out.push({ id: row.sectorId, name: row.sector, count: 1 });
  }
  for (const item of TAG_SECTORS) {
    const count = rows.filter((row) => row.tags.includes(item.tag)).length;
    if (count === 0) continue;
    const first = out.findIndex((sector) =>
      rows.some((row) => row.sectorId === sector.id && row.tags.includes(item.tag)),
    );
    const entry = { id: item.id, name: item.tag, count };
    if (first === -1) out.push(entry);
    else out.splice(first, 0, entry);
  }
  return out;
}
