import { describe, expect, it } from 'vitest';
import { generateInsights, MAX_INSIGHTS, TARGET_MIN_INSIGHTS } from '@/lib/insights';
import { CHAPTER_IDS, CHAPTER_TITLES, type ChapterId } from '@/lib/constants';
import type { AnalysisResponse } from '@/lib/api';

import clean from '../__fixtures__/analyze_sales_clean.json';
import messy from '../__fixtures__/analyze_sales_messy.json';

type AnyRecord = Record<string, unknown>;

/** A mutable deep copy, so one test's edit cannot leak into the next. */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function asData(value: unknown): AnalysisResponse {
  return value as AnalysisResponse;
}

const CLEAN = asData(clean);

type GrowthItem = NonNullable<NonNullable<AnalysisResponse['growth']>['items']>[number];

/** Growth items of a response, asserted present for tests that require them. */
function growthItems(data: AnalysisResponse): GrowthItem[] {
  const items = data.growth?.items;
  if (!items) throw new Error('fixture changed: growth items missing');
  return items;
}

const MESSY = asData(messy);

/** Find an insight by its stable id. */
function byId(data: AnalysisResponse, id: string) {
  return generateInsights(data).find((insight) => insight.id === id);
}

/** The text of an insight, or undefined when it was not emitted. */
function textOf(data: AnalysisResponse, id: string): string | undefined {
  return byId(data, id)?.text;
}

describe('generateInsights — real sample files', () => {
  it('emits findings within the documented range for both sample files', () => {
    for (const data of [CLEAN, MESSY]) {
      const insights = generateInsights(data);
      expect(insights.length).toBeGreaterThanOrEqual(TARGET_MIN_INSIGHTS);
      expect(insights.length).toBeLessThanOrEqual(MAX_INSIGHTS);
    }
  });

  it('gives every insight a unique id and a chapter that exists', () => {
    for (const data of [CLEAN, MESSY]) {
      const insights = generateInsights(data);
      expect(new Set(insights.map((i) => i.id)).size).toBe(insights.length);
      for (const insight of insights) {
        expect(CHAPTER_TITLES[insight.targetChapterId]).toBeTruthy();
      }
    }
  });

  it('orders the findings so the most decision-relevant come first', () => {
    // The month-on-month direction and the biggest mover lead, because neither is
    // mentioned by the Pareto headline and both change what a reader does next.
    const ids = generateInsights(MESSY).map((i) => i.id);
    expect(ids.indexOf('trend-change')).toBeLessThan(ids.indexOf('value-mover'));
    expect(ids.indexOf('value-mover')).toBeLessThan(ids.indexOf('duplicates-found'));
  });

  it('never emits a chapter id that is not on the page', () => {
    const ids = Object.values(CHAPTER_IDS) as ChapterId[];
    for (const data of [CLEAN, MESSY]) {
      for (const insight of generateInsights(data)) {
        expect(ids).toContain(insight.targetChapterId);
      }
    }
  });
});

describe('generateInsights — numbers are real and correctly rounded', () => {
  it('states the month-on-month change from the last two trend months', () => {
    // Dec 111,690.15 vs Nov 117,337.65 = -4.81%.
    expect(textOf(CLEAN, 'trend-change')).toBe('Dec 2025 was 4.8% below Nov 2025.');
    // Dec 98,602.2 vs Nov 110,204.4 = -10.53%.
    expect(textOf(MESSY, 'trend-change')).toBe('Dec 2025 was 10.5% below Nov 2025.');
  });

  it('names the largest mover by absolute value, not the largest percentage', () => {
    // Smart Speaker leads on percentage at +350%, but that is 311 against 1.5M.
    // Dell XPS 15 at -47.6% is an 18,705 drop, so it is the finding.
    expect(textOf(CLEAN, 'value-mover')).toBe(
      'Dell XPS 15 moved -47.6% in Dec 2025, the largest change by value in the file.'
    );
  });

  it('signs a positive mover explicitly', () => {
    const data = clone(MESSY);
    // Make one product the largest mover by a wide, material margin.
    const item = growthItems(data).find((i) => i.product === 'MacBook Pro 16');
    if (!item) throw new Error('fixture changed: MacBook Pro 16 missing');
    item.previous_value = 100_000;
    item.latest_value = 150_000;
    item.change_pct = 50;
    item.direction = 'rising';
    expect(textOf(data, 'value-mover')).toContain('moved +50.0% in Dec 2025');
  });

  it('reads the class A count and share from the response', () => {
    expect(textOf(CLEAN, 'class-a-thin')).toBe(
      'Class A is 1 product holding 52.6% of the value.'
    );
    expect(textOf(MESSY, 'class-a-thin')).toBe(
      'Class A is 1 product holding 52.4% of the value.'
    );
  });

  it('compares the tail against the leader, using the leader share not the class A share', () => {
    // 11 Class C products at 6.02%, against the top product at 52.64%.
    expect(textOf(CLEAN, 'long-tail-vs-leader')).toBe(
      'The 11 Class C products together hold 6.0% of the value — less than MacBook Pro 16 alone (52.6%).'
    );
  });

  it('rounds the row concentration against meta.rows, and says rows', () => {
    // 441 of 600 rows = 73.5%.
    expect(textOf(CLEAN, 'row-concentration')).toBe(
      '441 of 600 rows (73.5%) sit in the lowest value band.'
    );
    // The word "rows" matters: the histogram counts rows, not products.
    expect(textOf(CLEAN, 'row-concentration')).not.toContain('products');
  });

  it('reports data problems with the counts the response carries', () => {
    expect(textOf(MESSY, 'duplicates-found')).toBe('14 duplicate rows were found.');
    expect(textOf(MESSY, 'rows-dropped')).toBe('5 completely empty rows were dropped.');
  });
});

