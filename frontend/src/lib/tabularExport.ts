/**
 * CSV and PDF export for anything shaped like a table.
 *
 * The ranking table and the two product lists differ only in which rows they
 * pass in, so they share one descriptor and one set of exporters. Putting the
 * CSV path here also means those files cannot drift from the chart CSVs: both go
 * through `buildCsv`, which is the only place the formula-injection guard lives.
 */

import { buildCsv, type CsvRow } from '@/lib/exportCsv';
import { buildFilename, downloadText, triggerDownload } from '@/lib/download';
import { DOWNLOAD_ITEMS, type DownloadItemSlug } from '@/lib/constants';
// Type-only, so jsPDF itself is not pulled in: `import type` is erased whole.
import type { TablePdfColumn } from '@/lib/exportPdf';

export type TabularCell = string | number | null | undefined;

export interface TabularExport {
  /** Which entry in DOWNLOAD_ITEMS this is; supplies the filename slug. */
  item: keyof typeof DOWNLOAD_ITEMS;
  /** Heading used in the PDF. */
  title: string;
  /** One-line explanation under the PDF heading. */
  caption?: string;
  /** The uploaded file's name, for the filename. */
  sourceFileName: string;
  columns: readonly TablePdfColumn[];
  /** Cell values in column order. Callers pre-format numbers for display. */
  rows: readonly (readonly TabularCell[])[];
  /**
   * Row count before any capping, so the PDF note can say what was left out.
   * Defaults to `rows.length`.
   */
  totalRows?: number;
}

function slugOf(item: keyof typeof DOWNLOAD_ITEMS): DownloadItemSlug {
  return DOWNLOAD_ITEMS[item].slug;
}

/**
 * Build the CSV. Cells become an ordered record so the shared builder can apply
 * its quoting and formula-injection rules unchanged.
 */
export function buildTabularCsv({ columns, rows }: TabularExport): string {
  const records: CsvRow[] = rows.map((row) => {
    const record: CsvRow = {};
    columns.forEach((column, index) => {
      record[column.header] = row[index] ?? null;
    });
    return record;
  });
  return buildCsv(records);
}

/** Download the rows as CSV, with formula-injection protection. */
export function exportTabularCsv(descriptor: TabularExport): void {
  const filename = buildFilename({
    sourceFileName: descriptor.sourceFileName,
    itemName: slugOf(descriptor.item),
    extension: 'csv',
  });
  downloadText(buildTabularCsv(descriptor), { filename, extension: 'csv' });
}

/**
 * Download the rows as a paginated PDF with a real, selectable table.
 *
 * jsPDF is imported here rather than at the top of the module, so it stays out of
 * the initial bundle: most sessions never press this button.
 */
export async function exportTabularPdf(descriptor: TabularExport): Promise<void> {
  const filename = buildFilename({
    sourceFileName: descriptor.sourceFileName,
    itemName: slugOf(descriptor.item),
    extension: 'pdf',
  });
  const { buildTablePdf } = await import('@/lib/exportPdf');

  const blob = await buildTablePdf({
    title: descriptor.title,
    caption: descriptor.caption,
    // Autotable renders JSX-free strings; null cells must not become "null".
    columns: descriptor.columns.map((column) => ({
      header: column.header,
      ...(column.width === undefined ? {} : { width: column.width }),
      ...(column.align === undefined ? {} : { align: column.align }),
    })),
    rows: descriptor.rows.map((row) =>
      row.map((cell) => (cell === null || cell === undefined ? '' : String(cell)))
    ),
    // The footer and the metadata both want the name without the extension.
    fileName: filename.replace(/\.pdf$/, ''),
    totalRows: descriptor.totalRows ?? descriptor.rows.length,
  });

  triggerDownload(blob, filename);
}