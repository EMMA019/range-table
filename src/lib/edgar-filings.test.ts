import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { EdgarHttpError } from "./edgar-client";
import { resetEdgarState, runFilingsCheck, type FilingsIo } from "./edgar-feed";
import {
  classify8k,
  filingTargets,
  form4SellSummary,
  form4XmlUrl,
  offeringAlert,
  parseForm4,
  parseSubmissions,
  type FilingTarget,
  type RecentFiling,
} from "./edgar-filings";
import type { Watchlist } from "./types";

/** Synthetic submissions JSON in data.sec.gov's column layout. Accessions and CIKs are made up. */
function submissions(rows: Array<Partial<Record<string, string>>>) {
  const cols = ["accessionNumber", "filingDate", "acceptanceDateTime", "form", "items", "primaryDocument"] as const;
  const recent: Record<string, string[]> = {};
  for (const col of cols) recent[col] = rows.map((row) => row[col] ?? "");
  return { cik: "9999911", name: "EXAMPLE CORP", filings: { recent, files: [] } };
}

const SUBS = submissions([
  { accessionNumber: "0009999911-26-000010", filingDate: "2026-10-01", acceptanceDateTime: "2026-10-01T20:15:00.000Z", form: "8-K", items: "1.01,9.01", primaryDocument: "ex.htm" },
  { accessionNumber: "0009999911-26-000009", filingDate: "2026-10-01", acceptanceDateTime: "2026-10-01T20:05:00.000Z", form: "8-K", items: "2.02,9.01", primaryDocument: "ex.htm" },
  { accessionNumber: "0009999912-26-000003", filingDate: "2026-09-30", acceptanceDateTime: "2026-09-30T22:00:00.000Z", form: "4", primaryDocument: "xslF345X06/form4.xml" },
  { accessionNumber: "0009999913-26-000004", filingDate: "2026-09-30", acceptanceDateTime: "2026-09-30T21:00:00.000Z", form: "4", primaryDocument: "xslF345X06/form4.xml" },
  { accessionNumber: "0009999911-26-000008", filingDate: "2026-09-30", acceptanceDateTime: "2026-09-30T12:00:00.000Z", form: "424B2", primaryDocument: "note.htm" },
  { accessionNumber: "0009999911-26-000007", filingDate: "2026-09-29", acceptanceDateTime: "2026-09-29T12:00:00.000Z", form: "424B5", primaryDocument: "pro.htm" },
  { accessionNumber: "0009999911-26-000006", filingDate: "2026-09-29", acceptanceDateTime: "2026-09-29T11:00:00.000Z", form: "10-Q", primaryDocument: "q.htm" },
  { accessionNumber: "0009999911-26-000001", filingDate: "2026-09-01", acceptanceDateTime: "2026-09-01T11:00:00.000Z", form: "8-K", items: "1.01", primaryDocument: "old.htm" },
]);

function form4Xml(opts: { code?: string; shares: number; price?: number; aff10b5One?: string; footnote?: string; title?: string; director?: boolean }) {
  return `<?xml version="1.0"?>
<ownershipDocument>
  <documentType>4</documentType>
  <reportingOwner>
    <reportingOwnerId><rptOwnerCik>0009999990</rptOwnerCik><rptOwnerName>Example Person A</rptOwnerName></reportingOwnerId>
    <reportingOwnerRelationship>
      <isDirector>${opts.director ? "1" : "0"}</isDirector>
      <isOfficer>${opts.title ? "1" : "0"}</isOfficer>
      ${opts.title ? `<officerTitle>${opts.title}</officerTitle>` : ""}
    </reportingOwnerRelationship>
  </reportingOwner>
  <aff10b5One>${opts.aff10b5One ?? "0"}</aff10b5One>
  <nonDerivativeTable>
    <nonDerivativeTransaction>
      <transactionDate><value>2026-09-29</value></transactionDate>
      <transactionCoding><transactionFormType>4</transactionFormType><transactionCode>${opts.code ?? "S"}</transactionCode></transactionCoding>
      <transactionAmounts>
        <transactionShares><value>${opts.shares}</value></transactionShares>
        <transactionPricePerShare>${opts.price != null ? `<value>${opts.price}</value>` : `<footnoteId id="F2"/>`}</transactionPricePerShare>
        <transactionAcquiredDisposedCode><value>${opts.code === "P" ? "A" : "D"}</value></transactionAcquiredDisposedCode>
      </transactionAmounts>
      <postTransactionAmounts><sharesOwnedFollowingTransaction><value>1000</value></sharesOwnedFollowingTransaction></postTransactionAmounts>
    </nonDerivativeTransaction>
  </nonDerivativeTable>
  <footnotes>${opts.footnote ? `<footnote id="F1">${opts.footnote}</footnote>` : ""}</footnotes>
</ownershipDocument>`;
}

