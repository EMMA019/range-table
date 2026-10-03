import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  aboveMovingAverage,
  advLeaders,
  biasGap,
  breadthSide,
  changesFrom,
  classifyEndNote,
  classifyExcess,
  classifySign,
  cleanTicker,
  dataEndedMidTrade,
  dollarAsOf,
  earningsDatesFrom,
  endEventsFrom,
  expandRowspan,
  filingEndClass,
  foreignEarningsDates,
  isSemiSubIndustry,
  listedFrom,
  lossExit,
  membershipAsOf,
  noteEndClass,
  parseWikiDate,
  ratioSma,
  resolveEndClass,
  sectorEtf,
  sessionsAhead,
  staysProfitable,
  topTickersByDollar,
  trailingAvgDollar,
  wikiTables,
  withinSessionsBefore,
  type RawCell,
} from "./bias";

const ROWSPAN_HTML = `
<table class="wikitable" id="changes">
<tr><th rowspan="2">Date</th><th colspan="2">Added</th><th colspan="2">Removed</th><th rowspan="2">Reason</th></tr>
<tr><th>Ticker</th><th>Security</th><th>Ticker</th><th>Security</th></tr>
<tr><td rowspan="2">June 22, 2020</td><td>JWN</td><td>Nordstrom</td><td>BIO</td><td>Bio-Rad</td><td rowspan="2">Market cap</td></tr>
<tr><td>HOG</td><td>Harley</td><td>TYL</td><td>Tyler</td></tr>
<tr><td>June 32, 2020</td><td>AAA</td><td>Aaa</td><td>BBB</td><td>Bbb</td><td>no</td></tr>
</table>
<table class="wikitable" id="constituents">
<tr><th>Symbol</th><th>Security</th><th>GICS Sector</th><th>GICS Sub-Industry</th></tr>
<tr><td>NVDA</td><td>NVIDIA</td><td>Information Technology</td><td>Semiconductors</td></tr>
<tr><td>AMAT</td><td>Applied</td><td>Information Technology</td><td>Semiconductor Materials &amp; Equipment</td></tr>
<tr><td>JPM</td><td>JPMorgan</td><td>Financials</td><td>Diversified Banks</td></tr>
<tr><td>—</td><td>skip</td><td>Financials</td><td>Banks</td></tr>
</table>`;

describe("wikipedia membership", () => {
  it("parses dates and rejects text that is not a date", () => {
    assert.equal(parseWikiDate("September 21, 2026"), "2026-09-21");
    assert.equal(parseWikiDate("June 22, 2020"), "2020-06-22");
    assert.equal(parseWikiDate("2024-10-03"), "2024-10-03");
    assert.equal(parseWikiDate("August 9, 2019 [ 186 ]"), "2019-08-09");
    assert.equal(parseWikiDate("February 31, 2020"), null);
    assert.equal(parseWikiDate("Q2 2024"), null);
  });

  it("carries a rowspan date onto the following change row", () => {
    const tables = wikiTables(ROWSPAN_HTML);
    const changes = tables.find((table) => table.id === "changes");
    assert.ok(changes);
    const expanded = expandRowspan(changes.rows);
    const parsed = changesFrom(expanded);
    assert.deepEqual(parsed.skippedDates, ["June 32, 2020"]);
    assert.deepEqual(
      parsed.changes.map((change) => [change.date, change.added, change.removed, change.reason]),
      [
        ["2020-06-22", "JWN", "BIO", "Market cap"],
        ["2020-06-22", "HOG", "TYL", "Market cap"],
      ],
    );
  });

  it("reads GICS and ignores a non-ticker symbol cell", () => {
    const listed = listedFrom(expandRowspan(wikiTables(ROWSPAN_HTML)[1].rows));
    assert.deepEqual(
      listed.map((row) => row.ticker),
      ["NVDA", "AMAT", "JPM"],
    );
    assert.equal(listed[1].sub, "Semiconductor Materials & Equipment");
  });

  it("undoes only changes after the as-of date", () => {
    const current = ["NEW", "STAY"];
    const changes = [
      { date: "2024-11-01", added: "NEW", removed: "OLD", reason: "" },
      { date: "2024-10-03", added: "STAY", removed: "GONE", reason: "" },
      { date: "2023-01-01", added: "EARLY", removed: null, reason: "" },
    ];
    assert.deepEqual(membershipAsOf(current, changes, "2024-10-03"), ["OLD", "STAY"]);
    assert.deepEqual(membershipAsOf(current, changes, "2026-10-03"), ["NEW", "STAY"]);
  });

  it("accepts dotted tickers and drops footnotes", () => {
    assert.equal(cleanTicker("brk.b"), "BRK.B");
    assert.equal(cleanTicker("BE[2]"), "BE");
    assert.equal(cleanTicker("—"), null);
    assert.equal(cleanTicker(""), null);
  });
});

