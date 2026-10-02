/**
 * PDF construction: real text, real tables, real pagination.
 *
 * Nothing here screenshots the page. A screenshot-based PDF has no selectable
 * text, no reflow, and no accessible reading order, which defeats the point of
 * asking for a document rather than a picture. jsPDF draws the type and
 * jspdf-autotable lays out the table; chart pixels come from the exportChart
 * pipeline and are the only raster in the file.
 *
 * jsPDF and jspdf-autotable are imported with a dynamic `import()` so that the
 * PDF machinery stays out of the initial bundle for the majority of sessions,
 * which never open this menu.
 */

import type { jsPDF as JsPdfDocument } from 'jspdf';
import type { UserOptions } from 'jspdf-autotable';
import {
  A4_WIDTH,
  FOOTER_HEIGHT,
  PDF_COLORS,
  PDF_ROW_CAP,
  PDF_TYPE,
  PAGE_MARGIN,
  type Rgb,
} from '@/lib/report/pdfTheme';
import { DOWNLOAD_COPY } from '@/lib/constants';

/**
 * Rows above this are dropped from a PDF table, with a note pointing at the CSV.
 *
 * A PDF is read on screen or on paper. A two-hundred-page table is read by
 * neither, and the CSV already carries every row.
 */
export { PDF_ROW_CAP };

/** A colour as jspdf-autotable wants it: a mutable 0-255 triplet. */
type TableColor = [number, number, number];

function tableColor(colour: Rgb): TableColor {
  return [colour[0], colour[1], colour[2]];
}

/** Horizontal room between the margins, in points. */
export const CONTENT_WIDTH = A4_WIDTH - PAGE_MARGIN * 2;

interface PdfToolkit {
  createDocument: (options: { orientation: 'portrait' | 'landscape' }) => JsPdfDocument;
  /** Runs a table and reports where it finished, in points from the top. */
  runTable: (
    doc: JsPdfDocument,
    options: UserOptions
  ) => { finalY: number; pages: number };
}

let toolkitPromise: Promise<PdfToolkit> | null = null;

/**
 * Load the PDF libraries on first use and keep them for later downloads.
 *
 * The promise is cached so a second download resolves instantly, and so two
 * rapid clicks cannot pull two copies of jsPDF.
 */
export function loadPdfToolkit(): Promise<PdfToolkit> {
  toolkitPromise ??= (async () => {
    const [{ default: JsPdf }, autotable] = await Promise.all([
      import('jspdf'),
      import('jspdf-autotable'),
    ]);

    return {
      createDocument: (options) =>
        new JsPdf({
          unit: 'pt',
          format: 'a4',
          orientation: options.orientation,
          compress: true,
        }),
      // The public `autoTable()` in v5 returns nothing, so the bottom of the
      // table is only observable through the lower-level create/draw pair.
      runTable: (doc, options) => {
        const table = autotable.__createTable(doc, options);
        autotable.__drawTable(doc, table);
        return { finalY: table.finalY ?? 0, pages: doc.getNumberOfPages() };
      },
    };
  })();

  // A failed import must not be cached, or every later attempt fails instantly.
  return toolkitPromise.catch((error: unknown) => {
    toolkitPromise = null;
    throw error;
  });
}

/** Test seam: forget the cached toolkit. */
export function resetPdfToolkitForTests(): void {
  toolkitPromise = null;
}

/**
 * Apply document metadata.
 *
 * Deliberately no `author`: the file should carry nothing about who uploaded it,
 * and PDF readers surface the author field prominently enough that a name or
 * email there would be a leak.
 */
export function applyPdfMetadata(doc: JsPdfDocument, fileName: string): void {
  doc.setProperties({
    title: `${DOWNLOAD_COPY.pdfDocumentTitle} - ${fileName}`,
    creator: DOWNLOAD_COPY.pdfCreator,
  });
}

