import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { alertSlot, countAlerts, dedupeAlerts, filterSince, orderEntryAlertsByRs, sortAlerts, type AlertItem } from "./alerts";
import { bandStreakStart, entryAlerts, finalBars, holdingEarningsAlerts, type EntryCandidate } from "./alerts-entry";
import type { Bar } from "./types";

function day(i: number): string {
  const d = new Date(Date.UTC(2026, 7, 3));
  let n = 0;
  while (n < i) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (d.getUTCDay() % 6 !== 0) n += 1;
  }
  return d.toISOString().slice(0, 10);
}

/** Choppy range, drop to the 20-day low, rebound into the 25% morning band. */
function bandBars(extra: Array<[number, number, number, number]> = []): Bar[] {
  const bars: Bar[] = [];
  for (let i = 0; i < 24; i++) {
    const c = i % 2 ? 118 : 104;
    bars.push({ date: day(i), o: c, h: c + 3, l: c - 3, c, v: 1e6 });
  }
  bars.push({ date: day(24), o: 104, h: 104, l: 92, c: 93, v: 1e6 });
  bars.push({ date: day(25), o: 93, h: 97, l: 92.5, c: 96, v: 1e6 });
  bars.push({ date: day(26), o: 96, h: 100, l: 95, c: 99, v: 1e6 });
  extra.forEach(([o, h, l, c], k) => bars.push({ date: day(27 + k), o, h, l, c, v: 1e6 }));
  return bars;
}

const AFTER_CLOSE = new Date("2026-09-09T12:00:00Z");
const TODAY = "2026-09-09";

function candidate(partial: Partial<EntryCandidate> = {}): EntryCandidate {
  return {
    ticker: "AAA",
    watchOnly: false,
    earnings: { date: "2026-10-30", status: "confirmed" },
    bars: bandBars(),
    stale: false,
    sectorId: "semi",
    earningsUnknown: false,
    profitability: { status: "profit", source: "test", ttmNetIncome: null, trailingEps: 1 },
    ...partial,
  };
}

