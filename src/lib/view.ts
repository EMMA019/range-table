import { BOX_BOTTOM_MAX, BOX_TOP_MIN } from "./constants";
import type { SortId } from "./copy";
import { boxShown } from "./format";
import type { TickerRow } from "./types";

export type ViewFilters = {
  sector: string;
  bottom: boolean;
  top: boolean;
  breakout: boolean;
  earnings: boolean;
  hideWatch: boolean;
  sort: SortId;
  q: string;
};

export function applyView(rows: TickerRow[], filters: ViewFilters): TickerRow[] {
  const query = filters.q.trim().toLowerCase();
  const filtered = rows.filter((row) => {
    if (filters.sector !== "all" && row.sectorId !== filters.sector) return false;
    if (filters.hideWatch && row.watchOnly) return false;
    if (filters.bottom) {
      if (!row.quote || boxShown(row.quote.boxPct) > BOX_BOTTOM_MAX) return false;
    }
    if (filters.top) {
      if (!row.quote || boxShown(row.quote.boxPct) < BOX_TOP_MIN) return false;
    }
    if (filters.breakout && !row.quote?.brokeHigh) return false;
    if (filters.earnings && !row.earnings?.warn) return false;
    if (query) {
      const hay = `${row.ticker} ${row.description} ${row.notes} ${row.sector} ${row.tags.join(" ")}`.toLowerCase();
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

function compareRows(a: TickerRow, b: TickerRow, sort: SortId): number {
  if (sort === "earnAsc") {
    const d = earnRank(a) - earnRank(b);
    if (d !== 0) return d;
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
  return out;
}
