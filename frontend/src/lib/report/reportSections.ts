/**
 * Report section builder.
 *
 * Pure functions that transform `AnalysisResponse` + report settings into a
 * structured description of the full PDF report. No DOM, no jsPDF, no rendering
 * side effects — this is designed to be unit-tested in isolation.
 *
 * The order of sections matches the spec exactly:
 * cover → Pareto insight → 4 summary stats → quality+cleaning → settings used
 * → every chart → most/least lists → ranking table
 *
 * All user text (product names, titles) passes through unchanged here; the PDF
 * layer is responsible for text layout only.
 */

import type { AnalysisResponse, ProductRankItemResponse } from '@/lib/api';
import { formatNumber, formatPercent } from '@/lib/format';
import { asAbcClass, DOWNLOAD_COPY, type AbcClass } from '@/lib/constants';

/** Re-exported so report tests keep importing the class from the module they test. */
export type { AbcClass };

export interface ReportSettings {
  /** Include summary block (Pareto insight + 4 stats). */
  includeSummary: boolean;
  /** Include quality + cleaning section and all warnings. */
  includeQuality: boolean;
  /** Include settings used section. */
  includeSettings: boolean;
  /** Include all charts. */
  includeCharts: boolean;
  /** Include most important and least important lists. */
  includeLists: boolean;
  /** Include ranking table. */
  includeRankingTable: boolean;
  /** If true, ranking table uses all rows (unfiltered, unsorted). */
  tableScopeAll: boolean;
  /** Top N used for analysis. */
  topN: number;
  /** Column names. */
  productColumn: string;
  valueColumn: string;
  dateColumn?: string | null;
}

export interface CoverSection {
  kind: 'cover';
  title: string;
  subtitle: string;
  fileNameBase: string;
  generatedAt: Date;
  settings: ReportSettings;
}

export interface TextSection {
  kind: 'text';
  heading: string;
  body: string[];
}

export interface StatItem {
  label: string;
  value: string;
  sublabel?: string;
}

export interface StatsSection {
  kind: 'stats';
  heading: string;
  stats: StatItem[];
}

export interface QualityWarning {
  text: string;
  tone?: 'info' | 'warning' | 'error';
}

export interface QualitySection {
  kind: 'quality';
  heading: string;
  warnings: QualityWarning[];
  notes?: string[];
}

export interface SettingsSection {
  kind: 'settings';
  heading: string;
  items: Array<{ label: string; value: string }>;
}

export interface ChartMeta {
  id: 'pareto' | 'topProducts' | 'abcPie' | 'abcBar' | 'histogram' | 'trend';
  title: string;
  caption: string;
  /** True if this chart exists in the analysis. */
  present: boolean;
}

export interface ChartsSection {
  kind: 'charts';
  heading: string;
  charts: ChartMeta[];
}

export interface ListItemRow {
  rank: number;
  product: string;
  value: string;
  sharePct: string;
  changePct?: string;
  abcClass: AbcClass;
}

export interface ListsSection {
  kind: 'lists';
  heading: string;
  mostImportant: ListItemRow[];
  leastImportant: ListItemRow[];
}

export interface RankingTableColumn {
  header: string;
  /** For PDF layout hinting only (not enforced here). */
  key: string;
}

export interface RankingTableRow {
  rank: number;
  product: string;
  value: string;
  sharePct: string;
  cumulativePct: string;
  abcClass: AbcClass;
  growthPct?: string;
}

export interface RankingTableSection {
  kind: 'rankingTable';
  heading: string;
  caption: string;
  columns: RankingTableColumn[];
  rows: RankingTableRow[];
  totalRows: number;
  truncated: boolean;
  shownRows: number;
  scopeAll: boolean;
}

export type ReportSection =
  | CoverSection
  | TextSection
  | StatsSection
  | QualitySection
  | SettingsSection
  | ChartsSection
  | ListsSection
  | RankingTableSection;

export interface ReportSectionsOptions {
  /** Original upload filename (e.g. "sales_clean.csv"). */
  sourceFileName: string;
  /** Analysis result. */
  data: AnalysisResponse;
  /** Report settings chosen by the user. */
  settings: ReportSettings;
  /** Current filtered/sorted rows for table scope. */
  currentRankingRows?: ProductRankItemResponse[];
  /** If true, use currentRankingRows when tableScopeAll is false. */
  hasCurrentRankingRows?: boolean;
}

const RANKING_COLUMNS: RankingTableColumn[] = [
  { header: 'Rank', key: 'rank' },
  { header: 'Product', key: 'product' },
  { header: 'Value', key: 'value' },
  { header: 'Share %', key: 'sharePct' },
  { header: 'Cumulative %', key: 'cumulativePct' },
  { header: 'Class', key: 'abcClass' },
  { header: 'Growth %', key: 'growthPct' },
];

