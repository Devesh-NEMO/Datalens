/**
 * Dashboard metrics.
 *
 * Every number in the KPI row and the executive summary is computed here, from
 * the `/analyze` response only. Nothing is invented and nothing is fetched.
 *
 * Two conventions worth stating, because the backend does not distinguish them:
 *
 * - Duplicates come from `quality.duplicate_row_count`, which is a count of
 *   duplicate rows *found*. The cleaning report has no "removed" field, so the
 *   copy never claims rows were removed.
 * - The date range is month granularity, derived from the monthly trend. There
 *   is no min/max date in the response, so exact dates are never shown.
 */

import type { AnalysisResponse, MonthlyTrendItemResponse } from '@/lib/api';
import { formatDate, formatNumber, formatPercent } from '@/lib/format';
import { DASHBOARD_COPY, MAX_METRICS, MIN_METRICS, QUALITY_LEVELS } from '@/lib/constants';

export type MetricId =
  | 'totalValue'
  | 'productCount'
  | 'aClassShare'
  | 'averagePerProduct'
  | 'medianProductValue'
  | 'topProductShare'
  | 'qualityScore'
  | 'duplicatesFound'
  | 'rows';

export interface MetricDefinition {
  id: MetricId;
  label: string;
  /** Shown as the tooltip and in the customize dialog. */
  hint: string;
}

/**
 * Display order for the KPI row. Users reorder by choosing which of these to
 * show, so this list is the single source of both order and labelling.
 */
export const METRIC_DEFINITIONS: readonly MetricDefinition[] = [
  {
    id: 'totalValue',
    label: 'Total value',
    hint: 'Summed value across every product.',
  },
  {
    id: 'productCount',
    label: 'Products',
    hint: 'Distinct products found in the file.',
  },
  {
    id: 'aClassShare',
    label: 'Class A share',
    hint: 'Percentage of total value held by Class A products.',
  },
  {
    id: 'averagePerProduct',
    label: 'Average per product',
    hint: 'Total value divided by the number of products.',
  },
  {
    id: 'medianProductValue',
    label: 'Median product value',
    hint: 'Middle product value. Less distorted by outliers than the average.',
  },
  {
    id: 'topProductShare',
    label: 'Top product share',
    hint: 'Percentage of total value from the highest ranked product.',
  },
  {
    id: 'qualityScore',
    label: 'Quality score',
    hint: 'Completeness and duplicate check across the whole file.',
  },
  {
    id: 'duplicatesFound',
    label: 'Duplicate rows found',
    hint: 'Rows that repeat an earlier row exactly. Nothing is removed.',
  },
  { id: 'rows', label: 'Rows', hint: 'Rows read from the file.' },
] as const;

/** Shown before the user customizes anything. */
export const DEFAULT_METRIC_IDS: readonly MetricId[] = [
  'totalValue',
  'productCount',
  'aClassShare',
  'averagePerProduct',
  'qualityScore',
  'duplicatesFound',
];

export type StatusTone = 'positive' | 'neutral' | 'negative';

export interface MetricValue {
  id: MetricId;
  label: string;
  /** Compact form for the big number, e.g. "1.5M". */
  value: string;
  /** Exact value for the title attribute and screen readers. */
  full: string;
  /** Word beside the number, so tone is never carried by colour alone. */
  status?: string;
  statusTone?: StatusTone;
}

export function metricLabel(id: MetricId): string {
  return METRIC_DEFINITIONS.find((definition) => definition.id === id)?.label ?? id;
}

/** Exact number, for tooltips. Two decimals is enough and never noisy. */
function exact(value: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/**
 * Median of a list, or null when there is nothing to take a median of.
 *
 * Averaging the two middle values for an even-length list is the usual
 * convention and keeps the result a real product value rather than a midpoint
 * that exists in no row.
 */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const lower = sorted[middle - 1];
  const upper = sorted[middle];
  if (sorted.length % 2 === 1) return upper ?? null;
  if (lower === undefined || upper === undefined) return null;
  return (lower + upper) / 2;
}

/**
 * Quality level as a word plus a tone.
 *
 * The word is what makes the badge readable; the tone only reinforces it.
 * Thresholds come from QUALITY_LEVELS so the dashboard and the existing quality
 * panel cannot disagree about what "Good" means.
 */
export function qualityLevel(score: number): { label: string; tone: StatusTone } {
  const level = QUALITY_LEVELS.find((candidate) => score >= candidate.min);
  if (!level) return { label: DASHBOARD_COPY.qualityPoor, tone: 'negative' };
  const tone: StatusTone =
    score >= 90 ? 'positive' : score >= 50 ? 'neutral' : 'negative';
  return { label: level.label, tone };
}

export interface MonthRange {
  /** "2025-01" */
  from: string;
  /** "2025-12" */
  to: string;
  months: number;
  label: string;
}

/**
 * Month range covered by the data, from the monthly trend.
 *
 * Month granularity only. The response carries no min/max date, so this says
 * "Jan 2025 – Dec 2025" and never implies a day.
 */
export function deriveMonthRange(
  trend: readonly MonthlyTrendItemResponse[] | undefined
): MonthRange | null {
  if (!trend || trend.length === 0) return null;

  // Sort rather than trusting order: "2025-02" sorts correctly as a string, and
  // a response out of order should not produce a backwards range.
  const months = [...new Set(trend.map((point) => point.month))].sort((a, b) =>
    a.localeCompare(b)
  );
  const first = months[0];
  const last = months[months.length - 1];
  if (first === undefined || last === undefined) return null;

  return {
    from: first,
    to: last,
    months: months.length,
    label:
      first === last
        ? formatDate(first)
        : `${formatDate(first)} – ${formatDate(last)}`,
  };
}

