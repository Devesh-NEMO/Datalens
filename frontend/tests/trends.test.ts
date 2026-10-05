import { describe, expect, it } from 'vitest';
import {
  comparisonLabel,
  productTrend,
  totalValueTrend,
  trendMapByProduct,
  TREND_GLYPH,
} from '@/lib/trends';
import type { AnalysisResponse, ProductGrowthItemResponse } from '@/lib/api';

import cleanResponse from '../__fixtures__/analyze_sales_clean.json';
import messyResponse from '../__fixtures__/analyze_sales_messy.json';

type AnyRecord = Record<string, unknown>;

const clean = cleanResponse as unknown as AnalysisResponse;
const messy = messyResponse as unknown as AnalysisResponse;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

type GrowthItem = NonNullable<NonNullable<AnalysisResponse['growth']>['items']>[number];

/** Growth items of a response, asserted present for tests that require them. */
function itemsOf(data: AnalysisResponse): GrowthItem[] {
  const items = data.growth?.items;
  if (!items) throw new Error('fixture changed: growth items missing');
  return items;
}

function growthItem(overrides: Partial<GrowthItem>): GrowthItem {
  return {
    product: 'Widget',
    previous_period: '2025-11',
    latest_period: '2025-12',
    previous_value: 1000,
    latest_value: 1000,
    change_pct: 0,
    direction: 'flat',
    ...overrides,
  };
}

describe('productTrend — direction follows the numbers', () => {
  it('reads a rise as up, with its own comparison', () => {
    const trend = productTrend(
      growthItem({ change_pct: 10.29, direction: 'rising', latest_value: 1100 })
    );
    expect(trend).not.toBeNull();
    expect(trend?.direction).toBe('up');
    expect(trend?.displayPct).toBe('+10.3%');
    // The period the change is measured against, not the period it happened in.
    expect(trend?.comparison).toBe('Dec 2025');
    expect(trend?.srText).toBe('rose 10.3% versus Dec 2025');
  });

  it('reads a fall as down and drops the sign from the spoken wording', () => {
    const trend = productTrend(
      growthItem({ change_pct: -47.58, direction: 'falling', latest_value: 500 })
    );
    expect(trend?.direction).toBe('down');
    expect(trend?.displayPct).toBe('-47.6%');
    // "fell -47.6%" would be a double negative.
    expect(trend?.srText).toBe('fell 47.6% versus Dec 2025');
  });

  it('renders a genuine flat product as no change', () => {
    const trend = productTrend(growthItem({ change_pct: 0, direction: 'flat' }));
    expect(trend?.direction).toBe('flat');
    expect(trend?.displayPct).toBe('no change');
    // No percentage: "unchanged 0.0%" reads like a measurement rather than an absence.
    expect(trend?.srText).toBe('was unchanged versus Dec 2025');
  });

  it('uses the class colours rather than a rising/falling hue', () => {
    // The tones are applied in TrendBadge; the glyphs are what carries direction
    // when colour cannot be seen.
    expect(TREND_GLYPH.up).toBe('▲');
    expect(TREND_GLYPH.down).toBe('▼');
    expect(TREND_GLYPH.flat).toBe('■');
  });

  it('shows every product in both samples that has real growth data', () => {
    for (const data of [clean, messy]) {
      const trends = trendMapByProduct(data);
      expect(trends.size).toBeGreaterThan(5);
      for (const [product, trend] of trends) {
        expect(product).toBeTruthy();
        expect(trend.srText).toContain('versus');
      }
    }
  });

  it('shows a real -100% as a full fall, not as rounding noise', () => {
    // Mechanical Keyboard went 565.25 -> 0, so the product recorded no value in
    // the latest month. That is a genuine drop to zero, not a rounding artifact,
    // and it gets a full arrow like any other fall.
    const trend = trendMapByProduct(clean).get('Mechanical Keyboard');
    expect(trend?.direction).toBe('down');
    expect(trend?.displayPct).toBe('-100.0%');
  });

  it('shows a product with no value in either month as unchanged', () => {
    // Desk Pad, Webcam HD and Wireless Mouse are 0 -> 0: labelled flat with a zero
    // percentage, which agrees, so they are kept.
    const trends = trendMapByProduct(clean);
    expect(trends.get('Desk Pad')?.displayPct).toBe('no change');
  });
});