describe('generateInsights — nothing trivial is claimed', () => {
  it('omits the clean file findings that would only ever say zero', () => {
    // sales_clean.csv has 0 duplicates, 0 missing cells, 0 rows dropped.
    const ids = generateInsights(CLEAN).map((i) => i.id);
    expect(ids).not.toContain('duplicates-found');
    expect(ids).not.toContain('missing-cells');
    expect(ids).not.toContain('rows-dropped');

    // Belt and braces: no sentence may contain a bare zero as its subject count.
    const cleanText = generateInsights(CLEAN)
      .map((i) => i.text)
      .join(' ');
    expect(cleanText).not.toMatch(/\b0 (duplicate|cells|rows|completely)/);
  });

  it('keeps the messy file findings the clean file does not get', () => {
    const messyIds = generateInsights(MESSY).map((i) => i.id);
    expect(messyIds).toContain('duplicates-found');
    expect(messyIds).toContain('rows-dropped');
  });

  it('says "duplicate rows were found", never "removed"', () => {
    // There is no removed-vs-found distinction in the response, so claiming rows
    // were removed would be asserting something the data cannot support.
    const text = textOf(MESSY, 'duplicates-found') ?? '';
    expect(text).toContain('were found');
    expect(text).not.toContain('removed');
  });

  it('skips a month-on-month change too small to be a finding', () => {
    const data = clone(CLEAN);
    const trend = data.charts.monthly_trend;
    trend[trend.length - 1].value = trend[trend.length - 2].value * 1.004;
    expect(textOf(data, 'trend-change')).toBeUndefined();
  });

  it('skips a mover whose change is immaterial against total value', () => {
    const data = clone(CLEAN);
    // Rebuild growth so the only mover is a trivial +350% on a tiny base.
    const growth = data.growth;
    if (!growth) throw new Error('fixture changed: growth missing');
    growth.items = [
      {
        product: 'Widget',
        previous_period: '2025-11',
        latest_period: '2025-12',
        previous_value: 89,
        latest_value: 400.5,
        change_pct: 350,
        direction: 'rising',
      },
    ];
    expect(textOf(data, 'value-mover')).toBeUndefined();
  });

  it('skips a class A that is not thin', () => {
    const data = clone(CLEAN);
    data.ranking.abc_summary.class_a_count = 4;
    expect(textOf(data, 'class-a-thin')).toBeUndefined();
  });

  it('skips a row distribution that is not lopsided', () => {
    const data = clone(CLEAN);
    // Spread the counts so the lowest bucket is no longer dominant.
    const rows = data.meta.rows;
    const buckets = data.charts.value_histogram;
    buckets.forEach((bucket, i) => {
      bucket.count = i === 0 ? Math.round(rows * 0.2) : Math.round((rows * 0.8) / (buckets.length - 1));
    });
    expect(textOf(data, 'row-concentration')).toBeUndefined();
  });
});

