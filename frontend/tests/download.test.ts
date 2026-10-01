import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildFilename,
  slugifyPart,
  stripExtension,
  isoDate,
  mimeTypeFor,
  triggerDownload,
  downloadText,
} from '@/lib/download';

const DATE = new Date(2026, 9, 1); // 2026-10-01, local time

describe('slugifyPart', () => {
  it('lower-cases and dashes spaces', () => {
    expect(slugifyPart('Sales Messy')).toBe('sales-messy');
  });

  it('collapses runs of whitespace and dashes', () => {
    expect(slugifyPart('sales   messy --- file')).toBe('sales-messy-file');
  });

  it('removes characters that are unsafe in a path or on Windows', () => {
    expect(slugifyPart('a/b\\c:d*e?f"g<h>i|j')).toBe('a-b-c-d-e-f-g-h-i-j');
  });

  it('treats underscores as word separators', () => {
    expect(slugifyPart('sales_messy')).toBe('sales-messy');
  });

  it('strips path traversal attempts', () => {
    // Separators become dashes rather than vanishing, so word boundaries survive.
    expect(slugifyPart('../../etc/passwd')).toBe('etc-passwd');
    expect(slugifyPart('..\\..\\windows\\system32')).toBe('windows-system32');
  });

  it('strips bidirectional overrides that could disguise an extension', () => {
    // U+202E reverses the text that follows, so "gpj.exe" can read as "exe.jpg".
    expect(slugifyPart('report\u202egpj.exe')).toBe('reportgpjexe');
  });

  it('strips null bytes and other control characters', () => {
    expect(slugifyPart('na\u0000me\u0007.csv')).toBe('namecsv');
  });

  it('keeps Unicode letters and numbers', () => {
    expect(slugifyPart('Café Crème')).toBe('café-crème');
    expect(slugifyPart('売上 2024')).toBe('売上-2024');
  });

  it('trims leading and trailing dashes', () => {
    expect(slugifyPart('  --name--  ')).toBe('name');
  });

  it('caps very long input', () => {
    expect(slugifyPart('a'.repeat(200)).length).toBeLessThanOrEqual(48);
  });

  it('returns an empty string for text with nothing usable', () => {
    expect(slugifyPart('!!!@@@###')).toBe('');
  });
});

describe('stripExtension', () => {
  it('removes the final extension', () => {
    expect(stripExtension('sales_messy.csv')).toBe('sales_messy');
    expect(stripExtension('archive.tar.gz')).toBe('archive.tar');
  });

  it('leaves a dotfile alone', () => {
    expect(stripExtension('.env')).toBe('.env');
  });

  it('leaves a name with no extension alone', () => {
    expect(stripExtension('sales')).toBe('sales');
  });
});

describe('isoDate', () => {
  it('formats as YYYY-MM-DD in local time', () => {
    expect(isoDate(DATE)).toBe('2026-10-01');
  });

  it('zero-pads single digit months and days', () => {
    expect(isoDate(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('buildFilename', () => {
  it('matches the documented shape', () => {
    expect(
      buildFilename({
        sourceFileName: 'sales_messy.csv',
        itemName: 'pareto-curve',
        extension: 'png',
        date: DATE,
      })
    ).toBe('datalens-sales-messy-pareto-curve-2026-10-01.png');
  });

  it('replaces spaces with dashes across every part', () => {
    expect(
      buildFilename({
        sourceFileName: 'Q3 Sales Data.csv',
        itemName: 'monthly trend',
        extension: 'pdf',
        date: DATE,
      })
    ).toBe('datalens-q3-sales-data-monthly-trend-2026-10-01.pdf');
  });

  it('never emits a path separator or traversal from the source name', () => {
    const name = buildFilename({
      sourceFileName: '../../../etc/passwd.csv',
      itemName: 'ranking-table',
      extension: 'csv',
      date: DATE,
    });
    expect(name).toBe('datalens-etc-passwd-ranking-table-2026-10-01.csv');
    expect(name).not.toContain('/');
    expect(name).not.toContain('\\');
    expect(name).not.toContain('..');
  });

  it('falls back when a part slugifies to nothing', () => {
    expect(
      buildFilename({
        sourceFileName: '###.csv',
        itemName: '###',
        extension: 'svg',
        date: DATE,
      })
    ).toBe('datalens-file-item-2026-10-01.svg');
  });

  it('keeps the total length bounded even with a huge source name', () => {
    const name = buildFilename({
      sourceFileName: `${'a'.repeat(400)}.csv`,
      itemName: 'value-histogram',
      extension: 'pdf',
      date: DATE,
    });
    expect(name.length).toBeLessThanOrEqual(140);
    expect(name.endsWith('-value-histogram-2026-10-01.pdf')).toBe(true);
  });

  it('is deterministic for a given date', () => {
    const args = { sourceFileName: 'a.csv', itemName: 'histogram', extension: 'csv' as const };
    expect(buildFilename({ ...args, date: DATE })).toBe(buildFilename({ ...args, date: DATE }));
  });
});

describe('mimeTypeFor', () => {
  it('maps each extension', () => {
    expect(mimeTypeFor('csv')).toContain('text/csv');
    expect(mimeTypeFor('svg')).toContain('image/svg+xml');
    expect(mimeTypeFor('png')).toBe('image/png');
    expect(mimeTypeFor('pdf')).toBe('application/pdf');
    expect(mimeTypeFor('zip')).toBe('application/zip');
  });
});

describe('triggerDownload', () => {
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;
  let click: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    createObjectURL = vi.fn(() => 'blob:mock-url');
    revokeObjectURL = vi.fn();
    click = vi.fn();
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL,
      revokeObjectURL,
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(click);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('clicks an anchor carrying the filename, then removes it from the DOM', () => {
    triggerDownload(new Blob(['a,b']), 'datalens-test-2026-10-01.csv');

    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    // No orphan anchors left behind after the click.
    expect(document.querySelectorAll('a')).toHaveLength(0);
  });

  it('revokes the object URL after the download starts', () => {
    vi.useFakeTimers();
    triggerDownload(new Blob(['x']), 'datalens-test.csv');

    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });

  it('is safe to revoke twice', () => {
    vi.useFakeTimers();
    const { revoke } = triggerDownload(new Blob(['x']), 'datalens-test.csv');
    revoke();
    revoke();
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it('downloadText builds a Blob with the right MIME type', () => {
    downloadText('product,value\nA,1', { filename: 'datalens-a.csv' });
    expect(createObjectURL).toHaveBeenCalledOnce();
    const blob = createObjectURL.mock.calls[0][0] as unknown as Blob;
    expect(blob.type).toContain('text/csv');
  });
});