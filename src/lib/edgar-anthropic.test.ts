import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  anthropicAlerts,
  fullTextUrl,
  isAnthropicFiler,
  parseCurrentFeed,
  parseFullTextHits,
} from "./edgar-anthropic";
import { edgarItems, edgarStatus, refreshEdgar, resetEdgarState, setEdgarSweep } from "./edgar-feed";
import type { AlertItem } from "./alerts";

/** Synthetic feed in EDGAR's "Latest Filings" Atom shape. CIKs and accessions are made up. */
const FEED = `<?xml version="1.0" encoding="ISO-8859-1" ?>
<feed xmlns="http://www.w3.org/2005/Atom">
<title>Latest Filings</title>
<entry>
<title>S-1 - Anthropic, PBC (0009999901) (Filer)</title>
<link rel="alternate" type="text/html" href="https://www.sec.gov/Archives/edgar/data/9999901/000999990126000001/0009999901-26-000001-index.htm"/>
<summary type="html"> &lt;b&gt;Filed:&lt;/b&gt; 2026-10-02 </summary>
<updated>2026-10-02T17:26:59-04:00</updated>
<category scheme="https://www.sec.gov/" label="form type" term="S-1"/>
<id>urn:tag:sec.gov,2008:accession-number=0009999901-26-000001</id>
</entry>
<entry>
<title>S-1 - Anthropic PBC 1, a Series of Example Venture Funds, LP (0009999902) (Filer)</title>
<link rel="alternate" type="text/html" href="https://www.sec.gov/x"/>
<updated>2026-10-02T16:00:00-04:00</updated>
<id>urn:tag:sec.gov,2008:accession-number=0009999902-26-000001</id>
</entry>
<entry>
<title>S-1/A - Example Rockets Corp (0009999903) (Filer)</title>
<link rel="alternate" type="text/html" href="https://www.sec.gov/y"/>
<updated>2026-10-01T09:00:00-04:00</updated>
<id>urn:tag:sec.gov,2008:accession-number=0009999903-26-000004</id>
</entry>
</feed>`;

/** Synthetic efts response: another issuer's S-1/A that mentions Anthropic, an SPV, and the real filer. */
const HITS = {
  hits: {
    hits: [
      { _source: { form: "S-1/A", adsh: "0009999903-26-000004", file_date: "2026-10-01", display_names: ["Example Rockets Corp  (RKTX)  (CIK 0009999903)"] } },
      { _source: { form: "S-1", adsh: "0009999902-26-000001", file_date: "2026-10-02", display_names: ["Anthropic PBC 1, a Series of Example Venture Funds, LP  (CIK 0009999902)"] } },
      { _source: { form: "S-1/A", adsh: "0009999901-26-000002", file_date: "2026-09-25", display_names: ["Anthropic, PBC  (CIK 0009999901)"] } },
      { _source: { form: "S-1", adsh: "0009999901-26-000001", file_date: "2026-10-02", display_names: ["Anthropic, PBC  (CIK 0009999901)"] } },
      { _source: { form: "D", adsh: "0009999901-25-000009", file_date: "2025-03-01", display_names: ["Anthropic, PBC  (CIK 0009999901)"] } },
    ],
  },
};

const NOW = new Date("2026-10-02T22:00:00Z");

