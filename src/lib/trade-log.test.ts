import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { column, parseCsv, parseNumber, readSections } from "./ibkr-csv";
import { guessZone, parseIbkrStatement, splitDateTime, type Fill } from "./ibkr-parse";
import { buildTradeLog, isFill, mergeFills } from "./trade-log";

const fixture = (name: string) => fs.readFileSync(path.join(process.cwd(), "src/lib/fixtures", name), "utf8");

describe("IBKR CSV reader", () => {
  it("handles BOM, CRLF, quoted commas and doubled quotes", () => {
    const rows = parseCsv('\uFEFFa,"b, c","say ""hi"""\r\n1,"1,234.5",x\r\n');
    assert.deepEqual(rows, [
      ["a", "b, c", 'say "hi"'],
      ["1", "1,234.5", "x"],
    ]);
  });

  it("parses numbers with separators, parentheses and blanks", () => {
    assert.equal(parseNumber("1,234.50"), 1234.5);
    assert.equal(parseNumber("(3.5)"), -3.5);
    assert.equal(parseNumber("-12"), -12);
    assert.equal(parseNumber(""), null);
    assert.equal(parseNumber("--"), null);
  });

  it("splits tables at each Header row, keeping only Data rows", () => {
    const sections = readSections(parseCsv(fixture("ibkr-activity-ja.synthetic.csv")));
    const trades = sections.filter((section) => section.name === "取引");
    assert.equal(trades.length, 2, "stock trades and the FX table are separate");
    assert.equal(trades[0].rows.length, 12, "SubTotal and Total rows dropped");
    assert.ok(column(trades[0].header, ["Realized P/L", "実現損益"]) >= 0);
    assert.equal(column(trades[1].header, ["Comm/Fee", "手数料・費用", "手数料"]), -1, "手数料 / JPY is not the stock fee column");
  });

  it("reads IBKR date-times and tells ET from Tokyo clock times", () => {
    assert.deepEqual(splitDateTime("2026-09-08, 10:15:02"), { date: "2026-09-08", minutes: 615, seconds: 2 });
    assert.deepEqual(splitDateTime("20260908;101502"), { date: "2026-09-08", minutes: 615, seconds: 2 });
    assert.equal(splitDateTime("2026-09-08")?.minutes, null);
    assert.equal(guessZone([600, 700, 900]), "ET");
    assert.equal(guessZone([23 * 60, 60, 4 * 60]), "JST");
  });
});

describe("activity statement (Japanese)", () => {
  const report = parseIbkrStatement(fixture("ibkr-activity-ja.synthetic.csv"));

  it("takes stock orders only and never reads the account section", () => {
    assert.equal(report.format, "activity");
    assert.equal(report.fills.length, 9);
    assert.ok(report.skipped.some((row) => row.reason.includes("ONDS") && row.count === 2));
    assert.ok(report.fills.every((fill) => !JSON.stringify(fill).includes("U0000000")));
    assert.ok(!report.fills.some((fill) => fill.symbol === "USD.JPY"), "FX table skipped");
    const eee = report.fills.find((fill) => fill.symbol === "EEE");
    assert.equal(eee?.qty, 1000);
    assert.equal(eee?.commission, -5);
  });

  it("stores ET session dates and UTC instants", () => {
    const first = report.fills.find((fill) => fill.symbol === "AAA");
    assert.equal(first?.tradeDate, "2026-09-08");
    assert.equal(first?.tradeAt, "2026-09-08T14:15:02.000Z");
  });

  it("computes fee-inclusive FIFO over three buys and two sells", () => {
    const log = buildTradeLog(report.fills);
    const aaa = log.trades.filter((trade) => trade.symbol === "AAA").sort((a, b) => a.closeDate.localeCompare(b.closeDate));
    assert.deepEqual(
      aaa.map((trade) => [trade.closeDate, trade.qty, trade.cost, trade.proceeds, trade.pnl, trade.openDate]),
      [
        ["2026-09-11", 12, 605.4, 659, 53.6, "2026-09-08"],
        ["2026-09-14", 8, 397.6, 447, 49.4, "2026-09-09"],
      ],
    );
    assert.deepEqual(log.kpi.reconcile, [], "matches IBKR's realized P/L");
  });

  it("uses IBKR's figure when the buy is before the period, and ignores ONDS", () => {
    const log = buildTradeLog(report.fills);
    const ccc = log.trades.find((trade) => trade.symbol === "CCC");
    assert.equal(ccc?.basis, "ibkr");
    assert.equal(ccc?.pnl, 7.5);
    assert.ok(log.warnings.some((line) => line.startsWith("CCC")));
    assert.ok(!log.trades.some((trade) => trade.symbol === "ONDS"));
    assert.deepEqual(log.open.map((lot) => [lot.symbol, lot.qty, lot.cost]), [["EEE", 1000, 1205]]);
  });

  it("reports win rate, totals and $10 days by ET session date", () => {
    const { kpi } = buildTradeLog(report.fills);
    assert.equal(kpi.trades, 4);
    assert.equal(kpi.wins, 3);
    assert.equal(kpi.winRate, 0.75);
    assert.equal(kpi.totalPnl, 102.5);
    assert.equal(kpi.avgPnl, 25.63);
    assert.equal(kpi.totalFees, 13);
    assert.deepEqual(kpi.days10, { hit: 2, tradingDays: 3 });
    assert.deepEqual(kpi.byDay.at(-1), { date: "2026-09-15", pnl: -0.5, trades: 2 });
  });
});