describe("entry alerts", () => {
  it("fires on the 25% line with ATR ≥ 3% and a far earnings date", () => {
    const [item, ...rest] = entryAlerts([candidate()], TODAY, AFTER_CLOSE);
    assert.equal(rest.length, 0);
    assert.equal(item.id, "entry:AAA:25:2026-09-08");
    assert.equal(item.kind, "entry_in_ok");
    assert.equal(item.priority, "high");
    assert.deepEqual(item.flags, []);
    assert.equal(item.eventAt, "2026-09-08T20:00:00.000Z");
    assert.equal(item.eventAtJst, "2026-09-09 05:00 JST");
    assert.equal(item.facts.reboundDays, 2);
    assert.match(item.title, /^AAA 1回目（25%線/);
    assert.match(item.title, /反発あり/);
    assert.match(item.title, /ATR \$[\d.,]+ \(\d+\.\d%\)/);
    assert.match(item.body, /決算まであと\d+営業日/);
    assert.match(item.body, /対SPY/);
    assert.match(item.body, /25%線/);
    assert.equal(item.facts.rs20, null);
    assert.equal(item.facts.buyLine, "25");
  });

  it("keeps the same id while the band setup continues", () => {
    const longer = bandBars([[99, 100, 98, 99.5]]);
    assert.equal(bandStreakStart(longer), "2026-09-08");
    const [item] = entryAlerts([candidate({ bars: longer })], "2026-09-10", new Date("2026-09-10T12:00:00Z"));
    assert.equal(item.id, "entry:AAA:25:2026-09-08");
    assert.equal(item.facts.barDate, "2026-09-09");
  });

  it("puts names with no earnings date at low priority with a flag", () => {
    const [item] = entryAlerts([candidate({ earnings: null, earningsUnknown: true })], TODAY, AFTER_CLOSE);
    assert.equal(item.priority, "low");
    assert.deepEqual(item.flags, ["no_earnings_date"]);
    assert.match(item.title, /要確認.*決算日不明/);
    assert.match(item.body, /要確認.*決算日不明/);
    assert.equal(item.facts.rs20, null);
    assert.equal(item.facts.earningsDate, null);
  });

  it("skips earnings within five trading days but not past earnings", () => {
    assert.equal(entryAlerts([candidate({ earnings: { date: "2026-09-16", status: "estimated" } })], TODAY, AFTER_CLOSE).length, 0);
    assert.equal(entryAlerts([candidate({ earnings: { date: "2026-09-09", status: "confirmed" } })], TODAY, AFTER_CLOSE).length, 0);
    assert.equal(entryAlerts([candidate({ earnings: { date: "2026-09-17", status: "estimated" } })], TODAY, AFTER_CLOSE).length, 0);
    assert.equal(entryAlerts([candidate({ earnings: { date: "2026-09-25", status: "estimated" } })], TODAY, AFTER_CLOSE).length, 1);
    assert.equal(entryAlerts([candidate({ earnings: { date: "2026-08-01", status: "confirmed" } })], TODAY, AFTER_CLOSE).length, 1);
  });

  it("needs ATR at least 3% of the close", () => {
    const calm = bandBars().map((bar) => ({ ...bar, o: bar.o + 1000, h: bar.h + 1000, l: bar.l + 1000, c: bar.c + 1000 }));
    assert.equal(entryAlerts([candidate({ bars: calm })], TODAY, AFTER_CLOSE).length, 0);
  });

  it("skips outside the band, watch-only, ONDS, exclusions, and missing bars", () => {
    const early = bandBars().slice(0, -1);
    assert.equal(entryAlerts([candidate({ bars: early })], TODAY, AFTER_CLOSE).length, 0);
    assert.equal(entryAlerts([candidate({ watchOnly: true })], TODAY, AFTER_CLOSE).length, 0);
    assert.equal(
      entryAlerts([candidate({ watchOnly: true, sectorId: "index", earningsUnknown: true, earnings: null })], TODAY, AFTER_CLOSE).length,
      1,
    );
    const spinBars = bandBars();
    for (let i = 1; i < spinBars.length; i++) spinBars[i].c = 85;
    const last = spinBars[spinBars.length - 1];
    last.c = 12;
    last.l = 11;
    assert.equal(entryAlerts([candidate({ bars: spinBars, ticker: "SPIN" })], TODAY, AFTER_CLOSE).length, 0);
    assert.equal(entryAlerts([candidate({ ticker: "ONDS" })], TODAY, AFTER_CLOSE).length, 0);
    assert.equal(entryAlerts([candidate({ bars: undefined })], TODAY, AFTER_CLOSE).length, 0);
    assert.equal(
      entryAlerts([candidate({ profitability: { status: "loss", source: "test", ttmNetIncome: -1, trailingEps: -1 } })], TODAY, AFTER_CLOSE).length,
      0,
    );
  });

  it("flags stale data and prices at or above $550", () => {
    const pricey = bandBars().map((bar) => ({ ...bar, o: bar.o * 6, h: bar.h * 6, l: bar.l * 6, c: bar.c * 6 }));
    const [item] = entryAlerts([candidate({ bars: pricey, stale: true })], TODAY, AFTER_CLOSE);
    assert.ok(item.flags.includes("price_over_450"));
    assert.ok(item.flags.includes("stale_data"));
  });

  it("ignores today's bar until the close is final", () => {
    const bars = bandBars();
    const during = new Date("2026-09-08T20:10:00Z");
    assert.equal(finalBars(bars, during).at(-1)?.date, "2026-09-07");
    assert.equal(entryAlerts([candidate()], "2026-09-08", during).length, 0);
    const after = new Date("2026-09-08T20:21:00Z");
    assert.equal(entryAlerts([candidate()], "2026-09-08", after).length, 1);
  });

  it("orders entry items by 20-day excess return versus SPY and marks a full semi book", () => {
    const spy = bandBars().map((bar) => ({ ...bar, o: 100, h: 101, l: 99, c: 100 }));
    const lift = (factor: number): Bar[] => {
      const bars = bandBars();
      const cut = bars.length - 20;
      return bars.map((bar, i) => (i < cut ? bar : { ...bar, o: bar.o * factor, h: bar.h * factor, l: bar.l * factor, c: bar.c * factor }));
    };
    const other = bandBars().map((bar, i) => ({ ...bar, date: `2024-03-${String(i + 1).padStart(2, "0")}` }));
    const items = entryAlerts(
      [
        candidate({ ticker: "LOW", bars: lift(1.02) }),
        candidate({ ticker: "HIGH", bars: lift(1.2), semi: true }),
        candidate({ ticker: "NONE", bars: other }),
      ],
      TODAY,
      AFTER_CLOSE,
      { spyBars: spy, semiFull: true },
    );
    assert.deepEqual(
      items.map((item) => item.ticker),
      ["HIGH", "LOW", "NONE"],
    );
    assert.equal(typeof items[0]?.facts.rs20, "number");
    assert.equal(typeof items[1]?.facts.rs20, "number");
    assert.ok((items[0]?.facts.rs20 as number) > (items[1]?.facts.rs20 as number));
    assert.equal(items[2]?.facts.rs20, null);
    assert.deepEqual(items[0]?.flags, ["semi_cap"]);
    assert.match(items[0]?.title ?? "", /半導体2枠埋まり/);
    assert.deepEqual(items[1]?.flags, []);
  });
});

