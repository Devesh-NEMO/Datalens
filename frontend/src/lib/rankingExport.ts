/**
 * The ranking table's export furniture, shared between the dashboard table and
 * the Reports page so the two can never drift: one set of column widths, one
 * row mapper, one set of labels.
 */

import type { AnalysisResponse, ProductGrowthItemResponse } from '@/lib/api';
import type { TablePdfColumn } from '@/lib/exportPdf';
import { DOWNLOAD_COPY } from '@/lib/constants';
import { formatChangePercent, formatNumber, formatPercent } from '@/lib/format';
import type { TabularExport, TabularCell } from '@/lib/tabularExport';

/**
 * Column widths in PDF points. A4 portrait leaves 483pt between the margins,
 * and the product column takes whatever the fixed columns do not.
 */
export const RANKING_TABLE_COLUMNS: readonly TablePdfColumn[] = [
  { header: 'Rank', width: 34, align: 'right' },
  // No width: the product column absorbs whatever the fixed columns leave over.
  { header: 'Product' },
  { header: 'Value', width: 78, align: 'right' },
  { header: 'Share %', width: 56, align: 'right' },
  { header: 'Cumulative %', width: 68, align: 'right' },
  { header: 'Class', width: 38, align: 'center' },
  { header: 'Growth %', width: 62, align: 'right' },
];

/**
 * The full product ranking as export rows, growth column included.
 *
 * The dashboard table builds its own copy of this from its filtered, sorted
 * view; this one is the unfiltered dataset-level export the Reports page offers.
 */
export function rankingExportRows(data: AnalysisResponse): readonly (readonly TabularCell[])[] {
  const growthMap = new Map<string, ProductGrowthItemResponse>();
  if (data.growth.items) {
    for (const g of data.growth.items) growthMap.set(g.product, g);
  }
  return data.ranking.items.map((item) => {
    const g = growthMap.get(item.product);
    return [
      item.rank,
      item.product,
      formatNumber(item.value),
      formatPercent(item.share_pct),
      formatPercent(item.cumulative_pct),
      item.abc_class,
      g ? formatChangePercent(g.change_pct) : '',
    ];
  });
}

/** Descriptor for the dataset-level ranking export (all rows, no filtering). */
export function rankingTableDescriptor(
  data: AnalysisResponse,
  sourceFileName: string
): TabularExport {
  return {
    item: 'rankingTable',
    title: DOWNLOAD_COPY.rankingTableLabel,
    caption: DOWNLOAD_COPY.rankingTableCaption,
    sourceFileName,
    columns: RANKING_TABLE_COLUMNS,
    rows: rankingExportRows(data),
  };
}