describe("activity statement (English, Tokyo clock)", () => {
  const report = parseIbkrStatement(fixture("ibkr-activity-en.synthetic.csv"));

  it("converts Tokyo times to the US session date and skips options and FX", () => {
    assert.deepEqual(
      report.fills.map((fill) => [fill.symbol, fill.side, fill.tradeDate]),
      [
        ["FFF", "BUY", "2026-09-08"],
        ["FFF", "SELL", "2026-09-09"],
        ["BRK.B", "BUY", "2026-09-10"],
      ],
    );
    assert.ok(report.warnings.some((line) => line.includes("日本時間")));
    assert.equal(report.skipped.reduce((sum, row) => sum + row.count, 0), 2);
    const log = buildTradeLog(report.fills);
    assert.equal(log.trades[0].pnl, 7.3);
  });
});

describe("Transaction History export", () => {
  const report = parseIbkrStatement(fixture("ibkr-history.synthetic.csv"));

  it("keeps buys and sells only and orders same-day buys first", () => {
    assert.equal(report.format, "history");
    assert.deepEqual(
      report.fills.map((fill) => [fill.symbol, fill.side, fill.qty]),
      [
        ["GGG", "SELL", 10],
        ["GGG", "BUY", 10],
        ["HHH", "BUY", 1200],
      ],
    );
    const log = buildTradeLog(report.fills);
    assert.deepEqual(
      log.trades.map((trade) => [trade.symbol, trade.pnl, trade.basis]),
      [["GGG", 13, "fifo"]],
    );
    assert.deepEqual(log.kpi.days10, { hit: 1, tradingDays: 1 });
  });

  it("gives up an unknown statement with a message", () => {
    const empty = parseIbkrStatement("a,b\n1,2\n");
    assert.equal(empty.format, null);
    assert.equal(empty.fills.length, 0);
    assert.equal(empty.warnings.length, 1);
  });
});

describe("merging imports", () => {
  const activity = parseIbkrStatement(fixture("ibkr-activity-ja.synthetic.csv")).fills;

  it("does not duplicate on re-import", () => {
    const first = mergeFills([], activity);
    const again = mergeFills(first.fills, activity);
    assert.equal(first.added, 9);
    assert.equal(again.added, 0);
    assert.equal(again.duplicates, 9);
    assert.equal(again.fills.length, 9);
  });

  it("keeps two identical fills on one day as two", () => {
    const fill: Fill = { ...activity[0], tradeAt: null };
    const report = parseIbkrStatement(
      [
        "Trades,Header,DataDiscriminator,Asset Category,Currency,Symbol,Date/Time,Quantity,T. Price,C. Price,Proceeds,Comm/Fee,Basis,Realized P/L,MTM P/L,Code",
        `Trades,Data,Order,Stocks,USD,${fill.symbol},"2026-09-08, 10:00:00",1,10,10,-10,-1,11,0,0,O`,
        `Trades,Data,Order,Stocks,USD,${fill.symbol},"2026-09-08, 11:00:00",1,10,10,-10,-1,11,0,0,O`,
      ].join("\n"),
    );
    assert.equal(new Set(report.fills.map((row) => row.id)).size, 2);
  });

  it("skips a symbol-day already loaded from the other format", () => {
    const base = mergeFills([], activity).fills;
    const overlap: Fill = { ...activity[0], id: "other", source: "history", tradeAt: null };
    const result = mergeFills(base, [overlap]);
    assert.equal(result.added, 0);
    assert.equal(result.overlapSkipped, 1);
  });

  it("validates backup rows", () => {
    assert.ok(activity.every(isFill));
    assert.equal(isFill({ ...activity[0], qty: -1 }), false);
    assert.equal(isFill({ id: "x" }), false);
  });
});