const TARGET: FilingTarget = { cik: 9999911, ticker: "AAA", group: "semi" };
const NOW = new Date("2026-10-02T12:00:00Z");

describe("submissions", () => {
  it("keeps watched forms inside the window with UTC acceptance times and split items", () => {
    const rows = parseSubmissions(SUBS, "2026-09-28");
    assert.deepEqual(
      rows.map((row) => row.form),
      ["8-K", "8-K", "4", "4", "424B5"],
      "424B2, 10-Q and the old 8-K are dropped",
    );
    assert.deepEqual(rows[0].items, ["1.01", "9.01"]);
    assert.equal(rows[0].acceptedAt, "2026-10-01T20:15:00.000Z");
  });

  it("rejects a body without filings.recent", () => {
    assert.throws(() => parseSubmissions({}, "2026-09-28"));
  });

  it("dedupes share classes by CIK and skips ignored tickers", () => {
    const list: Watchlist = {
      groups: [
        {
          id: "g",
          name: "g",
          tickers: [
            { ticker: "AAA", description: "", notes: null, tags: [], watchOnly: false, earnings: null },
            { ticker: "AAB", description: "", notes: null, tags: [], watchOnly: false, earnings: null },
            { ticker: "ONDS", description: "", notes: null, tags: [], watchOnly: false, earnings: null },
          ],
        },
      ],
    } as unknown as Watchlist;
    assert.deepEqual(
      filingTargets(list, { AAA: 1, AAB: 1, ONDS: 2 }).map((target) => target.ticker),
      ["AAA"],
    );
  });
});

describe("8-K items", () => {
  it("routes action items high, others normal, and drops routine-only filings", () => {
    assert.equal(classify8k(["1.01", "9.01"])?.priority, "high");
    assert.equal(classify8k(["4.02"])?.priority, "high");
    assert.equal(classify8k(["5.02", "9.01"])?.priority, "normal");
    assert.equal(classify8k(["8.01"])?.priority, "normal");
    assert.equal(classify8k(["2.02", "9.01"]), null);
    assert.equal(classify8k(["7.01"]), null);
    assert.equal(classify8k(["9.01"]), null);
    assert.deepEqual(classify8k(["2.02", "5.02", "9.01"])?.items, ["5.02"]);
  });
});

describe("Form 4", () => {
  it("reads the raw XML path next to the rendered copy", () => {
    assert.equal(
      form4XmlUrl(9999911, "0009999912-26-000003", "xslF345X06/form4.xml"),
      "https://www.sec.gov/Archives/edgar/data/9999911/000999991226000003/form4.xml",
    );
  });

  it("alerts on a discretionary sale at or over $250K", () => {
    const sale = form4SellSummary(parseForm4(form4Xml({ shares: 2500, price: 100, title: "Chief Financial Officer" })));
    assert.ok(sale);
    assert.equal(sale.valueUsd, 250_000);
    assert.equal(sale.avgPrice, 100);
    assert.deepEqual(sale.owners, [{ name: "Example Person A", role: "Chief Financial Officer" }]);
  });

  it("ignores 10b5-1 plan sales by checkbox or footnote, buys, and small sales", () => {
    assert.equal(form4SellSummary(parseForm4(form4Xml({ shares: 10_000, price: 100, aff10b5One: "true" }))), null);
    assert.equal(form4SellSummary(parseForm4(form4Xml({ shares: 10_000, price: 100, aff10b5One: "1" }))), null);
    assert.equal(
      form4SellSummary(parseForm4(form4Xml({ shares: 10_000, price: 100, footnote: "Sold under a Rule 10b5-1 trading plan adopted earlier." }))),
      null,
    );
    assert.equal(form4SellSummary(parseForm4(form4Xml({ code: "P", shares: 10_000, price: 100 }))), null);
    assert.equal(form4SellSummary(parseForm4(form4Xml({ shares: 2499, price: 100 }))), null);
  });

  it("does not borrow a value from the next element when the price is only a footnote", () => {
    const doc = parseForm4(form4Xml({ shares: 10_000, director: true }));
    assert.equal(doc.sales[0].price, null);
    assert.equal(doc.owners[0].role, "取締役");
    assert.equal(form4SellSummary(doc), null, "no priced value, no alert");
  });
});

