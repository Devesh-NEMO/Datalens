/**
 * Report section builder tests.
 *
 * These are pure-function tests: no jsPDF, no canvas, no DOM. The builder is
 * where the report's content decisions live (order, which warnings appear, how
 * the table scope is resolved), so it is worth pinning down without the noise of
 * a PDF renderer.
 */

import { describe, it, expect } from 'vitest';
import { buildReportSections, formatReportDateTime } from '@/lib/report/reportSections';
import type { ReportSettings } from '@/lib/report/reportSections';
import type { AnalysisResponse } from '@/lib/api';
import fixture from '../__fixtures__/analyze_sales_clean.json';

const data = fixture as unknown as AnalysisResponse;

function settings(overrides: Partial<ReportSettings> = {}): ReportSettings {
  return {
    includeSummary: true,
    includeQuality: true,
    includeSettings: true,
    includeCharts: true,
    includeLists: true,
    includeRankingTable: true,
    tableScopeAll: false,
    topN: 10,
    productColumn: 'product',
    valueColumn: 'revenue',
    dateColumn: 'date',
    ...overrides,
  };
}

const build = (overrides: Partial<ReportSettings> = {}, extra = {}) =>
  buildReportSections({
    sourceFileName: 'sales_clean.csv',
    data,
    settings: settings(overrides),
    ...extra,
  });

