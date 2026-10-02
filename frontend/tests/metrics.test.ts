/**
 * Tests for the dashboard metric layer.
 *
 * Both sample files are exercised, because they are not interchangeable: the
 * clean file reports zero duplicates and a perfect score, so a suite that only
 * used it would never prove the duplicate wording or the "Fair"/"Poor" quality
 * tiers. The messy file carries duplicates, dropped rows and failed conversions.
 *
 * Every assertion here is about a number the backend actually returned, or about
 * a metric being *absent* when the data cannot support it. Nothing is faked.
 */
import { describe, it, expect } from 'vitest';
import cleanResponse from '../__fixtures__/analyze_sales_clean.json';
import messyResponse from '../__fixtures__/analyze_sales_messy.json';
import type { AnalysisResponse } from '@/lib/api';
import {
  clampMetricCount,
  computeMetrics,
  deriveMonthRange,
  median,
  MAX_METRICS,
  metricLabel,
  MIN_METRICS,
  qualityLevel,
  resolveMetricSelection,
  type MetricId,
} from '@/lib/metrics';

const clean = cleanResponse as unknown as AnalysisResponse;
const messy = messyResponse as unknown as AnalysisResponse;

/** A response with one field removed, for the "data is absent" paths. */
function without<K extends keyof AnalysisResponse>(
  data: AnalysisResponse,
  key: K
): AnalysisResponse {
  const copy = { ...data } as Record<string, unknown>;
  delete copy[key as string];
  return copy as AnalysisResponse;
}

