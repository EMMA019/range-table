import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AlertItem } from "./alerts";
import type { MorningQuote } from "./morning";
import { collectEntrySignals, mergeSignals, morningEntrySignal, signalFromEntryAlert, SOURCE_ALERT, SOURCE_MORNING } from "./paper-signals";

function alert(ticker: string, facts: AlertItem["facts"], kind: AlertItem["kind"] = "entry_in_ok"): AlertItem {
  return {
    id: `entry:${ticker}`,
    kind,
    priority: "high",
    ticker,
    title: "t",
    body: "b",
    eventAt: "2026-10-02T20:00:00.000Z",
    eventAtJst: "2026-10-03 05:00 JST",
    url: null,
    flags: [],
    facts,
  };
}

function quote(boxPct: number, close = 10, low20 = 8): MorningQuote {
  return {
    close,
    low20,
    high20: 20,
    line25: 11,
    line35: 12,
    boxPct,
    brokeHigh: false,
    reboundDays: 1,
  };
}

describe("entry notification log", () => {
  it("keeps the first ref close and drops ONDS", () => {
    const merged = mergeSignals(
      [{ signal_date: "2026-09-28", symbol: "ON", ref_close: 75.65, low20: 65.8, source: SOURCE_MORNING }],
      [
        { signal_date: "2026-09-28", symbol: "on", ref_close: 99, low20: 1, source: SOURCE_ALERT },
        { signal_date: "2026-10-02", symbol: "ONDS", ref_close: 5, low20: 1, source: SOURCE_ALERT },
        { signal_date: "2026-10-02", symbol: "BA", ref_close: 193.56, low20: 184.01, source: SOURCE_ALERT },
      ],
    );
    assert.deepEqual(
      merged.map((row) => `${row.signal_date}:${row.symbol}:${row.ref_close}:${row.source}`),
      ["2026-09-28:ON:75.65:" + SOURCE_MORNING, "2026-10-02:BA:193.56:" + SOURCE_ALERT],
    );
  });

  it("reads an entry alert and a morning row, and lets the alert win on the same day", () => {
    const fromAlert = signalFromEntryAlert(alert("akam", { barDate: "2026-10-02", close: 108.92, low20: 100.77 }));
    assert.equal(fromAlert?.symbol, "AKAM");
    assert.equal(fromAlert?.source, SOURCE_ALERT);
    assert.equal(signalFromEntryAlert(alert("ONDS", { barDate: "2026-10-02", close: 1, low20: 1 })), null);
    assert.equal(signalFromEntryAlert(alert("BA", { barDate: "2026-10-02", close: 1, low20: 1 }, "review_break")), null);

    const morning = morningEntrySignal({
      ticker: "GLW",
      onMorningList: true,
      screenPass: true,
      closeDate: "2026-09-28",
      quote: quote(25, 151.59, 139.25),
    });
    assert.equal(morning?.source, SOURCE_MORNING);
    assert.equal(morning?.ref_close, 151.59);
    assert.equal(
      morningEntrySignal({ ticker: "GLW", onMorningList: true, screenPass: false, closeDate: "2026-09-28", quote: quote(25) }),
      null,
    );
    assert.equal(
      morningEntrySignal({ ticker: "GLW", onMorningList: false, screenPass: true, closeDate: "2026-09-28", quote: quote(25) }),
      null,
    );
    assert.equal(
      morningEntrySignal({ ticker: "ONDS", onMorningList: true, screenPass: true, closeDate: "2026-09-28", quote: quote(25) }),
      null,
    );
    assert.equal(
      morningEntrySignal({ ticker: "GLW", onMorningList: true, screenPass: true, closeDate: "2026-09-28", quote: quote(50) }),
      null,
    );
    assert.ok(morningEntrySignal({ ticker: "GLW", onMorningList: true, screenPass: true, closeDate: "2026-09-28", quote: quote(30) }));

    const both = collectEntrySignals(
      [alert("VRT", { barDate: "2026-10-02", close: 252.18, low20: 226.94 }), alert("VRT", { barDate: "2026-10-02", close: 252.18, low20: 226.94 })],
      [{ ticker: "VRT", onMorningList: true, screenPass: true, closeDate: "2026-10-02", quote: quote(26, 252.18, 226.94) }],
    );
    assert.equal(both.length, 1);
    assert.equal(both[0]?.source, SOURCE_ALERT);
    assert.equal(both[0]?.ref_close, 252.18);
  });

  it("drops crypto and other excluded themes, and keeps names that are not on the list", () => {
    assert.equal(signalFromEntryAlert(alert("HOOD", { barDate: "2026-10-07", close: 109.51, low20: 101.71 })), null);
    assert.equal(signalFromEntryAlert(alert("COIN", { barDate: "2026-10-07", close: 200, low20: 180 })), null);
    assert.equal(
      morningEntrySignal({ ticker: "HOOD", onMorningList: true, screenPass: true, closeDate: "2026-10-07", quote: quote(25, 109.51, 101.71) }),
      null,
    );
    assert.equal(signalFromEntryAlert(alert("GDDY", { barDate: "2026-10-07", close: 97.21, low20: 91.84 }))?.symbol, "GDDY");
    const merged = mergeSignals(
      [
        { signal_date: "2026-10-07", symbol: "HOOD", ref_close: 109.51, low20: 101.71, source: SOURCE_ALERT },
        { signal_date: "2026-10-07", symbol: "GDDY", ref_close: 97.21, low20: 91.84, source: SOURCE_ALERT },
      ],
      [{ signal_date: "2026-10-07", symbol: "STX", ref_close: 807.57, low20: 758.35, source: SOURCE_MORNING }],
    );
    assert.deepEqual(merged.map((row) => row.symbol), ["GDDY", "STX"]);
  });
});