describe("424B offerings", () => {
  const filing: RecentFiling = {
    accession: "0009999911-26-000007",
    form: "424B5",
    filingDate: "2026-09-29",
    acceptedAt: "2026-09-29T12:00:00.000Z",
    items: [],
    primaryDocument: "pro.htm",
  };

  it("alerts on 424B5 but not 424B2 or the financials group", () => {
    assert.equal(offeringAlert(TARGET, filing)?.kind, "sec_offering");
    assert.equal(offeringAlert(TARGET, { ...filing, form: "424B2" }), null);
    assert.equal(offeringAlert({ ...TARGET, group: "financials" }, filing), null);
  });
});

describe("filings sweep", () => {
  beforeEach(() => resetEdgarState());

  function io(overrides: Partial<FilingsIo> = {}): FilingsIo & { calls: string[] } {
    const calls: string[] = [];
    return {
      calls,
      targets: [TARGET],
      submissions: async (cik) => {
        calls.push(`subs:${cik}`);
        return SUBS;
      },
      form4: async (url) => {
        calls.push(url);
        return url.includes("000999991226000003")
          ? form4Xml({ shares: 60_000, price: 100, title: "CEO" })
          : form4Xml({ shares: 10_000, price: 100, aff10b5One: "1" });
      },
      ...overrides,
    };
  }

  it("builds stable sec:{accession} alerts and caches per company and per Form 4", async () => {
    const fake = io();
    const first = await runFilingsCheck(NOW, fake);
    assert.equal(first.error, null);
    assert.deepEqual(first.items.map((item) => item.id).sort(), [
      "sec:0009999911-26-000007",
      "sec:0009999911-26-000010",
      "sec:0009999912-26-000003",
    ]);
    const sell = first.items.find((item) => item.kind === "sec_form4_sell");
    assert.equal(sell?.priority, "high", "$6M is over the high mark");
    assert.equal(sell?.eventAt, "2026-09-30T22:00:00.000Z");
    assert.equal(fake.calls.length, 3, "one submissions read and two Form 4 XMLs");

    const again = await runFilingsCheck(new Date(NOW.getTime() + 60_000), fake);
    assert.deepEqual(
      again.items.map((item) => item.id).sort(),
      first.items.map((item) => item.id).sort(),
    );
    assert.equal(fake.calls.length, 3, "cached for 30 minutes");
  });

  it("stops on an SEC throttle but keeps answering from cache", async () => {
    await runFilingsCheck(NOW, io());
    const later = new Date(NOW.getTime() + 31 * 60_000);
    const result = await runFilingsCheck(
      later,
      io({
        submissions: async () => {
          throw new EdgarHttpError(429, "EDGAR HTTP 429");
        },
      }),
    );
    assert.equal(result.items.length, 3);
    assert.match(result.error ?? "", /SECの制限/);
  });

  it("drops filings that age out of the window", async () => {
    await runFilingsCheck(NOW, io());
    const result = await runFilingsCheck(new Date("2026-10-04T13:00:00Z"), io());
    assert.deepEqual(
      result.items.map((item) => item.id).sort(),
      ["sec:0009999911-26-000010", "sec:0009999912-26-000003"],
    );
  });
});