describe('productTrend — withholds anything it cannot vouch for', () => {
  it('returns null when the label and the percentage disagree', () => {
    // Labelled rising while the numbers say it fell. Either field could be wrong,
    // so neither is used.
    expect(
      productTrend(growthItem({ change_pct: -20, direction: 'rising', latest_value: 800 }))
    ).toBeNull();
    expect(
      productTrend(growthItem({ change_pct: 20, direction: 'falling', latest_value: 1200 }))
    ).toBeNull();
  });

  it('returns null when a percentage is labelled flat but is not', () => {
    // "no change" next to "+8.0%" would be a contradiction on screen.
    expect(
      productTrend(growthItem({ change_pct: 8, direction: 'flat', latest_value: 1080 }))
    ).toBeNull();
  });

  it('returns null for a change too small to be worth a badge', () => {
    expect(
      productTrend(growthItem({ change_pct: 0.001, direction: 'rising', latest_value: 1000.01 }))
    ).toBeNull();
  });

  it('returns null for a non-numeric percentage', () => {
    expect(
      productTrend(
        growthItem({ change_pct: Number.NaN, direction: 'rising' }) as ProductGrowthItemResponse
      )
    ).toBeNull();
  });

  it('returns null with no record at all', () => {
    expect(productTrend(undefined)).toBeNull();
    expect(productTrend(null)).toBeNull();
  });

  it('returns null with no comparison period to name', () => {
    expect(
      productTrend(
        growthItem({ latest_period: '', change_pct: 10, direction: 'rising' })
      )
    ).toBeNull();
  });
});

describe('totalValueTrend', () => {
  it('sums the growth items and names both periods', () => {
    // Dec 111,690.15 vs Nov 117,337.65 = -4.81%.
    const trend = totalValueTrend(clean);
    expect(trend?.direction).toBe('down');
    expect(trend?.displayPct).toBe('-4.8%');
    expect(trend?.comparison).toBe('Nov 2025');
    expect(trend?.srText).toBe('fell 4.8% versus Nov 2025');
  });

  it('agrees with the monthly trend it is meant to describe', () => {
    // The badge and the chart must not disagree. Built from growth items rather
    // than monthly_trend so the per-product badges share the same two periods.
    const trend = totalValueTrend(messy);
    const dec = messy.charts.monthly_trend.find((m) => m.month === '2025-12');
    const nov = messy.charts.monthly_trend.find((m) => m.month === '2025-11');
    if (!dec || !nov) throw new Error('fixture changed: trend months missing');
    const expected = ((dec.value - nov.value) / nov.value) * 100;
    expect(trend?.displayPct).toBe(`${expected.toFixed(1)}%`);
  });

  it('reads a rise as up', () => {
    const data = clone(clean);
    data.growth.items = itemsOf(data).map((item) => ({
      ...item,
      previous_value: 1000,
      latest_value: 1100,
      change_pct: 10,
      direction: 'rising',
    }));
    expect(totalValueTrend(data)?.direction).toBe('up');
  });

  it('refuses to call a partial list a total', () => {
    const data = clone(clean);
    // Growth covers fewer products than the file has. Summing it would report
    // "total value" while measuring part of it.
    data.growth.items = itemsOf(data).slice(0, 5);
    expect(totalValueTrend(data)).toBeNull();
  });

  it('returns null when growth is flagged unavailable', () => {
    const data = clone(clean);
    data.growth.has_growth_data = false;
    expect(totalValueTrend(data)).toBeNull();
  });

  it('returns null when a previous period is zero, since the base would divide by zero', () => {
    const data = clone(clean);
    data.growth.items = itemsOf(data).map((item) => ({ ...item, previous_value: 0 }));
    expect(totalValueTrend(data)).toBeNull();
  });

  it('returns null rather than shrinking the total when one value is unusable', () => {
    const data = clone(clean);
    const items = data.growth.items as unknown as AnyRecord[];
    items[0].latest_value = 'many';
    expect(totalValueTrend(data)).toBeNull();
  });

  it('returns null when there are no growth items', () => {
    const data = clone(clean);
    data.growth.items = [];
    expect(totalValueTrend(data)).toBeNull();
  });

  it('returns null when a period name is missing', () => {
    const data = clone(clean);
    data.growth.previous_period = '';
    expect(totalValueTrend(data)).toBeNull();
  });

  it('survives a response with no growth block', () => {
    const data = clone(clean);
    (data as AnyRecord).growth = null;
    expect(totalValueTrend(data)).toBeNull();
  });
});

describe('comparisonLabel', () => {
  it('names the pair of periods', () => {
    expect(comparisonLabel(clean)).toBe('Dec 2025 vs Nov 2025');
    expect(comparisonLabel(messy)).toBe('Dec 2025 vs Nov 2025');
  });

  it('returns null when there is nothing to compare', () => {
    const data = clone(clean);
    data.growth.has_growth_data = false;
    expect(comparisonLabel(data)).toBeNull();

    const noPeriod = clone(clean);
    noPeriod.growth.latest_period = '';
    expect(comparisonLabel(noPeriod)).toBeNull();
  });
});

describe('nothing is claimed about data quality', () => {
  it('has no quality trend of any kind', () => {
    // There is no before/after quality measurement in the response, so no arrow
    // may appear beside a quality figure.
    for (const data of [clean, messy]) {
      expect(trendMapByProduct(data).size).toBeGreaterThan(0);
      const qualityTrend = (data.quality as unknown as AnyRecord).trend;
      expect(qualityTrend).toBeUndefined();
    }
  });
});