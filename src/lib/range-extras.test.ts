import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cushionAfterLoss, policyLevels } from "./account-config";
import { parseMaterialNews, isOvernightNews, materialNewsAlerts } from "./material-news";
import { latestResearch, loadResearchPapers, parseResearchPapers } from "./research";
import { buildRiskLine } from "./risk-line";
import { upcomingSemiEvents } from "./semi-events";
import { ma20Close, parseStopRules, stopLevel } from "./stops";
import { buildThemeSlots, isLowSoxxCorr, loadThemeDemand, loadThemeSlotMap } from "./theme-slots";
import { loadMonitorIndex } from "./monitor-universe";
import type { Bar } from "./types";
import { paperHorizon, weekBench, weeklyPnl } from "./weekly-report";
import { aboveSma, breadthOk, buildWeather, marketTurnedBad, vixBelow } from "./weather";
import type { ClosedTrade } from "./trade-log";

function bars(closes: number[]): Bar[] {
  return closes.map((c, i) => ({
    date: `2026-01-${String(i + 1).padStart(2, "0")}`,
    o: c,
    h: c,
    l: c,
    c,
    v: 1,
  }));
}

describe("policy and stop loss", () => {
  it("uses the configured defense line and account center", () => {
    const policy = policyLevels({});
    assert.equal(policy.defenseLineJpy, 500_000);
    assert.equal(policy.accountCenterJpy, 519_000);
    assert.equal(policy.cushionJpy, 19_000);
    assert.equal(policyLevels({ defenseLineJpy: 400_000 }).defenseLineJpy, 400_000);
  });

  it("prices AVGO and VRT stops and reviews ON on the 20-day average", () => {
    const rules = parseStopRules({
      rules: [
        { ticker: "AVGO", kind: "price", price: 364 },
        { ticker: "VRT", kind: "price", price: 240 },
        { ticker: "ON", kind: "belowMa20" },
        { ticker: "ONDS", kind: "price", price: 1 },
      ],
    });
    assert.equal(stopLevel("AVGO", undefined, rules), 364);
    assert.equal(stopLevel("VRT", undefined, rules), 240);
    assert.equal(stopLevel("ONDS", bars([1, 1]), rules), null);
    const onBars = bars(Array.from({ length: 20 }, () => 50));
    assert.equal(ma20Close(onBars), 50);
    assert.equal(stopLevel("ON", onBars, rules), 50);
  });

  it("sums the loss if every stop hits and the cushion left after it", () => {
    const line = buildRiskLine({
      usdJpy: 150,
      positions: [
        { ticker: "AVGO", shares: 2, close: 400, stop: 364 },
        { ticker: "VRT", shares: 1, close: 250, stop: 240 },
        { ticker: "ON", shares: 4, close: 60, stop: 50 },
        { ticker: "ONDS", shares: 100, close: 5, stop: 1 },
      ],
    });
    assert.equal(line.lossUsd, 2 * 36 + 10 + 4 * 10);
    assert.equal(line.lossJpy, line.lossUsd! * 150);
    assert.equal(line.cushionJpy, 19_000);
    assert.equal(line.cushionAfterJpy, 19_000 - line.lossJpy!);
    assert.equal(cushionAfterLoss(19_000, 10, 150), 19_000 - 1500);
    assert.equal(cushionAfterLoss(19_000, 10, null), null);
  });

  it("does not invent a loss when shares are missing", () => {
    const line = buildRiskLine({ usdJpy: 150, positions: [] });
    assert.equal(line.lossUsd, null);
    assert.equal(line.cushionAfterJpy, null);
    assert.equal(line.cushionJpy, 19_000);
  });
});