describe('median', () => {
  it('returns the middle value of an odd-length list', () => {
    expect(median([5, 1, 3])).toBe(3);
  });

  it('averages the two middle values of an even-length list', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it('does not mutate the input', () => {
    const values = [5, 1, 3];
    median(values);
    expect(values).toEqual([5, 1, 3]);
  });

  it('handles negatives, which a negative-value file can produce', () => {
    expect(median([-10, -30, -20])).toBe(-20);
  });

  it('returns null for an empty list rather than NaN', () => {
    expect(median([])).toBeNull();
  });
});

describe('qualityLevel', () => {
  it('maps the backend thresholds to their labels', () => {
    expect(qualityLevel(100)).toEqual({ label: 'Excellent', tone: 'positive' });
    expect(qualityLevel(90)).toEqual({ label: 'Excellent', tone: 'positive' });
    expect(qualityLevel(80)).toEqual({ label: 'Good', tone: 'neutral' });
    expect(qualityLevel(60)).toEqual({ label: 'Fair', tone: 'neutral' });
    expect(qualityLevel(10)).toEqual({ label: 'Poor', tone: 'negative' });
  });

  it('always returns a word, so tone is never carried by colour alone', () => {
    for (const score of [0, 25, 50, 75, 90, 100]) {
      expect(qualityLevel(score).label.length).toBeGreaterThan(0);
    }
  });
});

describe('deriveMonthRange', () => {
  const trend = [
    { month: '2025-03', value: 3 },
    { month: '2025-01', value: 1 },
    { month: '2025-02', value: 2 },
  ];

  it('sorts out-of-order months instead of reporting a backwards range', () => {
    expect(deriveMonthRange(trend)?.label).toBe('Jan 2025 – Mar 2025');
  });

  it('counts distinct months', () => {
    expect(deriveMonthRange(trend)?.months).toBe(3);
  });

  it('collapses a single month to one label, not a duplicated range', () => {
    const single = deriveMonthRange([{ month: '2025-06', value: 1 }]);
    expect(single?.label).toBe('Jun 2025');
    expect(single?.months).toBe(1);
  });

  it('counts repeated months once', () => {
    expect(deriveMonthRange([{ month: '2025-01', value: 1 }, { month: '2025-01', value: 2 }])?.months).toBe(1);
  });

  it('returns null when there is no trend, so the line is omitted', () => {
    expect(deriveMonthRange([])).toBeNull();
    expect(deriveMonthRange(undefined)).toBeNull();
  });
});

describe('computeMetrics', () => {
  it('reports the total value compactly with the exact value alongside', () => {
    const metrics = computeMetrics(clean);
    expect(metrics.totalValue?.value).toBe('1.5M');
    expect(metrics.totalValue?.full).toBe('1,535,974');
  });

  it('computes the average per product as total divided by product count', () => {
    expect(clean.ranking.product_count).toBe(15);
    expect(computeMetrics(clean).averagePerProduct?.full).toBe('102,398.27');
  });

  it('uses the backend A-class share rather than recomputing it', () => {
    expect(computeMetrics(clean).aClassShare?.value).toBe('52.6%');
    expect(computeMetrics(messy).aClassShare?.value).toBe('52.4%');
  });

  it('computes the median from ranked product totals, not from profile rows', () => {
    // The profile median describes individual rows; this KPI is about products.
    expect(computeMetrics(clean).medianProductValue?.full).toBe('7,619.4');
    expect(computeMetrics(clean).medianProductValue?.value).toBe('7.6K');
  });

  it('reports the top product share from the ranked leader', () => {
    expect(clean.ranking.items[0]?.product).toBe('MacBook Pro 16');
    expect(computeMetrics(clean).topProductShare?.value).toBe('52.6%');
  });

  it('carries the quality score with a word as well as a tone', () => {
    const quality = computeMetrics(messy).qualityScore;
    expect(quality?.value).toBe('96');
    expect(quality?.status).toBe('Excellent');
    expect(quality?.statusTone).toBe('positive');
  });

  it('counts duplicate rows as found, on both sample files', () => {
    // The clean file is the case that proves the zero is still shown, and the
    // messy file is the case that proves a non-zero count is not called
    // "removed": cleaning.rows_dropped is 5 there, not 14.
    expect(clean.quality.duplicate_row_count).toBe(0);
    expect(computeMetrics(clean).duplicatesFound?.value).toBe('0');

    expect(messy.quality.duplicate_row_count).toBe(14);
    expect(messy.cleaning.rows_dropped).toBe(5);
    expect(computeMetrics(messy).duplicatesFound?.value).toBe('14');
  });

  it('uses the messy file row count, which differs from the clean one', () => {
    expect(computeMetrics(clean).rows?.value).toBe('600');
    expect(computeMetrics(messy).rows?.value).toBe('619');
  });

  it('never renders a metric as zero just because the data is missing', () => {
    const metrics = computeMetrics(without(clean, 'ranking'));
    expect(metrics.totalValue).toBeUndefined();
    expect(metrics.aClassShare).toBeUndefined();
    expect(metrics.topProductShare).toBeUndefined();
    expect(metrics.medianProductValue).toBeUndefined();
  });

  it('omits rather than divides by zero when there are no products', () => {
    const noProducts = {
      ...clean,
      ranking: { ...clean.ranking, product_count: 0, total_value: 0, items: [] },
    } as AnalysisResponse;
    const metrics = computeMetrics(noProducts);

    // Zero total value must not become an average of Infinity.
    expect(metrics.averagePerProduct).toBeUndefined();
    expect(metrics.medianProductValue).toBeUndefined();
    // A real zero total is still a real number, so it stays.
    expect(metrics.totalValue?.value).toBe('0');
  });

  it('gives every metric a human label that matches its definition', () => {
    const metrics = computeMetrics(messy);
    for (const [id, metric] of Object.entries(metrics)) {
      if (!metric) continue;
      expect(metric.label).toBe(metricLabel(id as MetricId));
      expect(metric.label.length).toBeGreaterThan(0);
      expect(metric.full.length).toBeGreaterThan(0);
    }
  });
});

describe('resolveMetricSelection', () => {
  const available = computeMetrics(messy);

  it('keeps the order from the definitions, not the order requested', () => {
    const resolved = resolveMetricSelection(
      ['rows', 'productCount', 'totalValue'],
      available
    );
    expect(resolved.map((metric) => metric.id)).toEqual([
      'totalValue',
      'productCount',
      'rows',
    ]);
  });

  it('drops a metric the file cannot produce', () => {
    const resolved = resolveMetricSelection(
      ['totalValue', 'medianProductValue', 'aClassShare'],
      available
    );
    // All three exist here; removing one proves the filter is real.
    expect(resolved).toHaveLength(3);

    const withoutMedian = { ...available, medianProductValue: undefined };
    const filtered = resolveMetricSelection(
      ['totalValue', 'medianProductValue', 'aClassShare'],
      withoutMedian
    );
    expect(filtered.map((metric) => metric.id)).not.toContain('medianProductValue');
  });

  it('never shows more than six figures', () => {
    const allIds: MetricId[] = [
      'totalValue',
      'productCount',
      'aClassShare',
      'averagePerProduct',
      'medianProductValue',
      'topProductShare',
      'qualityScore',
      'duplicatesFound',
      'rows',
    ];
    expect(resolveMetricSelection(allIds, available)).toHaveLength(MAX_METRICS);
  });

  it('tops a short selection back up to three so the row stays scannable', () => {
    const resolved = resolveMetricSelection(['totalValue'], available);
    expect(resolved.length).toBeGreaterThanOrEqual(MIN_METRICS);
    // The requested figure is kept; the rest are filled from the defaults.
    expect(resolved[0]?.id).toBe('totalValue');
  });

  it('still returns three figures when the file can only produce three', () => {
    const sparse = {
      totalValue: available.totalValue,
      productCount: available.productCount,
      rows: available.rows,
    } as typeof available;
    expect(resolveMetricSelection(['totalValue'], sparse)).toHaveLength(3);
  });

  it('never returns a duplicate', () => {
    const resolved = resolveMetricSelection(
      ['totalValue', 'totalValue', 'productCount'],
      available
    );
    const ids = resolved.map((metric) => metric.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('clampMetricCount', () => {
  it('trims a list down to the maximum', () => {
    const ids: MetricId[] = [
      'totalValue',
      'productCount',
      'aClassShare',
      'averagePerProduct',
      'medianProductValue',
      'topProductShare',
      'qualityScore',
    ];
    expect(clampMetricCount(ids)).toHaveLength(MAX_METRICS);
  });

  it('leaves a list at or under the maximum alone', () => {
    expect(clampMetricCount(['totalValue'])).toHaveLength(1);
    expect(
      clampMetricCount(['totalValue', 'productCount', 'aClassShare', 'rows'])
    ).toHaveLength(4);
  });
});
