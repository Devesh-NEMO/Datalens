import { describe, it, expect } from 'vitest';
import {
  buildCsv,
  escapeCsvField,
  escapeFormulaValue,
  isFormulaLike,
  type CsvRow,
} from '@/lib/exportCsv';

describe('isFormulaLike', () => {
  it('flags every character a spreadsheet treats as a formula', () => {
    for (const prefix of ['=', '+', '-', '@', '\t', '\r']) {
      expect(isFormulaLike(`${prefix}1+1`)).toBe(true);
    }
  });

  it('does not flag ordinary text or numbers', () => {
    for (const value of ['Widget', '1+1', 'A-1', '', '100', '  =sum']) {
      expect(isFormulaLike(value)).toBe(false);
    }
  });
});

describe('escapeFormulaValue', () => {
  it('prefixes a single quote to neutralise a formula', () => {
    expect(escapeFormulaValue('=1+1')).toBe("'=1+1");
    expect(escapeFormulaValue('@SUM(A1)')).toBe("'@SUM(A1)");
  });

  it('leaves safe values untouched', () => {
    expect(escapeFormulaValue('Widget')).toBe('Widget');
    expect(escapeFormulaValue('42')).toBe('42');
  });
});

describe('escapeCsvField', () => {
  it('quotes fields containing commas', () => {
    expect(escapeCsvField('a,b')).toBe('"a,b"');
  });

  it('doubles embedded quotes', () => {
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
  });

  it('quotes fields containing newlines', () => {
    expect(escapeCsvField('line1\nline2')).toBe('"line1\nline2"');
  });

  it('renders null and undefined as empty', () => {
    expect(escapeCsvField(null)).toBe('');
    expect(escapeCsvField(undefined)).toBe('');
  });

  it('escapes a formula even when the field also needs quoting', () => {
    // The guard must apply before quoting, or the quote protects the formula.
    expect(escapeCsvField('=cmd|calc')).toBe("'=cmd|calc");
    expect(escapeCsvField('=1,2')).toBe('"\'=1,2"');
  });

  it('protects a formula that starts with a tab or CR', () => {
    expect(escapeCsvField('\t=1+1')).toBe("'\t=1+1");
    // A leading CR also needs RFC 4180 quoting, so it is quoted *and* prefixed.
    // The guard still applies first, which is the part that matters.
    expect(escapeCsvField('\r=1+1')).toBe('"\'\r=1+1"');
  });
});

describe('buildCsv', () => {
  it('writes a header from the first row keys, in order', () => {
    const csv = buildCsv([
      { Rank: 1, Product: 'Widget' },
      { Rank: 2, Product: 'Gadget' },
    ]);
    expect(csv).toBe('Rank,Product\r\n1,Widget\r\n2,Gadget\r\n');
  });

  it('protects a formula-injection payload in a product name', () => {
    const csv = buildCsv([{ Product: '=HYPERLINK("http://evil","click")' }]);
    expect(csv).toContain("'=HYPERLINK");
    // The dangerous characters survive as text, but the cell is inert.
    expect(csv).not.toMatch(/^Product,=HYPERLINK/m);
  });

  it('returns an empty string for no rows', () => {
    expect(buildCsv([])).toBe('');
  });

  it('handles the exact attack strings from the security requirement', () => {
    const rows: CsvRow[] = [
      { '=cmd': 1 },
      { '+cmd': 1 },
      { '-cmd': 1 },
      { '@cmd': 1 },
      { '\tcmd': 1 },
      { '\rcmd': 1 },
    ];
    const csv = buildCsv(rows);
    // Every formula-leading header must be neutralised.
    for (const bad of ['=cmd', '+cmd', '-cmd', '@cmd', '\tcmd', '\rcmd']) {
      expect(csv).not.toContain(`,${bad},`);
      expect(csv).not.toContain(`${bad},`);
    }
  });

  it('preserves non-Latin product names unchanged', () => {
    const csv = buildCsv([{ Product: '売上 データ', Value: 100 }]);
    expect(csv).toBe('Product,Value\r\n売上 データ,100\r\n');
  });

  it('quotes a product name containing a comma', () => {
    const csv = buildCsv([{ Product: 'Widget, Large' }]);
    expect(csv).toBe('Product\r\n"Widget, Large"\r\n');
  });
});