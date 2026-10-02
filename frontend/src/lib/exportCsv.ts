/**
 * Shared CSV builder.
 *
 * Every CSV the user downloads goes through here, so quoting rules and the
 * formula-injection guard cannot drift between the ranking table, the charts,
 * and the ABC lists.
 */

/** One row of tabular data. Keys become the header row, in insertion order. */
export type CsvRow = Record<string, string | number | null | undefined>;

/**
 * Characters that make a spreadsheet treat a cell as a formula.
 *
 * `=` and `+` are the obvious ones, but `-` turns a negative-looking string into
 * arithmetic, and a leading `@` is a legacy Lotus-style reference. Tab and
 * carriage return are included because some importers strip a leading quote and
 * then re-evaluate the cell.
 */
const FORMULA_PREFIXES = ['=', '+', '-', '@', '\t', '\r'];

const NEEDS_QUOTING = /[",\n\r]/;

/** True when a cell would be interpreted as a formula by Excel or Sheets. */
export function isFormulaLike(value: string): boolean {
  return FORMULA_PREFIXES.includes(value.charAt(0));
}

/**
 * Neutralise a formula before writing it to a CSV.
 *
 * Prefixing with a single quote is what spreadsheets themselves use to mark a
 * cell as literal text. The value stays readable to a human.
 */
export function escapeFormulaValue(value: string): string {
  return isFormulaLike(value) ? `'${value}` : value;
}

/** Quote and escape a single field. */
export function escapeCsvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  // Formula protection is applied before quoting, so the guard applies to every
  // cell regardless of what else needs escaping.
  const safe = escapeFormulaValue(text);
  if (NEEDS_QUOTING.test(safe)) return `"${safe.replace(/"/g, '""')}"`;
  return safe;
}

/**
 * Build a CSV string from an ordered list of records.
 *
 * The header comes from the keys of the first row, so callers control column
 * order by the order they insert keys.
 */
export function buildCsv(rows: readonly CsvRow[]): string {
  if (rows.length === 0) return '';

  const columns = Object.keys(rows[0]);
  const lines = [columns.map(escapeCsvField).join(',')];
  for (const row of rows) {
    lines.push(columns.map((column) => escapeCsvField(row[column])).join(','));
  }
  // A trailing newline keeps `cat` and spreadsheet importers happy.
  return `${lines.join('\r\n')}\r\n`;
}

/** RFC 4180 line endings, used by the CSV tests to assert quoting exactly. */
export const CSV_NEWLINE = '\r\n';