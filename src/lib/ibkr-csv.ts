/**
 * IBKR statement CSVs are many tables in one file: every line starts with the section name and a
 * row type (Header / Data / SubTotal / Total / Notes). Parsing happens in the browser only.
 */

/** RFC 4180 rows: quoted fields may hold commas, quotes ("") and line breaks. Handles BOM and CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.length > 1 || row[0] !== "") rows.push(row);
  return rows;
}

export type Section = {
  name: string;
  /** Trimmed header labels after the section name and row type. */
  header: string[];
  /** Data rows only, same offsets as `header`. */
  rows: string[][];
};

/** Splits a statement into its tables. A repeated header starts a new table even under the same name. */
export function readSections(rows: string[][]): Section[] {
  const sections: Section[] = [];
  let current: Section | null = null;
  for (const row of rows) {
    const [name, type, ...rest] = row;
    if (type === "Header") {
      current = { name: name.trim(), header: rest.map((cell) => cell.trim()), rows: [] };
      sections.push(current);
    } else if (type === "Data" && current && current.name === name.trim()) {
      current.rows.push(rest);
    }
  }
  return sections;
}

/** Index of the first header matching any alias, compared without spaces and case. */
export function column(header: string[], aliases: string[]): number {
  const norm = (value: string) => value.replace(/\s+/g, "").toLowerCase();
  const wanted = aliases.map(norm);
  return header.findIndex((label) => wanted.includes(norm(label)));
}

/** "1,234.50", "-12", "(3.5)" → number; blank or "--" → null. */
export function parseNumber(value: string | undefined): number | null {
  if (value == null) return null;
  let text = value.trim().replace(/[,$\s]/g, "");
  if (text === "" || text === "--" || text === "-") return null;
  let sign = 1;
  if (/^\(.*\)$/.test(text)) {
    sign = -1;
    text = text.slice(1, -1);
  }
  const n = Number(text);
  return Number.isFinite(n) ? sign * n : null;
}
