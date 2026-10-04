import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calendarYearReturn, pickHoldings, SAKA_CONFIGS, type SakaCandidateContext, type SakaEquityPoint } from "./round19-saka";

describe("round19-saka", () => {
  it("calendar year uses prior year last close", () => {
    const calendar = ["2016-12-30", "2017-12-29", "2018-12-31"];
    const curve: SakaEquityPoint[] = [
      { date: "2016-12-30", equity: 100 },
      { date: "2017-12-29", equity: 121.7 },
      { date: "2018-12-31", equity: 116.2 },
    ];
    const r2017 = calendarYearReturn(curve, calendar, 2017, "2018-12-31");
    assert.ok(r2017 != null && Math.abs(r2017 - 0.217) < 0.01);
  });

  it("equal pick takes mcap order", () => {
    const cfg = SAKA_CONFIGS.find((c) => c.pick === "plain" && c.n === 15 && c.weight === "equal")!;
    assert.ok(cfg);
    const ctx: SakaCandidateContext = {
      calendar: ["2020-01-02"],
      closeHistory: new Map(),
      gicsOf: () => ({ sector: "Tech", subIndustry: "Software", semiBucket: false }),
      mcap: (t) => (t === "AAA" ? 100 : 50),
      sharesLookup: () => ({ shares: 1, stale: false }),
      profitable: () => true,
      hasPrice: () => true,
    };
    const picked = pickHoldings(cfg, ["BBB", "AAA"], "2020-01-02", ctx);
    assert.equal(picked[0], "AAA");
    assert.ok(picked.length <= cfg!.n);
  });
});
