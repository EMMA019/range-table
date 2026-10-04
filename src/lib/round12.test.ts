import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CRYPTO,
  HOOD,
  NUCLEAR_LIST,
  QUANTUM,
  ROUND12_IDS,
  SOLAR,
  absentFills,
  dropReason,
  flowOf,
  listExcluded,
  listsAreDisjoint,
  nuclearCoversRound7b,
  stockLargeLoss,
  type SleeveFill,
} from "./round12";

describe("round-12 lists", () => {
  it("keeps the four lists disjoint and exempts SPCX", () => {
    assert.equal(listsAreDisjoint(), true);
    assert.equal(nuclearCoversRound7b(), true);
    assert.equal(SOLAR.includes("NOVA"), true);
    assert.equal(SOLAR.includes("FSLR"), true);
    assert.equal(CRYPTO.includes("IREN"), true);
    assert.equal(listExcluded(HOOD, "C"), false);
    assert.equal(NUCLEAR_LIST.includes("BWXT"), true);
    assert.equal(NUCLEAR_LIST.includes("NNE"), true);
    assert.equal(listExcluded("SPCX", "H"), false);
    assert.equal(listExcluded("ORA", "S"), false);
    assert.equal(listExcluded("HOOD", "C"), false);
    assert.equal(listExcluded("HOOD", "A"), false);
    assert.equal(listExcluded("HOOD", "H"), true);
    assert.equal(listExcluded("COIN", "C"), true);
    assert.equal(listExcluded("COIN", "S"), false);
    assert.equal(listExcluded("CEG", "N"), true);
    assert.equal(listExcluded("ENPH", "A"), true);
    assert.equal(listExcluded("ENPH", "B"), false);
    assert.deepEqual(QUANTUM, ["IONQ", "RGTI", "QBTS", "QUBT", "ARQQ"]);
    const named = new Set<string>([...SOLAR, ...CRYPTO, ...NUCLEAR_LIST, HOOD, "SPCX", "QMCO"]);
    for (const ticker of QUANTUM) {
      assert.equal(named.has(ticker), false);
      for (const id of ROUND12_IDS) assert.equal(listExcluded(ticker, id), false);
    }
    assert.equal(listExcluded("QMCO", "A"), false);
  });

  it("drops a listed name only inside the window when it is not voided", () => {
    assert.equal(dropReason({ ticker: "FSLR", inWindow: true, voided: false, id: "S" }), "list");
    assert.equal(dropReason({ ticker: "FSLR", inWindow: false, voided: false, id: "S" }), "keep");
    assert.equal(dropReason({ ticker: "FSLR", inWindow: true, voided: true, id: "A" }), "keep");
    assert.equal(dropReason({ ticker: "NVDA", inWindow: true, voided: false, id: "H" }), "keep");
  });
});

describe("removed and replacement fills", () => {
  const base: SleeveFill[] = [
    { ticker: "COIN", entryDate: "a", pnlUsd: 40, sleeve: "stock" },
    { ticker: "MSTR", entryDate: "a", pnlUsd: -70, sleeve: "stock" },
    { ticker: "ENPH", entryDate: "a", pnlUsd: -61, sleeve: "stock" },
    { ticker: "NVDA", entryDate: "a", pnlUsd: 10, sleeve: "stock" },
    { ticker: "SOXX", entryDate: "a", pnlUsd: 5, sleeve: "etf" },
  ];
  const next: SleeveFill[] = [
    { ticker: "NVDA", entryDate: "a", pnlUsd: 10, sleeve: "stock" },
    { ticker: "AMD", entryDate: "b", pnlUsd: 8, sleeve: "stock" },
    { ticker: "SOXX", entryDate: "b", pnlUsd: -3, sleeve: "etf" },
  ];

  it("splits removed baseline trades into wins and losses and keeps the focus tickers", () => {
    const gone = absentFills(base, next, "stock");
    assert.deepEqual(gone.map((fill) => fill.ticker), ["COIN", "MSTR", "ENPH"]);
    const flow = flowOf(gone);
    assert.equal(flow.side.wins, 1);
    assert.equal(flow.side.winsUsd, 40);
    assert.equal(flow.side.losses, 2);
    assert.equal(flow.side.lossesUsd, -131);
    const coin = flow.tickers.find((row) => row.ticker === "COIN");
    const hood = flow.tickers.find((row) => row.ticker === "HOOD");
    const mstr = flow.tickers.find((row) => row.ticker === "MSTR");
    assert.equal(coin?.wins, 1);
    assert.equal(coin?.winsUsd, 40);
    assert.equal(hood?.n, 0);
    assert.equal(mstr?.losses, 1);
    assert.equal(mstr?.lossesUsd, -70);
  });

  it("counts a fill the baseline did not take as a replacement", () => {
    const added = flowOf(absentFills(next, base, "stock"));
    assert.equal(added.side.n, 1);
    assert.equal(added.side.pnlUsd, 8);
    assert.equal(added.tickers.find((row) => row.ticker === "AMD")?.winsUsd, 8);
    assert.deepEqual(stockLargeLoss(base.filter((fill) => fill.sleeve === "stock")), { n: 2, usd: -131 });
    assert.equal(absentFills(base, next, "etf").length, 1);
  });
});