describe('buildReportSections', () => {
  it('puts the cover first and never omits it', () => {
    const sections = build({ includeSummary: false, includeCharts: false });
    expect(sections[0]?.kind).toBe('cover');
  });

  it('keeps the sections in the order the report is specified in', () => {
    const kinds = build().map((section) => section.kind);
    expect(kinds).toEqual([
      'cover',
      'text', // Pareto insight
      'stats', // 4 summary stats
      'quality',
      'settings',
      'charts',
      'lists',
      'rankingTable',
    ]);
  });

  it('drops sections the user unticked', () => {
    const kinds = build({ includeQuality: false, includeLists: false }).map((s) => s.kind);
    expect(kinds).not.toContain('quality');
    expect(kinds).not.toContain('lists');
    expect(kinds).toContain('charts');
  });

  it('describes the cover from the source file and the chosen settings', () => {
    const cover = build()[0];
    if (cover?.kind !== 'cover') throw new Error('expected a cover');

    expect(cover.title).toBe('Datalens');
    expect(cover.subtitle).toBe('Analysis report');
    // The extension is stripped: the report filename carries its own.
    expect(cover.fileNameBase).toBe('sales_clean');
    expect(cover.settings.productColumn).toBe('product');
    expect(cover.settings.valueColumn).toBe('revenue');
    expect(cover.settings.dateColumn).toBe('date');
    expect(cover.settings.topN).toBe(10);
  });

  it('leads with the Pareto insight the analysis already computed', () => {
    const text = build().find((section) => section.kind === 'text');
    if (text?.kind !== 'text') throw new Error('expected a text section');
    expect(text.heading).toBe('Pareto insight');
    expect(text.body[0]).toBe(data.ranking.pareto_summary);
  });

  it('reports exactly four summary stats, with the ABC split as a sublabel', () => {
    const stats = build().find((section) => section.kind === 'stats');
    if (stats?.kind !== 'stats') throw new Error('expected a stats section');

    expect(stats.stats).toHaveLength(4);
    expect(stats.stats.map((stat) => stat.label)).toEqual([
      'Rows',
      'Columns',
      'Total value',
      'Products',
    ]);
    // The letter is always in the text, so the report is readable in greyscale
    // and to a screen reader.
    const products = stats.stats[3];
    expect(products?.sublabel).toBe('1 A · 3 B · 11 C');
  });

  it('includes quality warnings and never silently drops one', () => {
    const noisy = {
      ...data,
      quality: {
        ...data.quality,
        duplicate_row_count: 7,
        total_missing_cells: 42,
      },
      warnings: ['Sheet 2 was ignored'],
    } as AnalysisResponse;

    const quality = buildReportSections({
      sourceFileName: 'sales.csv',
      data: noisy,
      settings: settings(),
    }).find((section) => section.kind === 'quality');

    if (quality?.kind !== 'quality') throw new Error('expected a quality section');
    const text = quality.warnings.map((warning) => warning.text).join('\n');
    expect(text).toContain('7 duplicate rows');
    expect(text).toContain('42 missing cells');
    expect(text).toContain('Sheet 2 was ignored');
  });

  it('says so plainly when a clean file produced nothing to report', () => {
    // A file with nothing wrong and no type conversions: the report should say
    // so outright rather than printing an empty bullet list.
    const pristine = {
      ...data,
      quality: {
        ...data.quality,
        duplicate_row_count: 0,
        total_missing_cells: 0,
        description: '',
      },
      cleaning: { ...data.cleaning, conversions_performed: [] },
      warnings: [],
    } as AnalysisResponse;

    const quality = buildReportSections({
      sourceFileName: 'sales.csv',
      data: pristine,
      settings: settings(),
    }).find((section) => section.kind === 'quality');

    if (quality?.kind !== 'quality') throw new Error('expected a quality section');
    expect(quality.warnings).toHaveLength(1);
    expect(quality.warnings[0]?.text).toBe('No quality warnings detected.');
  });

  it('reports the type conversions the cleaning step performed', () => {
    // Conversions are part of what cleaning did, so they belong in the report
    // even when nothing went wrong.
    const quality = build().find((section) => section.kind === 'quality');
    if (quality?.kind !== 'quality') throw new Error('expected a quality section');
    const text = quality.warnings.map((warning) => warning.text).join('\n');
    expect(text).toContain('Parsed column');
  });

  it('lists the charts in reading order and marks the trend optional', () => {
    const charts = build().find((section) => section.kind === 'charts');
    if (charts?.kind !== 'charts') throw new Error('expected a charts section');

    expect(charts.charts.map((chart) => chart.id)).toEqual([
      'pareto',
      'topProducts',
      'abcPie',
      'abcBar',
      'histogram',
      'trend',
    ]);
    // Every chart carries a caption, because the report shows the title twice
    // and a bare chart with no explanation is unreadable out of context.
    for (const chart of charts.charts) {
      expect(chart.caption.length).toBeGreaterThan(0);
    }
    expect(charts.charts.find((c) => c.id === 'trend')?.present).toBe(true);
  });

  it('omits the trend chart when the file has no date column', () => {
    const noTrend = {
      ...data,
      charts: { ...data.charts, monthly_trend: [] },
    } as AnalysisResponse;

    const charts = buildReportSections({
      sourceFileName: 'sales.csv',
      data: noTrend,
      settings: settings(),
    }).find((section) => section.kind === 'charts');

    if (charts?.kind !== 'charts') throw new Error('expected a charts section');
    expect(charts.charts.find((c) => c.id === 'trend')?.present).toBe(false);
  });

  it('separates the most and least important lists, formatted for reading', () => {
    const lists = build().find((section) => section.kind === 'lists');
    if (lists?.kind !== 'lists') throw new Error('expected a lists section');

    expect(lists.mostImportant).toHaveLength(data.ranking.top_n.length);
    expect(lists.leastImportant).toHaveLength(data.ranking.bottom_n.length);
    expect(lists.mostImportant[0]?.product).toBe('MacBook Pro 16');
    expect(lists.mostImportant[0]?.value).toMatch(/808/);
    // Growth is carried through so the list is not just a second copy of the
    // ranking.
    expect(lists.mostImportant[0]?.changePct).toBe('+10.3%');
  });

  it('uses the on-screen rows when the table scope is the current view', () => {
    const filtered = data.ranking.items.slice(0, 3);
    const table = buildReportSections({
      sourceFileName: 'sales.csv',
      data,
      settings: settings({ tableScopeAll: false }),
      currentRankingRows: filtered,
      hasCurrentRankingRows: true,
    }).find((section) => section.kind === 'rankingTable');

    if (table?.kind !== 'rankingTable') throw new Error('expected a ranking table');
    expect(table.rows).toHaveLength(3);
    expect(table.totalRows).toBe(3);
    expect(table.scopeAll).toBe(false);
  });

  it('falls back to every row when the scope is all and no filter is active', () => {
    const table = build({ tableScopeAll: true }).find((s) => s.kind === 'rankingTable');
    if (table?.kind !== 'rankingTable') throw new Error('expected a ranking table');
    expect(table.rows).toHaveLength(data.ranking.items.length);
    expect(table.scopeAll).toBe(true);
  });

  it('does not report truncation; the PDF layer owns the 5,000-row cap', () => {
    const table = build({ tableScopeAll: true }).find((s) => s.kind === 'rankingTable');
    if (table?.kind !== 'rankingTable') throw new Error('expected a ranking table');
    // Capping here would drop rows before the user ever sees the note explaining
    // why, so the builder passes everything through untouched.
    expect(table.truncated).toBe(false);
    expect(table.rows.length).toBe(table.totalRows);
  });

  it('shows the class letter on every ranking row', () => {
    const table = build().find((s) => s.kind === 'rankingTable');
    if (table?.kind !== 'rankingTable') throw new Error('expected a ranking table');
    for (const row of table.rows) {
      expect(['A', 'B', 'C']).toContain(row.abcClass);
    }
  });

  it('treats an unexpected class letter as C rather than dropping the row', () => {
    const odd = {
      ...data,
      ranking: {
        ...data.ranking,
        items: [{ ...data.ranking.items[0], abc_class: 'z' }],
      },
    } as unknown as AnalysisResponse;

    const table = buildReportSections({
      sourceFileName: 'sales.csv',
      data: odd,
      settings: settings({ tableScopeAll: true }),
    }).find((section) => section.kind === 'rankingTable');

    if (table?.kind !== 'rankingTable') throw new Error('expected a ranking table');
    expect(table.rows[0]?.abcClass).toBe('C');
  });
});

describe('formatReportDateTime', () => {
  it('formats a local timestamp without shifting it through UTC', () => {
    // A local format, not toISOString: a report generated at 00:30 in IST should
    // not claim the previous day.
    expect(formatReportDateTime(new Date(2026, 9, 2, 0, 30, 5))).toBe('2026-10-02 00:30:05');
  });

  it('zero-pads every field', () => {
    expect(formatReportDateTime(new Date(2026, 0, 5, 7, 8, 9))).toBe('2026-01-05 07:08:09');
  });
});