export type MetricSet = Partial<Record<MetricId, MetricValue>>;

/**
 * Compute every metric the dashboard can show.
 *
 * A metric the data cannot support is simply absent from the result, rather
 * than present with a placeholder zero. The KPI row then shows fewer tiles
 * instead of lying about a number it does not have.
 */
export function computeMetrics(data: AnalysisResponse): MetricSet {
  const metrics: MetricSet = {};

  // The generated types mark these sections required, but the whole point of
  // data gating is that a field the backend did not send must leave the tile
  // out rather than take the page down. Optional chaining keeps a partial
  // response to a shorter KPI row instead of a blank screen.
  const ranking = data.ranking;
  const quality = data.quality;
  const meta = data.meta;

  if (ranking && Number.isFinite(ranking.total_value)) {
    metrics.totalValue = {
      id: 'totalValue',
      label: metricLabel('totalValue'),
      value: formatNumber(ranking.total_value),
      full: exact(ranking.total_value),
    };
  }

  if (ranking && ranking.product_count > 0) {
    metrics.productCount = {
      id: 'productCount',
      label: metricLabel('productCount'),
      value: formatNumber(ranking.product_count),
      full: exact(ranking.product_count),
    };

    // Guard the division: a file with products but zero total value would
    // otherwise put Infinity in the dashboard.
    const average = ranking.product_count
      ? ranking.total_value / ranking.product_count
      : null;
    if (average !== null && Number.isFinite(average)) {
      metrics.averagePerProduct = {
        id: 'averagePerProduct',
        label: metricLabel('averagePerProduct'),
        value: formatNumber(average),
        full: exact(average),
      };
    }
  }

  const aShare = ranking?.abc_summary?.class_a_share_pct;
  if (typeof aShare === 'number' && Number.isFinite(aShare)) {
    metrics.aClassShare = {
      id: 'aClassShare',
      label: metricLabel('aClassShare'),
      value: formatPercent(aShare),
      full: formatPercent(aShare),
    };
  }

  // Computed from the ranked products, not from `profile`: this is the median
  // product total, which is what the KPI row is about. The profile median
  // describes individual rows instead.
  const productValues = ranking?.items?.map((item) => item.value) ?? [];
  const productMedian = median(productValues);
  if (productMedian !== null) {
    metrics.medianProductValue = {
      id: 'medianProductValue',
      label: metricLabel('medianProductValue'),
      value: formatNumber(productMedian),
      full: exact(productMedian),
    };
  }

  const leader = ranking?.items?.[0];
  if (leader && Number.isFinite(leader.share_pct)) {
    metrics.topProductShare = {
      id: 'topProductShare',
      label: metricLabel('topProductShare'),
      value: formatPercent(leader.share_pct),
      full: formatPercent(leader.share_pct),
    };
  }

  if (quality && Number.isFinite(quality.score)) {
    const level = qualityLevel(quality.score);
    metrics.qualityScore = {
      id: 'qualityScore',
      label: metricLabel('qualityScore'),
      value: quality.score.toFixed(0),
      full: exact(quality.score),
      status: level.label,
      statusTone: level.tone,
    };
  }

  if (quality && Number.isFinite(quality.duplicate_row_count)) {
    metrics.duplicatesFound = {
      id: 'duplicatesFound',
      label: metricLabel('duplicatesFound'),
      value: formatNumber(quality.duplicate_row_count),
      full: exact(quality.duplicate_row_count),
    };
  }

  if (meta && Number.isFinite(meta.rows)) {
    metrics.rows = {
      id: 'rows',
      label: metricLabel('rows'),
      value: formatNumber(meta.rows),
      full: exact(meta.rows),
    };
  }

  return metrics;
}

/**
 * Resolve a requested selection against the metrics that actually exist.
 *
 * Keeps METRIC_DEFINITIONS order, drops anything unavailable, and repairs the
 * count so the row is never below MIN_METRICS or above MAX_METRICS — including
 * when a URL asks for a metric this file cannot produce.
 */
export function resolveMetricSelection(
  requested: readonly MetricId[],
  available: MetricSet
): MetricValue[] {
  const requestedSet = new Set(requested);

  const chosen = METRIC_DEFINITIONS.filter(
    (definition) =>
      requestedSet.has(definition.id) && available[definition.id] !== undefined
  )
    .slice(0, MAX_METRICS)
    .map((definition) => available[definition.id])
    .filter((value): value is MetricValue => value !== undefined);

  // Too few survived: top up from the default selection, then from anything
  // else available, so a file missing metrics still gets a readable row.
  if (chosen.length < MIN_METRICS) {
    const alreadyChosen = new Set(chosen.map((value) => value.id));
    const fillOrder = [
      ...DEFAULT_METRIC_IDS.filter((id) => !alreadyChosen.has(id)),
      ...METRIC_DEFINITIONS.map((definition) => definition.id).filter(
        (id) => !alreadyChosen.has(id) && !DEFAULT_METRIC_IDS.includes(id)
      ),
    ];

    for (const id of fillOrder) {
      if (chosen.length >= MIN_METRICS) break;
      const value = available[id];
      if (value && !alreadyChosen.has(id)) {
        chosen.push(value);
        alreadyChosen.add(id);
      }
    }
  }

  return chosen;
}

/** Clamp a user edit to the allowed size, used by the customize dialog. */
export function clampMetricCount(ids: readonly MetricId[]): MetricId[] {
  return ids.slice(0, MAX_METRICS);
}

export { MAX_METRICS, MIN_METRICS };