describe('generateInsights — contradictory data suppresses the claim', () => {
  it('drops every ABC finding when the class shares do not add to 100', () => {
    const data = clone(CLEAN);
    data.ranking.abc_summary.class_c_share_pct = 90;
    const ids = generateInsights(data).map((i) => i.id);
    expect(ids).not.toContain('class-a-thin');
    expect(ids).not.toContain('long-tail-vs-leader');
  });

  it('drops the tail comparison when the tail is not actually smaller than the leader', () => {
    const data = clone(CLEAN);
    // Shares still sum to 100, so this is not an arithmetic error — it is a real
    // file where the tail outweighs the leader, and the sentence would be false.
    data.ranking.abc_summary.class_a_share_pct = 5;
    data.ranking.abc_summary.class_b_share_pct = 5;
    data.ranking.abc_summary.class_c_share_pct = 90;
    expect(textOf(data, 'long-tail-vs-leader')).toBeUndefined();
  });

  it('ignores a growth item whose direction disagrees with its own numbers', () => {
    const data = clone(CLEAN);
    const item = growthItems(data).find((i) => i.product === 'Dell XPS 15');
    if (!item) throw new Error('fixture changed: Dell XPS 15 missing');
    // Labelled falling while the numbers say it rose, and the change is material
    // — exactly the shape that would produce a confident false sentence.
    item.direction = 'falling';
    item.latest_value = item.previous_value * 2;

    // No mover at all is the right outcome here: Dell XPS was the only item above
    // the materiality threshold, so withholding it leaves the finding unemitted
    // rather than promoting a product that never led.
    expect(textOf(data, 'value-mover')).toBeUndefined();
  });

  it('falls back to the next material mover when the leader is self-contradictory', () => {
    const data = clone(CLEAN);
    const item = growthItems(data).find((i) => i.product === 'Dell XPS 15');
    if (!item) throw new Error('fixture changed: Dell XPS 15 missing');
    item.direction = 'falling';
    item.latest_value = item.previous_value * 2;

    // Give MacBook a clearly material rise so it becomes the largest survivor.
    const top = growthItems(data).find((i) => i.product === 'MacBook Pro 16');
    if (!top) throw new Error('fixture changed: MacBook Pro 16 missing');
    top.previous_value = 100_000;
    top.latest_value = 140_000;
    top.change_pct = 40;
    top.direction = 'rising';

    expect(textOf(data, 'value-mover')).toBe(
      'MacBook Pro 16 moved +40.0% in Dec 2025, the largest change by value in the file.'
    );
  });

  it('skips the row concentration when the histogram does not match the row count', () => {
    const data = clone(CLEAN);
    data.charts.value_histogram[3].count += 5_000;
    expect(textOf(data, 'row-concentration')).toBeUndefined();
  });

  it('returns an empty list rather than throwing on a gutted response', () => {
    const data = clone(CLEAN);
    (data as AnyRecord).ranking = null;
    (data as AnyRecord).charts = null;
    (data as AnyRecord).quality = null;
    (data as AnyRecord).cleaning = null;
    (data as AnyRecord).growth = null;
    (data as AnyRecord).meta = null;
    expect(generateInsights(data)).toEqual([]);
  });

  it('survives a response whose fields hold the wrong types', () => {
    const data = clone(CLEAN);
    (data as AnyRecord).quality = { duplicate_row_count: 'lots', total_missing_cells: null };
    (data as AnyRecord).charts = { monthly_trend: 'nope', value_histogram: undefined };
    const insights = generateInsights(data);
    expect(insights.every((i) => typeof i.text === 'string' && i.text.length > 0)).toBe(true);
    expect(insights.map((i) => i.id)).not.toContain('duplicates-found');
  });

  it('points a date finding at a chapter that is absent when there are no dates', () => {
    const data = clone(CLEAN);
    data.charts.monthly_trend = [];
    const ids = generateInsights(data).map((i) => i.id);
    // "Over time" is not rendered for a file with no dates, so no finding may
    // point at it.
    expect(ids).not.toContain('trend-change');
    expect(ids).not.toContain('value-mover');
    for (const id of ids) {
      const insight = byId(data, id);
      expect(insight?.targetChapterId).not.toBe(CHAPTER_IDS.time);
    }
  });
});

describe('generateInsights — missing optional sections', () => {
  it('skips the month comparison when there is only one month', () => {
    const data = clone(CLEAN);
    data.charts.monthly_trend = [data.charts.monthly_trend[0]];
    expect(textOf(data, 'trend-change')).toBeUndefined();
  });

  it('skips the month comparison when either month is zero', () => {
    const data = clone(CLEAN);
    const trend = data.charts.monthly_trend;
    trend[trend.length - 2].value = 0;
    expect(textOf(data, 'trend-change')).toBeUndefined();
  });

  it('skips the mover when the file has no growth data', () => {
    const data = clone(CLEAN);
    data.growth.has_growth_data = false;
    expect(textOf(data, 'value-mover')).toBeUndefined();
  });

  it('sorts the trend months itself rather than trusting their order', () => {
    const data = clone(CLEAN);
    const trend = [...data.charts.monthly_trend].reverse();
    data.charts.monthly_trend = trend;
    expect(textOf(data, 'trend-change')).toBe('Dec 2025 was 4.8% below Nov 2025.');
  });

  it('skips the tail comparison when the file has fewer than three class C products', () => {
    const data = clone(CLEAN);
    data.ranking.abc_summary.class_c_count = 2;
    expect(textOf(data, 'long-tail-vs-leader')).toBeUndefined();
  });
});