/** Paint the white page background. jsPDF defaults to white; be explicit. */
function fillPage(doc: JsPdfDocument): void {
  doc.setFillColor(...PDF_COLORS.page);
  doc.rect(0, 0, doc.internal.pageSize.getWidth(), doc.internal.pageSize.getHeight(), 'F');
}

/**
 * Stamp the footer on every page: "Datalens", the file name, "Page X of Y".
 *
 * Called once at the end, because the total page count is not known until then.
 */
export function drawPageFooters(doc: JsPdfDocument, fileName: string): void {
  const total = doc.getNumberOfPages();

  for (let page = 1; page <= total; page += 1) {
    doc.setPage(page);
    // Read the page size per page so portrait and landscape pages in one file
    // each get a rule that spans their own width.
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const ruleY = pageHeight - FOOTER_HEIGHT + 12;

    doc.setDrawColor(...PDF_COLORS.rule);
    doc.setLineWidth(0.75);
    doc.line(PAGE_MARGIN, ruleY, pageWidth - PAGE_MARGIN, ruleY);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(PDF_TYPE.footer);
    doc.setTextColor(...PDF_COLORS.mutedText);

    doc.text(DOWNLOAD_COPY.pdfFooterBrand, PAGE_MARGIN, ruleY + 14);
    doc.text(fileName, pageWidth / 2, ruleY + 14, { align: 'center' });
    doc.text(DOWNLOAD_COPY.pdfPageOf(page, total), pageWidth - PAGE_MARGIN, ruleY + 14, {
      align: 'right',
    });
  }
}

/** Draw a heading and return the y position just below it. */
export function drawHeading(
  doc: JsPdfDocument,
  text: string,
  y: number,
  size: number = PDF_TYPE.heading
): number {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(size);
  doc.setTextColor(...PDF_COLORS.text);
  const lines = doc.splitTextToSize(text, CONTENT_WIDTH) as string[];
  doc.text(lines, PAGE_MARGIN, y);
  return y + lines.length * size * 1.25;
}

/** Draw a wrapped caption paragraph and return the y position just below it. */
export function drawCaption(doc: JsPdfDocument, text: string, y: number): number {
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(PDF_TYPE.caption);
  doc.setTextColor(...PDF_COLORS.mutedText);
  const lines = doc.splitTextToSize(text, CONTENT_WIDTH) as string[];
  doc.text(lines, PAGE_MARGIN, y, { lineHeightFactor: 1.35 });
  return y + lines.length * PDF_TYPE.caption * 1.35 + 10;
}

export interface ChartPdfOptions {
  /** Already rasterised chart, with its own title and caption baked in. */
  canvas: HTMLCanvasElement;
  /** The base name of the file, used in the footer and metadata. */
  fileName: string;
}

/**
 * A single-page PDF holding one chart.
 *
 * The page is landscape because the chart is 16:9. On a portrait page it would
 * shrink to a strip with a third of the paper blank above and below it.
 */
export async function buildChartPdf({ canvas, fileName }: ChartPdfOptions): Promise<Blob> {
  const { createDocument } = await loadPdfToolkit();
  const doc = createDocument({ orientation: 'landscape' });
  applyPdfMetadata(doc, fileName);
  fillPage(doc);

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const maxWidth = pageWidth - PAGE_MARGIN * 2;
  const maxHeight = pageHeight - PAGE_MARGIN * 2 - FOOTER_HEIGHT;

  // Fit inside the content box without distorting the chart.
  const aspect = canvas.height === 0 ? 1 : canvas.width / canvas.height;
  let width = maxWidth;
  let height = width / aspect;
  if (height > maxHeight) {
    height = maxHeight;
    width = height * aspect;
  }

  doc.addImage(
    canvas,
    'PNG',
    (pageWidth - width) / 2,
    PAGE_MARGIN + (maxHeight - height) / 2,
    width,
    height,
    undefined,
    'FAST'
  );

  drawPageFooters(doc, fileName);
  return doc.output('blob');
}