function fileNameBase(name: string): string {
  const lastDot = name.lastIndexOf('.');
  if (lastDot > 0) return name.slice(0, lastDot);
  return name;
}


function growthPctFor(product: string, data: AnalysisResponse): string | undefined {
  const items = data.growth?.items ?? [];
  const found = items.find((g) => g.product === product);
  if (!found) return undefined;
  const pct = Number(found.change_pct ?? 0);
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}

export function buildReportSections({
  sourceFileName,
  data,
  settings,
  currentRankingRows,
  hasCurrentRankingRows = false,
}: ReportSectionsOptions): ReportSection[] {
  const sections: ReportSection[] = [];
  const base = fileNameBase(sourceFileName);
  const generatedAt = new Date();

  // Cover
  sections.push({
    kind: 'cover',
    title: 'Datalens',
    subtitle: 'Analysis report',
    fileNameBase: base,
    generatedAt,
    settings,
  });

  // Pareto insight + 4 summary stats
  if (settings.includeSummary) {
    const paretoBody = data.ranking?.pareto_summary
      ? [data.ranking.pareto_summary]
      : ['Pareto analysis summary not available.'];
    sections.push({
      kind: 'text',
      heading: 'Pareto insight',
      body: paretoBody,
    });

    const rows = data.meta?.rows ?? 0;
    const columns = data.meta?.columns ?? 0;
    const totalValue = data.ranking?.total_value ?? 0;
    const products = data.ranking?.product_count ?? 0;
    const abc = data.ranking?.abc_summary;
    const a = abc?.class_a_count ?? 0;
    const b = abc?.class_b_count ?? 0;
    const c = abc?.class_c_count ?? 0;

    sections.push({
      kind: 'stats',
      heading: 'Summary',
      stats: [
        { label: 'Rows', value: rows.toLocaleString('en-US') },
        { label: 'Columns', value: columns.toLocaleString('en-US') },
        { label: 'Total value', value: formatNumber(totalValue) },
        {
          label: 'Products',
          value: products.toLocaleString('en-US'),
          sublabel: `${a} A · ${b} B · ${c} C`,
        },
      ],
    });
  }

  // Quality + cleaning
  if (settings.includeQuality) {
    const warnings: QualityWarning[] = [];

    // Cleaning conversions and issues
    const cleaning = data.cleaning;
    if (cleaning) {
      if (cleaning.rows_dropped > 0) {
        warnings.push({
          text: `${cleaning.rows_dropped.toLocaleString('en-US')} row${cleaning.rows_dropped === 1 ? '' : 's'} dropped during cleaning.`,
          tone: 'warning',
        });
      }
      if (cleaning.columns_dropped && cleaning.columns_dropped.length > 0) {
        warnings.push({
          text: `Columns dropped: ${cleaning.columns_dropped.join(', ')}`,
          tone: 'warning',
        });
      }
      if (cleaning.failed_numeric_conversions > 0) {
        warnings.push({
          text: `${cleaning.failed_numeric_conversions.toLocaleString('en-US')} value${cleaning.failed_numeric_conversions === 1 ? '' : 's'} failed numeric conversion.`,
          tone: 'warning',
        });
      }
      if (cleaning.failed_date_conversions > 0) {
        warnings.push({
          text: `${cleaning.failed_date_conversions.toLocaleString('en-US')} value${cleaning.failed_date_conversions === 1 ? '' : 's'} failed date conversion.`,
          tone: 'warning',
        });
      }
      if (cleaning.null_like_values_converted > 0) {
        warnings.push({
          text: `${cleaning.null_like_values_converted.toLocaleString('en-US')} null-like value${cleaning.null_like_values_converted === 1 ? '' : 's'} converted.`,
          tone: 'info',
        });
      }
      if (cleaning.conversions_performed && cleaning.conversions_performed.length > 0) {
        // Surface key conversions as info (not spammy; truncate if long)
        const conv = cleaning.conversions_performed.slice(0, 6);
        warnings.push({ text: `Conversions: ${conv.join('; ')}`, tone: 'info' });
      }
    }

    // Quality
    const quality = data.quality;
    if (quality) {
      if (quality.duplicate_row_count > 0) {
        warnings.push({
          text: `${quality.duplicate_row_count.toLocaleString('en-US')} duplicate row${quality.duplicate_row_count === 1 ? '' : 's'} found.`,
          tone: 'warning',
        });
      }
      if (quality.total_missing_cells > 0) {
        warnings.push({
          text: `${quality.total_missing_cells.toLocaleString('en-US')} missing cell${quality.total_missing_cells === 1 ? '' : 's'} total.`,
          tone: 'warning',
        });
      }
      if (quality.description) {
        warnings.push({ text: quality.description, tone: 'info' });
      }
    }

    // Top-level warnings array
    if (data.warnings && data.warnings.length > 0) {
      for (const w of data.warnings) {
        if (w && w.trim()) warnings.push({ text: w, tone: 'warning' });
      }
    }

    if (warnings.length === 0) {
      warnings.push({ text: 'No quality warnings detected.', tone: 'info' });
    }

    sections.push({
      kind: 'quality',
      heading: 'Quality & cleaning',
      warnings,
    });
  }

  // Settings used
  if (settings.includeSettings) {
    const items: Array<{ label: string; value: string }> = [
      { label: 'Product column', value: settings.productColumn || '—' },
      { label: 'Value column', value: settings.valueColumn || '—' },
      { label: 'Date column', value: settings.dateColumn || '—' },
      { label: 'Top N', value: String(settings.topN) },
    ];
    sections.push({
      kind: 'settings',
      heading: 'Settings used',
      items,
    });
  }

  // Charts
  if (settings.includeCharts) {
    const hasTrend = Array.isArray(data.charts?.monthly_trend) && data.charts.monthly_trend.length > 0;
    const charts: ChartMeta[] = [
      {
        id: 'pareto',
        title: 'Pareto curve',
        caption: 'Cumulative share of value by product rank',
        present: true,
      },
      {
        id: 'topProducts',
        title: 'Top products',
        caption: 'Top products by total value',
        present: true,
      },
      {
        id: 'abcPie',
        title: 'ABC classification (pie)',
        caption: 'Share of products and value by ABC class',
        present: true,
      },
      {
        id: 'abcBar',
        title: 'ABC classification (stacked bar)',
        caption: 'Value by ABC class',
        present: true,
      },
      {
        id: 'histogram',
        title: 'Value histogram',
        caption: 'Distribution of transaction values',
        present: true,
      },
      {
        id: 'trend',
        title: 'Monthly trend',
        caption: 'Total value by month',
        present: hasTrend,
      },
    ];
    sections.push({
      kind: 'charts',
      heading: 'Charts',
      charts,
    });
  }

  // Lists
  if (settings.includeLists) {
    const most: ListItemRow[] = (data.ranking?.top_n ?? []).map((item) => ({
      rank: item.rank,
      product: item.product,
      value: formatNumber(item.value),
      sharePct: formatPercent(item.share_pct),
      changePct: growthPctFor(item.product, data),
      abcClass: asAbcClass(item.abc_class),
    }));
    const least: ListItemRow[] = (data.ranking?.bottom_n ?? []).map((item) => ({
      rank: item.rank,
      product: item.product,
      value: formatNumber(item.value),
      sharePct: formatPercent(item.share_pct),
      changePct: growthPctFor(item.product, data),
      abcClass: asAbcClass(item.abc_class),
    }));
    sections.push({
      kind: 'lists',
      heading: 'Most & least important',
      mostImportant: most,
      leastImportant: least,
    });
  }

  // Ranking table
  if (settings.includeRankingTable) {
    let sourceRows: ProductRankItemResponse[] = [];
    if (settings.tableScopeAll) {
      sourceRows = [...(data.ranking?.items ?? [])];
    } else {
      if (hasCurrentRankingRows && currentRankingRows && currentRankingRows.length > 0) {
        sourceRows = [...currentRankingRows];
      } else {
        // Fallback: use all if no current view provided
        sourceRows = [...(data.ranking?.items ?? [])];
      }
    }

    const totalRows = sourceRows.length;
    const shown = sourceRows;
    const truncated = false; // truncation handled in PDF layer at 5000

    const rows: RankingTableRow[] = shown.map((item) => ({
      rank: item.rank,
      product: item.product,
      value: formatNumber(item.value),
      sharePct: formatPercent(item.share_pct),
      cumulativePct: formatPercent(item.cumulative_pct),
      abcClass: asAbcClass(item.abc_class),
      growthPct: growthPctFor(item.product, data),
    }));

    sections.push({
      kind: 'rankingTable',
      heading: DOWNLOAD_COPY.rankingTableLabel,
      caption: DOWNLOAD_COPY.rankingTableCaption,
      columns: RANKING_COLUMNS,
      rows,
      totalRows,
      truncated,
      shownRows: rows.length,
      scopeAll: settings.tableScopeAll,
    });
  }

  return sections;
}

export function formatReportDateTime(d: Date): string {
  // Simple local date/time like "2026-10-02 09:41:22"
  const pad = (n: number) => String(n).padStart(2, '0');
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());
  const seconds = pad(d.getSeconds());
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}
