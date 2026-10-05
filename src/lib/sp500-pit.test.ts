import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isSp500MemberOnDate, membersOnDate, parseSp500GicsCsv, parseTickerStartEndCsv, buildSameCikHandoffs, sameCikHandoffSuccessor } from "./sp500-pit";

describe("sp500-pit", () => {
  it("parses membership intervals", () => {
    const rows = parseTickerStartEndCsv(`ticker,start_date,end_date
AAPL,1996-01-02,
X,2010-01-01,2015-06-01`);
    assert.equal(rows.length, 2);
    assert.ok(isSp500MemberOnDate(rows.filter((r) => r.ticker === "X"), "2012-01-01"));
    assert.ok(!isSp500MemberOnDate(rows.filter((r) => r.ticker === "X"), "2016-01-01"));
  });

  it("parses GICS CSV CIK column with quoted fields", () => {
    const csv = `Symbol,Security,GICS Sector,GICS Sub-Industry,Headquarters Location,Date added,CIK,Founded
AAPL,Apple Inc.,Information Technology,"Technology Hardware, Storage & Peripherals",Cupertino,1982-11-30,320193,1976`;
    const m = parseSp500GicsCsv(csv);
    assert.equal(m.get("AAPL")?.cik, 320193);
  });

  it("lists members on a date", () => {
    const rows = parseTickerStartEndCsv(`ticker,start_date,end_date
AAPL,1996-01-02,
MSFT,1996-01-02,`);
    const m = membersOnDate(rows, "2020-01-02");
    assert.deepEqual(m, ["AAPL", "MSFT"]);
  });

  it("resolves FB→META handoff after rename", () => {
    const rows = parseTickerStartEndCsv(`ticker,start_date,end_date
FB,2013-12-23,2022-06-09
META,2022-06-09,`);
    const gics = parseSp500GicsCsv(`Symbol,Security,GICS Sector,GICS Sub-Industry,Headquarters Location,Date added,CIK,Founded
FB,Meta,Communication Services,Interactive Media,Menlo Park,2013-12-23,1326801,2004
META,Meta,Communication Services,Interactive Media,Menlo Park,2022-06-09,1326801,2004`);
    const cikOf = (t: string) => gics.get(t)?.cik ?? null;
    const handoffs = buildSameCikHandoffs(rows, cikOf);
    assert.ok(handoffs.some((h) => h.from === "FB" && h.to === "META"));
    assert.equal(sameCikHandoffSuccessor("FB", "2022-07-01", handoffs, rows), "META");
    assert.equal(sameCikHandoffSuccessor("FB", "2022-04-01", handoffs, rows), null);
  });
});