describe("Anthropic S-1 detection", () => {
  it("matches only the exact filer name", () => {
    assert.equal(isAnthropicFiler("Anthropic, PBC"), true);
    assert.equal(isAnthropicFiler("ANTHROPIC PBC"), true);
    assert.equal(isAnthropicFiler("Anthropic PBC 1, a Series of Example Venture Funds, LP"), false);
    assert.equal(isAnthropicFiler("Anthropic Fund LP"), false);
    assert.equal(isAnthropicFiler("Example Rockets Corp"), false);
  });

  it("parses the latest-filings feed", () => {
    const feed = parseCurrentFeed(FEED);
    assert.equal(feed.length, 3);
    assert.deepEqual(feed[0], {
      form: "S-1",
      company: "Anthropic, PBC",
      cik: "0009999901",
      accession: "0009999901-26-000001",
      updated: "2026-10-02T17:26:59-04:00",
      url: "https://www.sec.gov/Archives/edgar/data/9999901/000999990126000001/0009999901-26-000001-index.htm",
    });
  });

  it("parses full-text hits and strips ticker and CIK from names", () => {
    const hits = parseFullTextHits(HITS);
    assert.equal(hits.length, 5);
    assert.deepEqual(hits[0].filers, [{ name: "Example Rockets Corp", cik: "0009999903" }]);
    assert.deepEqual(hits[2].filers, [{ name: "Anthropic, PBC", cik: "0009999901" }]);
    assert.deepEqual(parseFullTextHits(null), []);
  });

  it("raises one critical item per Anthropic registration filing", () => {
    const items = anthropicAlerts(parseCurrentFeed(FEED), parseFullTextHits(HITS), NOW);
    assert.deepEqual(
      items.map((item) => item.id).sort(),
      ["sec:0009999901-26-000001:anthropic", "sec:0009999901-26-000002:anthropic"],
    );
    const s1 = items.find((item) => item.id === "sec:0009999901-26-000001:anthropic") as AlertItem;
    assert.equal(s1.priority, "critical");
    assert.equal(s1.kind, "anthropic_s1");
    assert.equal(s1.eventAt, "2026-10-02T21:26:59.000Z");
    assert.equal(s1.eventAtJst, "2026-10-03 06:26 JST");
    assert.match(s1.title, /S-1/);
    const amended = items.find((item) => item.id === "sec:0009999901-26-000002:anthropic") as AlertItem;
    assert.equal(amended.eventAt, "2026-09-25T04:00:00.000Z");
  });

  it("drops filings older than the 30-day window and ignores Form D", () => {
    const later = new Date("2026-11-20T00:00:00Z");
    assert.equal(anthropicAlerts([], parseFullTextHits(HITS), later).length, 0);
  });

  it("labels the 424B4 pricing prospectus", () => {
    const pricing = anthropicAlerts(
      [],
      [{ form: "424B4", accession: "0009999901-26-000009", fileDate: "2026-10-02", filers: [{ name: "Anthropic, PBC", cik: "0009999901" }] }],
      NOW,
    );
    assert.match(pricing[0].title, /424B4/);
  });

  it("asks full-text search only for registration forms in a date range", () => {
    const url = fullTextUrl("2026-09-02", "2026-10-02");
    assert.match(url, /forms=S-1%2CS-1%2FA/);
    assert.match(url, /startdt=2026-09-02&enddt=2026-10-02/);
  });
});

describe("EDGAR sweep state", () => {
  beforeEach(() => resetEdgarState());

  it("keeps the last items of a part that fails and reports its error", async () => {
    let fail = false;
    const item = { id: "x" } as AlertItem;
    setEdgarSweep({
      parts: [
        {
          id: "p",
          run: async () => {
            if (fail) throw new Error("EDGAR HTTP 503");
            return [item];
          },
        },
      ],
    });
    await refreshEdgar(1_000, new Date(0));
    assert.deepEqual(edgarItems(), [item]);
    assert.equal(edgarStatus().ok, true);
    assert.equal(edgarStatus().complete, true);

    fail = true;
    await refreshEdgar(1_000, new Date(0));
    assert.deepEqual(edgarItems(), [item], "not due yet, nothing reran");
    await refreshEdgar(1_000, new Date(16 * 60 * 1000));
    assert.deepEqual(edgarItems(), [item]);
    assert.equal(edgarStatus().ok, false);
    assert.match(edgarStatus().error ?? "", /503/);
  });

  it("answers before a slow sweep finishes and marks the feed incomplete", async () => {
    let release: () => void = () => undefined;
    setEdgarSweep({ parts: [{ id: "slow", run: () => new Promise((resolve) => (release = () => resolve([]))) }] });
    await refreshEdgar(10, new Date(0));
    assert.equal(edgarStatus().complete, false);
    release();
    await refreshEdgar(1_000, new Date(0));
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(edgarStatus().complete, true);
  });
});

describe("SEC User-Agent", () => {
  it("needs a contact email", async () => {
    const { secUserAgent } = await import("./edgar-client");
    assert.equal(secUserAgent({}), null);
    assert.equal(secUserAgent({ SEC_USER_AGENT: "range-table" }), null);
    assert.equal(secUserAgent({ SEC_USER_AGENT: " range-table someone@example.org " }), "range-table someone@example.org");
  });

  it("reports EDGAR as disabled without it", () => {
    setEdgarSweep({ parts: [] }, () => false);
    const status = edgarStatus();
    assert.equal(status.enabled, false);
    assert.equal(status.complete, true);
    assert.match(status.error ?? "", /SEC_USER_AGENT/);
  });
});