describe("semiconductor weather", () => {
  it("marks a check × only when the series says so", () => {
    const spy = bars(Array.from({ length: 200 }, (_, i) => 100 + i));
    const flat = bars(Array.from({ length: 60 }, () => 100));
    const weak = bars(Array.from({ length: 60 }, (_, i) => 100 - i));
    assert.equal(aboveSma(spy, 200), true);
    assert.equal(aboveSma(spy.slice(0, 50), 200), null);
    assert.equal(breadthOk(flat, flat, 50), true);
    assert.equal(vixBelow(bars([19.9])), true);
    assert.equal(vixBelow(bars([20])), false);
    assert.equal(vixBelow(null), null);
    assert.equal(marketTurnedBad([true, null, null]), false);
    assert.equal(marketTurnedBad([true, false, null]), true);
    const view = buildWeather({
      soxx: { close: 90, ma20: 100, devPct: -10 },
      spy: weak,
      rsp: null,
      vix: null,
      events: [],
    });
    assert.equal(view.soxx?.above, false);
    assert.equal(view.cautious, false, "a short SPY history is not a failed 200-day check");
    assert.equal(view.events.length, 0);
  });

  it("keeps at most five bellwether events inside ten trading days", () => {
    const events = upcomingSemiEvents({
      today: "2026-10-01",
      earnings: [
        { ticker: "NVDA", date: "2026-10-05", status: "confirmed", session: "post" },
        { ticker: "ONDS", date: "2026-10-08", status: "confirmed", session: "pre" },
        { ticker: "AAPL", date: "2026-10-08", status: "estimated", session: null },
        { ticker: "AVGO", date: "2026-12-01", status: "estimated", session: null },
        { ticker: "AMD", date: "2026-10-02", status: "estimated", session: "pre" },
        { ticker: "MU", date: "2026-10-06", status: "confirmed", session: null },
        { ticker: "KLAC", date: "2026-10-07", status: "confirmed", session: null },
      ],
      extra: [{ date: "2026-10-06", title: "業界会議" }],
    });
    assert.equal(events.length, 5);
    assert.match(events[0].label, /AMD/);
    assert.match(events[0].label, /推定/);
    assert.match(events[0].label, /寄り前/);
    assert.ok(events.some((event) => event.label === "業界会議"));
    assert.ok(events.some((event) => event.label.includes("確・引け後")));
    assert.ok(!events.some((event) => event.label.includes("ONDS") || event.label.includes("AAPL")));
  });
});

describe("overnight news, research, and themes", () => {
  it("alerts holdings overnight and drops ONDS", () => {
    const publishedAt = "2026-10-02T08:00:00.000Z";
    const now = new Date("2026-10-02T12:00:00.000Z");
    assert.equal(isOvernightNews(publishedAt, now), true);
    assert.equal(isOvernightNews("2026-10-02T15:00:00.000Z", now), false);
    const items = parseMaterialNews({
      items: [
        { id: "1", ticker: "AVGO", headline: "ガイダンス", publishedAt, source: "wire" },
        { id: "2", ticker: "ONDS", headline: "無視", publishedAt, source: "wire" },
        { id: "3", ticker: "VRT", headline: "日中", publishedAt: "2026-10-02T15:00:00.000Z", source: "wire" },
      ],
    });
    const alerts = materialNewsAlerts(
      [
        { ticker: "AVGO", shares: 1, avgCost: null, reviewLine: null, note: null },
        { ticker: "ONDS", shares: 1, avgCost: null, reviewLine: null, note: null },
        { ticker: "IBM", shares: 1, avgCost: null, reviewLine: null, note: null },
      ],
      items,
      now,
    );
    assert.deepEqual(alerts.map((item) => item.id), ["news:AVGO:1"]);
    assert.equal(alerts[0].kind, "material_news");
  });

  it("shows the latest research mark per ticker and skips ONDS", () => {
    const papers = parseResearchPapers({
      papers: [
        { id: "a", title: "古い", date: "2026-09-01", tickers: ["NVDA", "ONDS"], mark: "様子見" },
        { id: "b", title: "新しい", date: "2026-10-01", tickers: ["NVDA"], mark: "効く" },
        { id: "c", title: "無視", date: "2026-10-02", tickers: ["MU"], mark: "今は無視" },
      ],
    });
    assert.equal(latestResearch("NVDA", papers)?.mark, "効く");
    assert.equal(latestResearch("NVDA", papers)?.title, "新しい");
    assert.equal(latestResearch("NVDA", papers)?.lag, null);
    assert.equal(latestResearch("ONDS", papers), null);
    assert.equal(latestResearch("AMD", papers), null);
    const kept = parseResearchPapers({
      papers: [
        {
          id: "lag",
          title: "時点",
          date: "2026-10-01",
          tickers: ["AMD", "INTC", "NVDA", "ONDS"],
          mark: "様子見",
          lag: "1〜2年",
          summary: "短い",
          companyTech: "企業技術の明示なし",
        },
      ],
    });
    assert.deepEqual(kept[0]?.tickers, ["AMD", "INTC"]);
    assert.equal(kept[0]?.lag, "1〜2年");
    assert.equal(kept[0]?.summary, "短い");
  });

  it("flags low SOXX correlation as a defensive-slot watch", () => {
    const rows = buildThemeSlots(
      { power: ["NEE"], cooling: ["VRT"], networking: ["CSCO"], edge: ["DELL"], "physical-ai": ["ON"] },
      new Map([
        ["NEE", 0.2],
        ["VRT", 0.8],
        ["CSCO", null],
      ]),
    );
    assert.equal(rows.find((row) => row.ticker === "NEE")?.lowCorr, true);
    assert.equal(rows.find((row) => row.ticker === "VRT")?.lowCorr, false);
    assert.equal(rows.find((row) => row.ticker === "CSCO")?.lowCorr, false);
    assert.equal(rows.find((row) => row.ticker === "ON")?.themeLabel, "Physical AI");
    assert.equal(isLowSoxxCorr(0.305), false);
    const demand = loadThemeDemand();
    assert.equal(demand.signals.length, 6);
    assert.equal(demand.asOf, "2026-10-07");
    assert.ok(demand.signals.every((signal) => signal.change === "unchanged" && signal.reason));
    const themes = loadThemeSlotMap();
    const universe = new Set(loadMonitorIndex().union);
    assert.ok(themes["physical-ai"].includes("ON"));
    assert.ok(themes["physical-ai"].every((ticker) => ticker !== "ONDS" && universe.has(ticker)));
    const notes = loadResearchPapers();
    assert.equal(notes.length, 11);
    assert.ok(notes.every((paper) => paper.summary && paper.companyTech && paper.lag && paper.url));
    assert.ok(notes.every((paper) => paper.tickers.length <= 2 && !paper.tickers.includes("ONDS")));
  });
});

