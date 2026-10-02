/**
 * Full report PDF builder.
 *
 * Orchestrates reportSections + exportChart + the PDF toolkit to produce a
 * complete multi-page PDF. The report always uses the light print palette,
 * whatever theme is on screen: a report is printed, filed, or pasted into
 * another document, and dark backgrounds print as grey smears.
 *
 * Nothing here screenshots the page. Headings, stats, warnings and tables are
 * real text; the only raster content is the chart images, which come from the
 * same offscreen export pipeline the per-chart downloads use.
 */

import type { jsPDF as JsPdfDocument } from 'jspdf';
import type { UserOptions } from 'jspdf-autotable';
import { createElement, type ReactNode } from 'react';
import type { AnalysisResponse, ProductRankItemResponse } from '@/lib/api';
import {
  buildReportSections,
  formatReportDateTime,
  type ReportSettings,
  type ChartMeta,
} from '@/lib/report/reportSections';
import {
  A4_HEIGHT,
  A4_WIDTH,
  FOOTER_HEIGHT,
  PAGE_MARGIN,
  PDF_COLORS,
  PDF_ROW_CAP,
  PDF_TYPE,
  type Rgb,
} from '@/lib/report/pdfTheme';
import { loadPdfFonts } from '@/lib/report/fonts';
import { DOWNLOAD_COPY } from '@/lib/constants';
import { renderChartToCanvas } from '@/lib/exportChart';
import { buildFilename } from '@/lib/download';

import {
  ParetoChart,
  TopProductsChart,
  AbcPieChart,
  AbcBarChart,
  HistogramChart,
  TrendChart,
} from '@/components/charts';

/** Horizontal room between the margins, in points. */
const CONTENT_WIDTH = A4_WIDTH - PAGE_MARGIN * 2;

/** Bottom edge of the printable area on a portrait page. */
const CONTENT_BOTTOM = A4_HEIGHT - PAGE_MARGIN - FOOTER_HEIGHT;

/** Height of the stats grid's first row, including its gap. */
const STAT_CELL_HEIGHT = 52;

export interface BuildReportOptions {
  /** The uploaded file's name, used to build the report filename. */
  sourceFileName: string;
  data: AnalysisResponse;
  settings: ReportSettings;
  /**
   * The rows currently visible in the ranking table, after filtering and
   * sorting. Used when the user picks "current filtered/sorted rows" for the
   * table scope.
   */
  currentRankingRows?: readonly ProductRankItemResponse[];
  /** True when `currentRankingRows` reflects what is on screen. */
  hasCurrentRankingRows?: boolean;
}

export interface BuildReportResult {
  blob: Blob;
  filename: string;
  /** True when the Unicode font could not be loaded and Helvetica was used. */
  fontsFailed: boolean;
}

interface PdfToolkit {
  createDocument: (orientation: 'portrait' | 'landscape') => JsPdfDocument;
  runTable: (doc: JsPdfDocument, options: UserOptions) => number;
}

let toolkitPromise: Promise<PdfToolkit> | null = null;

/**
 * Load jsPDF and jspdf-autotable on first use.
 *
 * Both stay out of the initial bundle for the majority of sessions, which never
 * ask for a report. A failed import is not cached, so a retry can succeed.
 */
function loadToolkit(): Promise<PdfToolkit> {
  toolkitPromise ??= (async () => {
    const [{ default: JsPdf }, autotable] = await Promise.all([
      import('jspdf'),
      import('jspdf-autotable'),
    ]);
    return {
      createDocument: (orientation) =>
        new JsPdf({ unit: 'pt', format: 'a4', orientation, compress: true }),
      // The public `autoTable()` in v5 returns nothing, so the bottom of the
      // table is only observable through the lower-level create/draw pair.
      runTable: (doc, options) => {
        const table = autotable.__createTable(doc, options);
        autotable.__drawTable(doc, table);
        return table.finalY ?? 0;
      },
    };
  })();
  return toolkitPromise.catch((error: unknown) => {
    toolkitPromise = null;
    throw error;
  });
}

/** Test seam: forget the cached toolkit. */
export function resetReportToolkitForTests(): void {
  toolkitPromise = null;
}

function tableColor(colour: Rgb): [number, number, number] {
  return [colour[0], colour[1], colour[2]];
}

