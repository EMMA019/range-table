import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isSp500MemberOnDate, membersOnDate, parseTickerStartEndCsv } from "./sp500-pit";

describe("sp500-pit", () => {
  it("parses membership intervals", () => {
    const rows = parseTickerStartEndCsv(`ticker,start_date,end_date
AAPL,1996-01-02,
X,2010-01-01,2015-06-01`);
    assert.equal(rows.length, 2);
    assert.ok(isSp500MemberOnDate(rows.filter((r) => r.ticker === "X"), "2012-01-01"));
    assert.ok(!isSp500MemberOnDate(rows.filter((r) => r.ticker === "X"), "2016-01-01"));
  });

  it("lists members on a date", () => {
    const rows = parseTickerStartEndCsv(`ticker,start_date,end_date
AAPL,1996-01-02,
MSFT,1996-01-02,`);
    const m = membersOnDate(rows, "2020-01-02");
    assert.deepEqual(m, ["AAPL", "MSFT"]);
  });
});
