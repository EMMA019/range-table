import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergeCompanyFactsJson } from "./pit-facts-index";

describe("mergeCompanyFactsJson", () => {
  it("appends supplement USD points without duplicating keys", () => {
    const primary = {
      facts: {
        "us-gaap": {
          NetIncomeLoss: {
            units: {
              USD: [{ end: "2015-12-31", filed: "2016-02-11", form: "10-K", fp: "FY", val: 1 }],
            },
          },
        },
      },
    };
    const supplement = {
      facts: {
        "us-gaap": {
          NetIncomeLoss: {
            units: {
              USD: [{ end: "2014-12-31", filed: "2015-02-09", form: "10-K", fp: "FY", val: 2 }],
            },
          },
        },
      },
    };
    const merged = mergeCompanyFactsJson(primary, supplement) as typeof primary;
    const pts = merged.facts["us-gaap"].NetIncomeLoss.units.USD;
    assert.equal(pts.length, 2);
    assert.ok(pts.some((p) => p.end === "2014-12-31"));
  });
});
