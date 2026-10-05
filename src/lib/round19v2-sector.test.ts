import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildCorrInputs, correlationMatrix, isSemiSubIndustry, type SakaCandidateContext } from "./round19-saka";
import { pickCorrdiverseWithinPool } from "./round19v2-saka";

describe("round19v2 within-sector corrdiverse", () => {
  it("fills a semis slot when semiconductors are in the pool (cross-sector ρ ignored)", () => {
    const calendar: string[] = [];
    for (let i = 0; i < 300; i += 1) calendar.push(`2020-01-${String((i % 28) + 1).padStart(2, "0")}`);
    const date = calendar[calendar.length - 1];
    const closeHistory = new Map<string, Map<string, number>>();
    const makeSeries = (ticker: string, drift: number) => {
      const m = new Map<string, number>();
      let p = 100;
      for (const d of calendar) {
        p *= 1 + drift + (ticker.charCodeAt(0) % 7) * 0.0001;
        m.set(d, p);
      }
      closeHistory.set(ticker, m);
    };
    makeSeries("NVDA", 0.002);
    makeSeries("AMD", 0.0021);
    makeSeries("MO", 0.0001);
    makeSeries("PM", 0.00011);
    const ctx: SakaCandidateContext = {
      calendar,
      closeHistory,
      gicsOf: (t) => {
        if (t === "NVDA" || t === "AMD") {
          return { sector: "Information Technology", subIndustry: "Semiconductors", semiBucket: true };
        }
        return { sector: "Consumer Staples", subIndustry: "Tobacco", semiBucket: false };
      },
      mcap: (t) => (t === "NVDA" ? 1e12 : 1e11),
      sharesLookup: () => ({ shares: 1, stale: false }),
      profitable: () => true,
      hasPrice: () => true,
    };
    const semiPool = ["NVDA", "AMD"];
    const picked = pickCorrdiverseWithinPool(semiPool, 1, ctx, date);
    assert.ok(picked.length === 1);
    assert.ok(isSemiSubIndustry("Semiconductors"));
    assert.ok(semiPool.includes(picked[0]));

    const staples = pickCorrdiverseWithinPool(["MO", "PM"], 1, ctx, date);
    assert.equal(staples.length, 1);
    const inputs = buildCorrInputs(semiPool, calendar, closeHistory, date);
    assert.ok(inputs);
    const corr = correlationMatrix(inputs!);
    const rho = corr.get("NVDA")?.get("AMD");
    assert.ok(rho != null && rho > 0.5);
  });
});
