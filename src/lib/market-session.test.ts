import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergeOutcome, type CacheBody } from "./price-cache";
import { indexMonitorTickers } from "./monitor-universe";
import { buildPayload, modeDate } from "./market";
import type { Bar, IndexRow, TickerRow, Watchlist } from "./types";

function barsEnding(end: string, close = 100): Bar[] {
  const [year, month, day] = end.split("-").map(Number);
  const utc = Date.UTC(year, month - 1, day);
  return Array.from({ length: 25 }, (_, i) => {
    const date = new Date(utc - (24 - i) * 86_400_000).toISOString().slice(0, 10);
    return { date, o: close, h: close + 1, l: close - 1, c: close, v: 1_000_000 };
  });
}

function indexRow(ticker: string, closeDate: string | null, stale: boolean): IndexRow {
  return {
    ticker,
    stale,
    error: null,
    quote: closeDate ? ({ closeDate } as NonNullable<IndexRow["quote"]>) : null,
  };
}

function row(closeDate: string | null): TickerRow {
  return { quote: closeDate ? { closeDate } : null } as TickerRow;
}

const list: Watchlist = {
  groups: [
    {
      id: "t",
      name: "Test",
      tickers: [
        {
          ticker: "AAA",
          description: "",
          notes: "",
          tags: [],
          watchOnly: false,
          earnings: null,
          sectorLabel: null,
        },
      ],
    },
  ],
};

function cache(series: CacheBody["series"]): CacheBody {
  return { v: 4, version: 1, series };
}

function fresh(symbolBars: Bar[], at: number) {
  return mergeOutcome(undefined, { bars: symbolBars, droppedPartial: false }, at);
}

describe("modeDate", () => {
  it("uses SPY's close only while that series is current", () => {
    const indices = [
      indexRow("SPY", "2026-11-10", false),
      indexRow("QQQ", "2026-11-09", false),
      indexRow("SOXX", "2026-11-09", false),
    ];
    assert.equal(modeDate(indices, [row("2026-11-09"), row("2026-11-09")]), "2026-11-10");
  });

  it("falls back to the most common close among indices and rows when SPY is stale", () => {
    const indices = [
      indexRow("SPY", "2026-11-06", true),
      indexRow("QQQ", "2026-11-09", false),
      indexRow("SOXX", "2026-11-09", false),
      indexRow("SMH", "2026-11-09", false),
    ];
    assert.equal(modeDate(indices, [row("2026-11-08")]), "2026-11-09");
  });

  it("still counts a stale SPY close as one sample in the fallback", () => {
    const indices = [
      indexRow("SPY", "2026-11-06", true),
      indexRow("QQQ", "2026-11-06", true),
      indexRow("SOXX", "2026-11-06", true),
      indexRow("SMH", "2026-11-09", false),
    ];
    assert.equal(modeDate(indices, [row("2026-11-09")]), "2026-11-06");
  });

  it("returns null when nothing has a close date", () => {
    assert.equal(modeDate([indexRow("SPY", null, false)], [row(null)]), null);
  });
});

describe("market payload session fields", () => {
  it("marks benchmark rows stale and dates the payload from the fresh majority", () => {
    const monitor = indexMonitorTickers(list);
    assert.ok(monitor.length >= 2);
    const [older, newer] = monitor;
    const spy = mergeOutcome(fresh(barsEnding("2026-11-06", 500), 1_000), { error: "HTTP 500" }, 9_000);
    const payload = buildPayload(
      cache({
        SPY: spy,
        QQQ: fresh(barsEnding("2026-11-09", 400), 5_000),
        SOXX: fresh(barsEnding("2026-11-09", 200), 4_000),
        SMH: fresh(barsEnding("2026-11-09", 300), 3_000),
        AAA: fresh(barsEnding("2026-11-08", 40), 6_000),
        [older]: { at: 2_000, okAt: 2_000 },
        [newer]: { at: 9_000, okAt: 9_000 },
      }),
      list,
      {},
    );

    const byTicker = Object.fromEntries(payload.indices.map((index) => [index.ticker, index]));
    assert.equal(byTicker.SPY.stale, true);
    assert.equal(byTicker.SPY.quote?.closeDate, "2026-11-06");
    assert.equal(byTicker.QQQ.stale, false);
    assert.equal(byTicker.QQQ.quote?.closeDate, "2026-11-09");
    assert.equal(payload.barDate, "2026-11-09");
    assert.ok(payload.monitor);
    assert.equal(payload.monitor.fetchedAt, 2_000);
    assert.notEqual(payload.monitor.fetchedAt, spy.okAt);
  });

  it("leaves monitor.fetchedAt null until an index-monitor symbol has succeeded", () => {
    const payload = buildPayload(
      cache({
        SPY: fresh(barsEnding("2026-11-09", 500), 5_000),
        QQQ: fresh(barsEnding("2026-11-09", 400), 5_000),
        SOXX: fresh(barsEnding("2026-11-09", 200), 5_000),
        SMH: fresh(barsEnding("2026-11-09", 300), 5_000),
      }),
      list,
      {},
    );
    assert.equal(payload.barDate, "2026-11-09");
    assert.equal(payload.indices.every((index) => index.stale === false), true);
    assert.ok(payload.monitor);
    assert.equal(payload.monitor.fetchedAt, null);
  });
});