/** Font family actually in use, so every draw call can pass it explicitly. */
type FontFamily = string;

/**
 * A cursor that flows down the page and starts a new one when it runs out of
 * room.
 *
 * Every section asks `need()` for the height it is about to consume and gets
 * either the y it already had or the top of a fresh page. Without this, a long
 * quality section silently draws its last lines into the footer.
 */
class PageCursor {
  y: number;

  constructor(
    private readonly doc: JsPdfDocument,
    private readonly font: FontFamily,
    startY: number = PAGE_MARGIN
  ) {
    this.y = startY;
  }

  /** Ask for `height` points. Returns the y to draw at. */
  need(height: number): number {
    if (this.y + height > CONTENT_BOTTOM) {
      this.doc.addPage();
      this.y = PAGE_MARGIN;
    }
    return this.y;
  }

  /** Record that `height` points were consumed. */
  advance(height: number): void {
    this.y += height;
  }
}

function drawHeading(
  doc: JsPdfDocument,
  font: FontFamily,
  text: string,
  y: number,
  size: number = PDF_TYPE.heading
): number {
  doc.setFont(font, 'bold');
  doc.setFontSize(size);
  doc.setTextColor(...PDF_COLORS.text);
  const lines = doc.splitTextToSize(text, CONTENT_WIDTH) as string[];
  doc.text(lines, PAGE_MARGIN, y);
  return y + lines.length * size * 1.25;
}

function drawParagraph(
  doc: JsPdfDocument,
  font: FontFamily,
  text: string,
  y: number,
  opts?: { muted?: boolean; indent?: number; size?: number }
): number {
  const size = opts?.size ?? PDF_TYPE.body;
  doc.setFont(font, 'normal');
  doc.setFontSize(size);
  doc.setTextColor(...(opts?.muted ? PDF_COLORS.mutedText : PDF_COLORS.text));
  const indent = opts?.indent ?? 0;
  const lines = doc.splitTextToSize(text, CONTENT_WIDTH - indent) as string[];
  doc.text(lines, PAGE_MARGIN + indent, y, { lineHeightFactor: 1.35 });
  return y + lines.length * size * 1.35 + 4;
}

/** Draw a section heading that respects page breaks. */
function heading(
  doc: JsPdfDocument,
  cursor: PageCursor,
  font: FontFamily,
  text: string,
  size: number = PDF_TYPE.heading
): number {
  const y = cursor.need(size * 2);
  const next = drawHeading(doc, font, text, y, size);
  cursor.advance(next - y + 8);
  return next + 8;
}

/**
 * Stamp the footer on every page: "Datalens", the file name, "Page X of Y".
 *
 * Runs once at the end because the total page count is not known until then, and
 * reads the page size per page so a landscape page gets a rule spanning its own
 * width.
 */
function drawPageFooters(doc: JsPdfDocument, font: FontFamily, fileName: string): void {
  const total = doc.getNumberOfPages();

  for (let page = 1; page <= total; page += 1) {
    doc.setPage(page);
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const ruleY = pageHeight - FOOTER_HEIGHT + 12;

    doc.setDrawColor(...PDF_COLORS.rule);
    doc.setLineWidth(0.75);
    doc.line(PAGE_MARGIN, ruleY, pageWidth - PAGE_MARGIN, ruleY);

    doc.setFont(font, 'normal');
    doc.setFontSize(PDF_TYPE.footer);
    doc.setTextColor(...PDF_COLORS.mutedText);
    doc.text(DOWNLOAD_COPY.pdfFooterBrand, PAGE_MARGIN, ruleY + 14);
    doc.text(fileName, pageWidth / 2, ruleY + 14, { align: 'center' });
    doc.text(DOWNLOAD_COPY.pdfPageOf(page, total), pageWidth - PAGE_MARGIN, ruleY + 14, {
      align: 'right',
    });
  }
}

/** Paint the white page. jsPDF defaults to white; be explicit. */
function fillPage(doc: JsPdfDocument): void {
  doc.setFillColor(...PDF_COLORS.page);
  doc.rect(0, 0, doc.internal.pageSize.getWidth(), doc.internal.pageSize.getHeight(), 'F');
}