describe("sector and regime labels", () => {
  it("maps semis to SOXX and leaves unknown GICS unmapped", () => {
    assert.equal(isSemiSubIndustry("Semiconductor Materials & Equipment"), true);
    assert.equal(isSemiSubIndustry("Application Software"), false);
    assert.equal(isSemiSubIndustry(null), false);
    assert.equal(sectorEtf("Information Technology", true), "SOXX");
    assert.equal(sectorEtf("Financials", false), "XLF");
    assert.equal(sectorEtf(null, false), null);
    assert.equal(sectorEtf("Not a sector", false), null);
  });

  it("does not put ties or missing history into either regime bucket", () => {
    assert.equal(classifyExcess(0.1, 0.0), "out");
    assert.equal(classifyExcess(0.0, 0.1), "under");
    assert.equal(classifyExcess(0.2, 0.2), "unclassified");
    assert.equal(classifyExcess(null, 0.1), "unclassified");
    assert.equal(classifySign(-0.01), "negative");
    assert.equal(classifySign(0.01), "positive");
    assert.equal(classifySign(0), "unclassified");
    assert.equal(breadthSide(1.1, 1.0), "above");
    assert.equal(breadthSide(1.0, 1.1), "below");
    assert.equal(breadthSide(1, 1), "unclassified");
    assert.equal(breadthSide(1, null), "unclassified");
    assert.equal(aboveMovingAverage(10, 9), true);
    assert.equal(aboveMovingAverage(9, 9), false);
    assert.equal(aboveMovingAverage(9, null), null);
  });

  it("subtracts only when both sides exist", () => {
    assert.deepEqual(biasGap(100, 40, 25), { survivorship: 60, semisTailwind: 15 });
    assert.deepEqual(biasGap(null, 40, 25), { survivorship: null, semisTailwind: 15 });
    assert.deepEqual(biasGap(100, null, 25), { survivorship: null, semisTailwind: null });
    assert.deepEqual(biasGap(100, 40, null), { survivorship: 60, semisTailwind: null });
  });
});

describe("bellwether window and liquidity ranks", () => {
  const sessions = ["2024-10-01", "2024-10-02", "2024-10-03", "2024-10-04", "2024-10-07"];

  it("flags one to three sessions before a report and not the report day", () => {
    assert.equal(sessionsAhead(sessions, "2024-10-01", "2024-10-04"), 3);
    assert.equal(sessionsAhead(sessions, "2024-10-04", "2024-10-04"), 0);
    assert.equal(sessionsAhead(sessions, "2024-10-03", "2024-10-05"), 2);
    assert.equal(sessionsAhead(sessions, "2024-10-04", "2024-10-05"), 1);
    assert.equal(withinSessionsBefore(sessions, "2024-10-01", ["2024-10-04"]), true);
    assert.equal(withinSessionsBefore(sessions, "2024-10-04", ["2024-10-04"]), false);
    assert.equal(withinSessionsBefore(sessions, "2024-10-01", ["2024-10-08"]), false);
  });

  it("ranks dollar volume with ticker as the tie break and builds a 63-day average", () => {
    assert.deepEqual(
      topTickersByDollar(
        [
          { ticker: "BBB", dollar: 5 },
          { ticker: "AAA", dollar: 5 },
          { ticker: "CCC", dollar: null },
          { ticker: "DDD", dollar: 1 },
        ],
        2,
      ),
      ["AAA", "BBB"],
    );
    const bars = Array.from({ length: 4 }, (_, i) => ({ date: `2024-01-0${i + 1}`, c: 2, v: 10 * (i + 1) }));
    const series = trailingAvgDollar(bars, 3);
    assert.equal(series.has("2024-01-01"), false);
    assert.equal(series.get("2024-01-03"), (20 + 40 + 60) / 3);
    assert.equal(dollarAsOf(series, "2024-01-02"), null);
    assert.equal(dollarAsOf(series, "2024-01-09"), series.get("2024-01-04"));
    const leaders = advLeaders(new Map([["AAA", series], ["BBB", new Map([["2024-01-03", 1]])]]), ["2024-01-03"], 1);
    assert.deepEqual([...leaders.get("2024-01-03")!], ["AAA"]);
  });

  it("leaves the breadth average empty until the window is full", () => {
    const left = [
      { date: "2024-01-02", c: 2 },
      { date: "2024-01-03", c: 2 },
    ];
    const right = [
      { date: "2024-01-02", c: 4 },
      { date: "2024-01-03", c: 6 },
    ];
    const one = ratioSma(left, right, 2);
    assert.equal(one.get("2024-01-02")?.sma, null);
    assert.equal(one.get("2024-01-03")?.ratio, 3);
    assert.equal(one.get("2024-01-03")?.sma, 2.5);
  });

  it("keeps a generic 6-K out of the earnings calendar", () => {
    const block = {
      form: ["8-K", "6-K", "6-K"],
      filingDate: ["2024-01-02", "2024-02-02", "2024-03-02"],
      items: ["2.02", "", ""],
      primaryDocDescription: ["Results", "Report of foreign private issuer", "Third quarter earnings"],
    };
    assert.deepEqual(foreignEarningsDates(block.form, block.filingDate, block.primaryDocDescription), ["2024-03-02"]);
    assert.deepEqual(earningsDatesFrom([block]), { item202: ["2024-01-02"], foreign6k: ["2024-03-02"] });
  });
});

