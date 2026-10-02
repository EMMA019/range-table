import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

/**
 * The repo is public. These checks fail the build when a statement export, an IBKR
 * account number, or a share count would be committed. Synthetic fixtures are allowed
 * only under src/lib/fixtures/ with ".synthetic." in the file name.
 */

const ROOT = process.cwd();
const ACCOUNT_RE = /\bU\d{7,8}\b/g;
const PLACEHOLDER_RE = /^U0+$/;
const STATEMENT_EXT_RE = /\.(csv|tsv|xls|xlsx|pdf|ofx|qfx)$/i;
const STATEMENT_NAME_RE = /(statement|activity|transaction[_ -]?history|取引|明細|報告書)/i;
const CODE_EXT_RE = /\.(ts|tsx|mjs|js|md|css|yml)$/i;
const SKIP_CONTENT = new Set(["package-lock.json"]);
const POSITION_KEY_RE = /["']?(shares|avgCost|avg_cost|reviewLine)["']?\s*:/;

function repoFiles(): string[] {
  try {
    const out = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
    return out.split("\0").filter(Boolean);
  } catch {
    return walk(ROOT);
  }
}

function walk(dir: string, base = ""): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if ([".git", "node_modules", ".next"].includes(entry.name) || entry.name.startsWith(".cache")) continue;
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(path.join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out;
}

function isSyntheticFixture(file: string): boolean {
  return file.startsWith("src/lib/fixtures/") && path.basename(file).includes(".synthetic.");
}

export function accountNumbersIn(text: string): string[] {
  return [...text.matchAll(ACCOUNT_RE)].map((match) => match[0]).filter((hit) => !PLACEHOLDER_RE.test(hit));
}

describe("privacy guard", () => {
  const files = repoFiles().filter((file) => fs.existsSync(path.join(ROOT, file)));

  it("finds the repository files", () => {
    assert.ok(files.includes("package.json"));
  });

  it("has no statement or spreadsheet exports outside synthetic fixtures", () => {
    const bad = files.filter((file) => {
      if (isSyntheticFixture(file)) return false;
      if (STATEMENT_EXT_RE.test(file)) return true;
      return STATEMENT_NAME_RE.test(path.basename(file)) && !CODE_EXT_RE.test(file);
    });
    assert.deepEqual(bad, []);
  });

  it("has no IBKR account numbers", () => {
    const hits: string[] = [];
    for (const file of files) {
      if (SKIP_CONTENT.has(path.basename(file))) continue;
      const buf = fs.readFileSync(path.join(ROOT, file));
      if (buf.includes(0)) continue;
      const found = accountNumbersIn(buf.toString("utf8"));
      if (found.length > 0) hits.push(`${file}: ${found.length}件`);
    }
    assert.deepEqual(hits, []);
  });

  it("keeps share counts and costs out of data/", () => {
    const bad = files.filter((file) => {
      if (!file.startsWith("data/") || !/\.(json|ya?ml)$/i.test(file)) return false;
      return POSITION_KEY_RE.test(fs.readFileSync(path.join(ROOT, file), "utf8"));
    });
    assert.deepEqual(bad, []);
  });

  it("matches account-number shapes and allows the zero placeholder", () => {
    const u = (digits: string) => `U${digits}`;
    const seven = u("1234567");
    const eight = u("12345678");
    assert.deepEqual(accountNumbersIn(`acct ${seven} and ${eight}, not ${u("0000000")} or X${seven}`), [seven, eight]);
    assert.deepEqual(accountNumbersIn(`${u("123456")} ${u("123456789")}`), []);
  });
});