describe("weekly report", () => {
  it("drops the biggest win and keeps fees inside the net P/L", () => {
    const trade = (symbol: string, pnl: number, fees: number, closeDate: string): ClosedTrade => ({
      id: symbol,
      symbol,
      openDate: "2026-10-01",
      closeDate,
      qty: 1,
      cost: 10,
      proceeds: 10 + pnl,
      pnl,
      fees,
      holdDays: 1,
      basis: "fifo",
    });
    const report = weeklyPnl(
      [trade("AAA", 40, 1, "2026-10-06"), trade("BBB", -10, 1, "2026-10-07"), trade("CCC", 5, 1, "2026-09-01")],
      ["2026-10-06", "2026-10-07"],
    );
    assert.equal(report.pnlAfterFees, 30);
    assert.equal(report.fees, 2);
    assert.equal(report.pnlExBiggestWin, -10);
    assert.equal(report.biggestWin?.symbol, "AAA");
  });

  it("compares the last five sessions and leaves paper +5/+10 empty until the marks exist", () => {
    const series = Array.from({ length: 8 }, (_, i) => ({ date: `2026-10-0${i + 1}`, c: 100 + i }));
    const bench = weekBench({ SPY: series, QQQ: series, SOXX: series }, 5);
    assert.equal(bench.sessions.length, 5);
    assert.equal(bench.returns.SPY, Math.round((series[7].c / series[2].c - 1) * 10000) / 10000);
    const early = paperHorizon("box-ticker", [
      { date: "2026-10-05", equity: 3200 },
      { date: "2026-10-06", equity: 3190 },
    ]);
    assert.equal(early.plus5, null);
    assert.equal(early.plus10, null);
    const later = paperHorizon(
      "box-ticker",
      Array.from({ length: 11 }, (_, i) => ({ date: `d${i}`, equity: 1000 + i * 10 })),
    );
    assert.equal(later.plus5, 0.05);
    assert.equal(later.plus10, 0.1);
  });
});