export interface TablePdfColumn {
  header: string;
  /** Fixed column width in points. Omit for an auto-sized column. */
  width?: number;
  align?: 'left' | 'right' | 'center';
}

export interface TablePdfOptions {
  title: string;
  caption?: string;
  columns: readonly TablePdfColumn[];
  /** Rows as cell strings. Numbers are pre-formatted by the caller. */
  rows: readonly (readonly string[])[];
  fileName: string;
  /**
   * Row count before capping. Defaults to `rows.length`; pass the pre-cap count
   * so the note can say what was left out.
   */
  totalRows?: number;
}

/**
 * A paginated table as a real PDF table, with the header repeated on every page.
 *
 * The row-cap note is a `foot` row rather than floating text. A `foot` row is
 * drawn once, on the last page, inside the table's own cell grid, so it cannot
 * overlap the final data row and cannot be stranded above a page break.
 */
export async function buildTablePdf({
  title,
  caption,
  columns,
  rows,
  fileName,
  totalRows = rows.length,
}: TablePdfOptions): Promise<Blob> {
  const { createDocument, runTable } = await loadPdfToolkit();
  const doc = createDocument({ orientation: 'portrait' });
  applyPdfMetadata(doc, fileName);
  fillPage(doc);

  let cursorY = PAGE_MARGIN + PDF_TYPE.heading;
  cursorY = drawHeading(doc, title, cursorY);
  if (caption) cursorY = drawCaption(doc, caption, cursorY);

  const shown = rows.slice(0, PDF_ROW_CAP);
  const truncationNote =
    totalRows > shown.length ? DOWNLOAD_COPY.rowCapNote(shown.length, totalRows) : null;

  runTable(doc, {
    head: [columns.map((column) => column.header)],
    body: shown.map((row) => [...row]),
    ...(truncationNote
      ? { foot: [columns.map((_, index) => (index === 0 ? truncationNote : ''))] }
      : {}),
    // A table continued onto page 3 must not lose its column headers.
    showHead: 'everyPage',
    showFoot: 'lastPage',
    startY: cursorY,
    margin: { left: PAGE_MARGIN, right: PAGE_MARGIN, bottom: PAGE_MARGIN + FOOTER_HEIGHT },
    theme: 'grid',
    tableLineWidth: 0.5,
    styles: {
      font: 'helvetica',
      fontSize: PDF_TYPE.tableCell,
      textColor: tableColor(PDF_COLORS.text),
      lineColor: tableColor(PDF_COLORS.rule),
      lineWidth: 0.5,
      cellPadding: 5,
      overflow: 'ellipsize',
      minCellHeight: 15,
    },
    headStyles: {
      fillColor: tableColor(PDF_COLORS.headerFill),
      textColor: tableColor(PDF_COLORS.text),
      fontStyle: 'bold',
      lineWidth: { bottom: 0.75 },
    },
    footStyles: {
      fontStyle: 'italic',
      textColor: tableColor(PDF_COLORS.mutedText),
      fillColor: tableColor(PDF_COLORS.page),
      lineWidth: 0,
      halign: 'left',
    },
    alternateRowStyles: { fillColor: tableColor(PDF_COLORS.stripeFill) },
    columnStyles: Object.fromEntries(
      columns.map((column, index) => [
        index,
        {
          ...(column.width === undefined ? {} : { cellWidth: column.width }),
          ...(column.align === undefined ? {} : { halign: column.align }),
        },
      ])
    ),
  });

  drawPageFooters(doc, fileName);
  return doc.output('blob');
}

/** The print palette's ABC colour, for a legend swatch or a coloured cell. */
export function classSwatch(abcClass: 'A' | 'B' | 'C'): Rgb {
  if (abcClass === 'A') return PDF_COLORS.classA;
  if (abcClass === 'B') return PDF_COLORS.classB;
  return PDF_COLORS.classC;
}