/** Build the chart element for one report chart, or null if unavailable. */
function chartElement(id: ChartMeta['id'], data: AnalysisResponse): ReactNode | null {
  // `sourceFileName` is only used by the on-screen download menu, which the
  // export context hides; the report passes the real name through its own
  // filename instead.
  const props = { data, sourceFileName: '' };
  switch (id) {
    case 'pareto':
      return createElement(ParetoChart, props);
    case 'topProducts':
      return createElement(TopProductsChart, props);
    case 'abcPie':
      return createElement(AbcPieChart, props);
    case 'abcBar':
      return createElement(AbcBarChart, props);
    case 'histogram':
      return createElement(HistogramChart, props);
    case 'trend':
      return createElement(TrendChart, props);
    default:
      return null;
  }
}

/** Options shared by every autotable in the report. */
function tableStyles(font: FontFamily): UserOptions['styles'] {
  return {
    font,
    fontSize: PDF_TYPE.tableCell,
    textColor: tableColor(PDF_COLORS.text),
    lineColor: tableColor(PDF_COLORS.rule),
    lineWidth: 0.5,
    cellPadding: 5,
    overflow: 'ellipsize',
    minCellHeight: 15,
  };
}

export async function buildReport({
  sourceFileName,
  data,
  settings,
  currentRankingRows,
  hasCurrentRankingRows = false,
}: BuildReportOptions): Promise<BuildReportResult> {
  const { createDocument, runTable } = await loadToolkit();
  const doc = createDocument('portrait');
  fillPage(doc);

  // A Unicode font is registered per document, so this has to happen after the
  // document exists but before any text is drawn.
  const fontResult = await loadPdfFonts(doc);
  const font: FontFamily = fontResult.ok ? 'NotoSans' : 'helvetica';

  const filename = buildFilename({
    sourceFileName,
    itemName: 'report',
    extension: 'pdf',
  });
  const fileName = filename.replace(/\.pdf$/, '');

  // Deliberately no `author`: the report should carry nothing about who
  // uploaded the file.
  doc.setProperties({
    title: `${DOWNLOAD_COPY.pdfDocumentTitle} - ${fileName}`,
    creator: DOWNLOAD_COPY.pdfCreator,
  });

  const sections = buildReportSections({
    sourceFileName,
    data,
    settings,
    currentRankingRows: currentRankingRows ? [...currentRankingRows] : undefined,
    hasCurrentRankingRows,
  });

  const cursor = new PageCursor(doc, font, PAGE_MARGIN);

  for (const section of sections) {
    switch (section.kind) {
      case 'cover': {
        // The cover is a page of its own: title, what this is, which file it
        // describes, when it was made, and the settings it was made with.
        let y = PAGE_MARGIN + 180;
        doc.setFont(font, 'bold');
        doc.setFontSize(PDF_TYPE.display);
        doc.setTextColor(...PDF_COLORS.text);
        doc.text(section.title, PAGE_MARGIN, y);
        y += PDF_TYPE.display * 1.2;

        doc.setFont(font, 'normal');
        doc.setFontSize(PDF_TYPE.heading);
        doc.setTextColor(...PDF_COLORS.mutedText);
        doc.text(section.subtitle, PAGE_MARGIN, y);
        y += PDF_TYPE.heading * 1.6;

        doc.setDrawColor(...PDF_COLORS.rule);
        doc.setLineWidth(1);
        doc.line(PAGE_MARGIN, y, PAGE_MARGIN + 96, y);
        y += PDF_TYPE.body * 2;

        const st = section.settings;
        const facts: Array<[string, string]> = [
          ['File', section.fileNameBase],
          ['Generated', formatReportDateTime(section.generatedAt)],
          ['Product column', st.productColumn || '—'],
          ['Value column', st.valueColumn || '—'],
          ['Date column', st.dateColumn || '—'],
          ['Top N', String(st.topN)],
        ];
        for (const [label, value] of facts) {
          y = drawParagraph(doc, font, `${label}: ${value}`, y);
          y += 3;
        }

        doc.addPage();
        cursor.y = PAGE_MARGIN;
        break;
      }

      case 'text': {
        let y = heading(doc, cursor, font, section.heading);
        for (const paragraph of section.body) {
          y = drawParagraph(doc, font, paragraph, y);
        }
        cursor.y = y + 10;
        break;
      }

      case 'stats': {
        heading(doc, cursor, font, section.heading);
        // Two columns, so the four stats read as a block rather than a list.
        const columns = 2;
        const cellWidth = (CONTENT_WIDTH - 12) / columns;
        for (let i = 0; i < section.stats.length; i += 1) {
          const stat = section.stats[i];
          const column = i % columns;
          const row = Math.floor(i / columns);
          const x = PAGE_MARGIN + column * (cellWidth + 12);
          const y = cursor.need(STAT_CELL_HEIGHT) + row * STAT_CELL_HEIGHT;

          doc.setFillColor(...PDF_COLORS.stripeFill);
          doc.rect(x, y, cellWidth, STAT_CELL_HEIGHT - 8, 'F');
          doc.setDrawColor(...PDF_COLORS.rule);
          doc.setLineWidth(0.5);
          doc.rect(x, y, cellWidth, STAT_CELL_HEIGHT - 8, 'S');

          doc.setFont(font, 'normal');
          doc.setFontSize(PDF_TYPE.caption);
          doc.setTextColor(...PDF_COLORS.mutedText);
          doc.text(stat.label.toUpperCase(), x + 10, y + 15);

          doc.setFont(font, 'bold');
          doc.setFontSize(PDF_TYPE.subheading);
          doc.setTextColor(...PDF_COLORS.text);
          doc.text(stat.value, x + 10, y + 31);

          if (stat.sublabel) {
            doc.setFont(font, 'normal');
            doc.setFontSize(PDF_TYPE.caption);
            doc.setTextColor(...PDF_COLORS.mutedText);
            doc.text(
              doc.splitTextToSize(stat.sublabel, cellWidth - 20) as string[],
              x + 10,
              y + 41
            );
          }
        }
        cursor.advance(Math.ceil(section.stats.length / columns) * STAT_CELL_HEIGHT + 8);
        break;
      }

      case 'quality': {
        heading(doc, cursor, font, section.heading);
        let y = cursor.y;
        for (const warning of section.warnings) {
          // Reserve room for the bullet plus at least one wrapped line.
          y = cursor.need(PDF_TYPE.body * 2) + 0;
          y = drawParagraph(doc, font, `•  ${warning.text}`, y, { indent: 10 });
          cursor.y = y;
        }
        cursor.y = y + 10;
        break;
      }

      case 'settings': {
        heading(doc, cursor, font, section.heading);
        let y = cursor.y;
        for (const item of section.items) {
          y = cursor.need(PDF_TYPE.body * 2);
          doc.setFont(font, 'bold');
          doc.setFontSize(PDF_TYPE.body);
          doc.setTextColor(...PDF_COLORS.text);
          const labelWidth = 110;
          doc.text(`${item.label}:`, PAGE_MARGIN, y);
          doc.setFont(font, 'normal');
          doc.setTextColor(...PDF_COLORS.mutedText);
          const lines = doc.splitTextToSize(item.value, CONTENT_WIDTH - labelWidth) as string[];
          doc.text(lines, PAGE_MARGIN + labelWidth, y, { lineHeightFactor: 1.35 });
          y += Math.max(1, lines.length) * PDF_TYPE.body * 1.35 + 5;
          cursor.y = y;
        }
        cursor.y = y + 10;
        break;
      }

      case 'charts': {
        heading(doc, cursor, font, section.heading);
        for (const chart of section.charts) {
          if (!chart.present) continue;

          const element = chartElement(chart.id, data);
          if (!element) continue;

          let y = cursor.need(PDF_TYPE.subheading * 2) + 0;
          y = drawHeading(doc, font, chart.title, y, PDF_TYPE.subheading);
          y += 2;
          const captionEnd = drawParagraph(doc, font, chart.caption, y, {
            muted: true,
            size: PDF_TYPE.caption,
          });
          cursor.y = captionEnd;

          // Reserve the heading, the image, and a gap before drawing, so the
          // image can never straddle a page break.
          const imageTop = cursor.need(200) + 0;
          const available = CONTENT_BOTTOM - imageTop;
          const raster = await renderChartToCanvas({
            render: () => element,
            title: '',
            caption: '',
            theme: 'light',
          });

          const aspect = raster.canvas.height === 0 ? 1 : raster.canvas.width / raster.canvas.height;
          let width = CONTENT_WIDTH;
          let height = width / aspect;
          if (height > available) {
            height = available;
            width = height * aspect;
          }

          doc.addImage(
            raster.canvas,
            'PNG',
            PAGE_MARGIN + (CONTENT_WIDTH - width) / 2,
            imageTop,
            width,
            height,
            undefined,
            'FAST'
          );
          cursor.y = imageTop + height + 16;
        }
        break;
      }

      case 'lists': {
        heading(doc, cursor, font, section.heading);

        const listColumns: UserOptions['columnStyles'] = {
          0: { cellWidth: 36, halign: 'right' },
          2: { halign: 'right' },
          3: { halign: 'right' },
          4: { halign: 'right' },
          5: { cellWidth: 40, halign: 'center' },
        };

        for (const [label, rows] of [
          [DOWNLOAD_COPY.mostImportantLabel, section.mostImportant],
          [DOWNLOAD_COPY.leastImportantLabel, section.leastImportant],
        ] as const) {
          if (rows.length === 0) continue;
          const labelY = cursor.need(PDF_TYPE.body * 2) + 0;
          const afterLabel = drawParagraph(doc, font, label, labelY);
          cursor.y = afterLabel;

          const startY = cursor.need(60) + 0;
          cursor.y =
            runTable(doc, {
              head: [['Rank', 'Product', 'Value', 'Share %', 'Change %', 'Class']],
              body: rows.map((row) => [
                String(row.rank),
                row.product,
                row.value,
                row.sharePct,
                row.changePct ?? '',
                row.abcClass,
              ]),
              startY,
              margin: { left: PAGE_MARGIN, right: PAGE_MARGIN, bottom: PAGE_MARGIN + FOOTER_HEIGHT },
              theme: 'grid',
              styles: tableStyles(font),
              headStyles: {
                fillColor: tableColor(PDF_COLORS.headerFill),
                textColor: tableColor(PDF_COLORS.text),
                fontStyle: 'bold',
              },
              alternateRowStyles: { fillColor: tableColor(PDF_COLORS.stripeFill) },
              columnStyles: listColumns,
              showHead: 'everyPage',
            }) + 18;
        }
        break;
      }

      case 'rankingTable': {
        heading(doc, cursor, font, section.heading);
        cursor.y = drawParagraph(doc, font, section.caption, cursor.y, {
          muted: true,
          size: PDF_TYPE.caption,
        });

        const shown = section.rows.slice(0, PDF_ROW_CAP);
        const truncated = section.totalRows > shown.length;
        const note = truncated
          ? DOWNLOAD_COPY.rowCapNote(shown.length, section.totalRows)
          : null;

        const startY = cursor.need(60) + 0;
        cursor.y = runTable(doc, {
          head: [section.columns.map((column) => column.header)],
          body: shown.map((row) => [
            String(row.rank),
            row.product,
            row.value,
            row.sharePct,
            row.cumulativePct,
            row.abcClass,
            row.growthPct ?? '',
          ]),
          // The note is a foot row, not floating text: it is drawn once, on the
          // last page, inside the table's own grid, so it cannot overlap the
          // final data row or be stranded above a page break.
          ...(note ? { foot: [[note, '', '', '', '', '', '']] } : {}),
          startY,
          margin: { left: PAGE_MARGIN, right: PAGE_MARGIN, bottom: PAGE_MARGIN + FOOTER_HEIGHT },
          theme: 'grid',
          styles: tableStyles(font),
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
          columnStyles: {
            0: { cellWidth: 34, halign: 'right' },
            2: { cellWidth: 78, halign: 'right' },
            3: { cellWidth: 56, halign: 'right' },
            4: { cellWidth: 68, halign: 'right' },
            5: { cellWidth: 38, halign: 'center' },
            6: { cellWidth: 62, halign: 'right' },
          },
          showHead: 'everyPage',
          showFoot: 'lastPage',
        });
        break;
      }

      default:
        break;
    }
  }

  drawPageFooters(doc, font, fileName);
  return { blob: doc.output('blob'), filename, fontsFailed: fontResult.failed };
}