describe("why a price series ended", () => {
  it("reads acquisitions and bankruptcies and leaves index moves unclassified", () => {
    assert.equal(classifyEndNote("Chevron acquired Hess."), "acquisition");
    assert.equal(classifyEndNote("Merger of Bemis and Amcor; Bemis was the surviving entity."), "acquisition");
    assert.equal(classifyEndNote("Pacific Gas & Electric Company filed for bankruptcy."), "bankruptcy");
    assert.equal(classifyEndNote("Market capitalization changes."), null);
    assert.equal(classifyEndNote("MXIM was delisted from NASDAQ exchange."), null);
    assert.equal(classifyEndNote("AmSurg is acquiring Envision Healthcare."), null);
  });

  it("uses a note or an 8-K only when it is near the last bar", () => {
    const notes = [
      { date: "2020-01-02", reason: "Chevron acquired Hess." },
      { date: "2024-05-28", reason: "Chevron acquired Hess." },
    ];
    assert.equal(noteEndClass(notes, "2024-05-31"), "acquisition");
    assert.equal(noteEndClass([{ date: "2020-01-02", reason: "Chevron acquired Hess." }], "2024-05-31"), null);
    const events = endEventsFrom([
      {
        form: ["8-K", "8-K", "10-K"],
        filingDate: ["2024-05-20", "2022-01-04", "2024-05-20"],
        items: ["2.01", "1.03", ""],
        primaryDocDescription: ["8-K", "8-K", "10-K"],
      },
    ]);
    assert.equal(filingEndClass(events, "2024-05-31"), "acquisition");
    assert.equal(filingEndClass(events, "2022-01-10"), "bankruptcy");
    assert.equal(resolveEndClass("acquisition", "bankruptcy"), "bankruptcy");
    assert.equal(resolveEndClass(null, null), "unknown");
  });

  it("penalizes a hold that ran out of bars and not a finished target", () => {
    assert.equal(dataEndedMidTrade("2024-03-01", "window", "2024-03-01", "2024-10-02"), true);
    assert.equal(dataEndedMidTrade("2024-03-01", "target", "2024-03-01", "2024-10-02"), false);
    assert.equal(dataEndedMidTrade("2026-10-01", "window", "2026-10-01", "2026-10-01"), false);
    assert.equal(lossExit(80, 0.5), 40);
    assert.equal(lossExit(80, 1), 0);
    assert.equal(staysProfitable(1.01, 4), true);
    assert.equal(staysProfitable(1, 4), false);
    assert.equal(staysProfitable(null, 4), null);
  });
});

describe("rowspan helper", () => {
  it("fills a carried cell without inventing text", () => {
    const rows: RawCell[][] = [
      [
        { text: "June 22, 2020", rowspan: 2, colspan: 1 },
        { text: "JWN", rowspan: 1, colspan: 1 },
      ],
      [{ text: "HOG", rowspan: 1, colspan: 1 }],
    ];
    assert.deepEqual(expandRowspan(rows), [
      ["June 22, 2020", "JWN"],
      ["June 22, 2020", "HOG"],
    ]);
  });
});