describe("alert feed helpers", () => {
  const item = (id: string, priority: AlertItem["priority"], eventAt: string): AlertItem => ({
    id,
    kind: "entry_in_ok",
    priority,
    ticker: null,
    title: id,
    body: "",
    eventAt,
    eventAtJst: "",
    url: null,
    flags: [],
    facts: {},
  });

  it("sorts by priority, then newest, and dedupes by id", () => {
    const items = [
      item("a", "low", "2026-09-09T00:00:00Z"),
      item("b", "high", "2026-09-08T00:00:00Z"),
      item("c", "high", "2026-09-09T00:00:00Z"),
      item("c", "high", "2026-09-09T00:00:00Z"),
      item("d", "critical", "2026-09-01T00:00:00Z"),
    ];
    assert.deepEqual(
      sortAlerts(dedupeAlerts(items)).map((x) => x.id),
      ["d", "c", "b", "a"],
    );
    assert.deepEqual(countAlerts(dedupeAlerts(items)), { total: 4, entry_in_ok: 4 });
    assert.deepEqual(
      filterSince(items, "2026-09-09T00:00:00Z").map((x) => x.id),
      ["a", "c", "c"],
    );
    assert.equal(filterSince(items, "garbage").length, 5);
  });

  it("names the slot from the Eastern clock", () => {
    assert.equal(alertSlot(new Date("2026-10-02T21:00:00Z")), "post_close");
    assert.equal(alertSlot(new Date("2026-10-02T06:00:00Z")), "post_close");
    assert.equal(alertSlot(new Date("2026-10-02T12:00:00Z")), "pre_open");
    assert.equal(alertSlot(new Date("2026-10-02T15:00:00Z")), "session");
    assert.equal(alertSlot(new Date("2026-10-03T15:00:00Z")), "post_close");
  });

  it("orders entry items by relative strength without moving other kinds", () => {
    const entry = (id: string, rs: number | null): AlertItem => ({
      ...item(id, "high", "2026-09-09T00:00:00Z"),
      ticker: id,
      facts: { rs20: rs },
    });
    const other = (id: string): AlertItem => ({ ...item(id, "critical", "2026-09-09T00:00:00Z"), kind: "sec_8k" });
    assert.deepEqual(
      orderEntryAlertsByRs([other("sec"), entry("LOW", 0.01), entry("HIGH", 0.2), entry("NONE", null), other("late")]).map(
        (row) => row.id,
      ),
      ["sec", "HIGH", "LOW", "NONE", "late"],
    );
  });
});

describe("holding earnings alerts", () => {
  const book = (ticker: string) => ({ ticker });
  const dates = new Map<string, { date: string; status: "confirmed" | "estimated" } | null>([
    ["AAA", { date: "2026-09-14", status: "confirmed" }],
    ["BBB", { date: "2026-09-15", status: "estimated" }],
    ["CCC", { date: "2026-08-01", status: "confirmed" }],
    ["DDD", null],
    ["ONDS", { date: "2026-09-10", status: "confirmed" }],
  ]);

  it("emits a sell judgment within three trading days and skips the rest", () => {
    const items = holdingEarningsAlerts([book("BBB"), book("AAA"), book("AAA"), book("CCC"), book("DDD"), book("ONDS")], dates, TODAY);
    assert.deepEqual(
      items.map((item) => item.ticker),
      ["AAA"],
    );
    assert.equal(items[0]?.kind, "earnings_hold");
    assert.equal(items[0]?.id, "earn-hold:AAA:2026-09-14");
    assert.match(items[0]?.title ?? "", /決算まであと3営業日/);
    assert.match(items[0]?.title ?? "", /決算前に売るか判断/);
    assert.equal(items[0]?.facts.earningsTradingDays, 3);
    assert.equal("shares" in (items[0]?.facts ?? {}), false);
  });
});
