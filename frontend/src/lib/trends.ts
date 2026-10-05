/**
 * Trend indicators.
 *
 * A direction of travel is only worth showing when the data actually says which
 * way, and only when the reader can tell what it is being compared against. Both
 * rules are enforced here rather than in the components, so every place that
 * shows a badge gets the same guarantees.
 *
 * What this module refuses to do:
 *
 * - **Invent a comparison.** Every indicator names the two periods it compares.
 *   A bare "+10.3%" invites the reader to assume a comparison that may not exist.
 * - **Trust a direction label over its own numbers.** The backend sends both a
 *   `direction` and a signed `change_pct`. When they disagree, neither can be
 *   relied on, so the indicator is withheld instead of picking a winner.
 * - **Sum a partial list.** The total-value trend adds up the growth items, which
 *   only means "total value" if growth covers every product. The coverage is
 *   checked against `ranking.product_count` first.
 * - **Say anything about data quality moving.** No such field exists, so there is
 *   no quality arrow anywhere in this module.
 *
 * Pure, so the whole rule set is unit-testable without a DOM.
 */

import type { AnalysisResponse, ProductGrowthItemResponse } from '@/lib/api';
import { TREND_COPY } from '@/lib/constants';
import { formatChangePercent, formatDate, formatPercent } from '@/lib/format';

export type TrendDirection = 'up' | 'down' | 'flat';

export interface Trend {
  direction: TrendDirection;
  /** Signed, so `-10.5` is a fall. Zero for a flat trend. */
  changePct: number;
  /** The signed percentage as shown to the eye, e.g. `-10.5%`. */
  displayPct: string;
  /** What the change is measured against, e.g. `Nov 2025`. */
  comparison: string;
  /** Spoken form, carrying the direction and the comparison in words. */
  srText: string;
}

/** Below this a change rounds away or is too small to be worth a badge. */
const MIN_MEANINGFUL_CHANGE_PCT = 0.05;

/** Arrow marks. Chosen over icons because they read as data, not as chrome. */
export const TREND_GLYPH: Record<TrendDirection, string> = {
  up: '▲',
  down: '▼',
  flat: '■',
};

/** Resolve the direction from the sign of the change, ignoring the label. */
function directionFrom(changePct: number): TrendDirection {
  if (changePct > 0) return 'up';
  if (changePct < 0) return 'down';
  return 'flat';
}

/**
 * The response's own vocabulary, translated to ours.
 *
 * The backend says rising/falling/flat; the UI says up/down/flat. Comparing the
 * two strings directly would reject every item as a mismatch, so the mapping has
 * to happen before the agreement check.
 */
const STATED: Record<ProductGrowthItemResponse['direction'], TrendDirection> = {
  rising: 'up',
  falling: 'down',
  flat: 'flat',
};

/**
 * A `change_pct` worth showing, or null.
 *
 * Exactly zero is kept: it is a real answer ("no change") and the product is
 * labelled flat, so the reader is told something true. Anything merely *near*
 * zero is dropped, because a badge reading "+0.04%" says less than its own noise.
 */
function usableChange(changePct: number | undefined | null): number | null {
  if (typeof changePct !== 'number' || !Number.isFinite(changePct)) return null;
  if (changePct !== 0 && Math.abs(changePct) < MIN_MEANINGFUL_CHANGE_PCT) return null;
  return changePct;
}

/**
 * Build a trend from an already-verified signed change and a comparison label.
 */
function build(changePct: number, comparisonPeriod: string): Trend {
  const direction = directionFrom(changePct);
  return {
    direction,
    changePct,
    displayPct: direction === 'flat' ? TREND_COPY.noChange : formatChangePercent(changePct),
    comparison: formatDate(comparisonPeriod),
    srText: TREND_COPY.srText(
      direction === 'up'
        ? TREND_COPY.rose
        : direction === 'down'
          ? TREND_COPY.fell
          : TREND_COPY.unchanged,
      // The percentage is omitted for a flat trend: "was unchanged 0.0%" adds a
      // number the eye already has, and reads like a measurement.
      direction === 'flat' ? '' : Math.abs(changePct).toFixed(1),
      formatDate(comparisonPeriod)
    ),
  };
}

/**
 * The trend for one product, or null when there is nothing honest to show.
 *
 * Null covers: no growth record, an unusable percentage, and the case where the
 * `direction` label contradicts the sign of `change_pct`.
 */
export function productTrend(
  growth: ProductGrowthItemResponse | undefined | null
): Trend | null {
  if (!growth) return null;

  const changePct = usableChange(growth.change_pct);
  if (changePct === null) return null;

  // A stated direction that disagrees with the sign of its own percentage cannot
  // be resolved in favour of either field, so neither is used. Both flat is the
  // one case that agrees and is allowed through.
  if (STATED[growth.direction] !== directionFrom(changePct)) return null;

  const period = growth.latest_period;
  if (!period) return null;

  return build(changePct, period);
}

/**
 * The trend in total value between the two latest periods, or null.
 *
 * Built from the growth items rather than the monthly trend so that the badge and
 * the per-product badges are guaranteed to describe the same two periods, which
 * lets the two agree instead of quietly disagreeing.
 *
 * `ranking.product_count` is the guard that makes "total value" true rather than
 * "the value of whichever products happened to report growth". On the messy
 * sample the monthly trend also sums to less than `ranking.total_value`, because
 * rows whose date would not parse are absent from the trend, so the two routes
 * are not interchangeable.
 */
export function totalValueTrend(data: AnalysisResponse): Trend | null {
  const growth = data.growth;
  if (!growth?.has_growth_data) return null;

  const items = growth.items;
  if (!Array.isArray(items) || items.length === 0) return null;

  const { previous_period: previousPeriod, latest_period: latestPeriod } = growth;
  if (!previousPeriod || !latestPeriod) return null;

  // Coverage: growth must account for every product, or the sum is not a total.
  const productCount = data.ranking?.product_count;
  if (typeof productCount === 'number' && items.length !== productCount) return null;

  let previousTotal = 0;
  let latestTotal = 0;
  for (const item of items) {
    const previous = item.previous_value;
    const latest = item.latest_value;
    if (
      typeof previous !== 'number' ||
      typeof latest !== 'number' ||
      !Number.isFinite(previous) ||
      !Number.isFinite(latest)
    ) {
      // A product we cannot total would silently shrink the figure.
      return null;
    }
    previousTotal += previous;
    latestTotal += latest;
  }

  if (previousTotal <= 0) return null;

  const changePct = ((latestTotal - previousTotal) / previousTotal) * 100;
  if (!Number.isFinite(changePct)) return null;
  if (Math.abs(changePct) < MIN_MEANINGFUL_CHANGE_PCT) return null;

  return build(changePct, previousPeriod);
}

/**
 * A map from product name to its trend, for the lists that render one badge per
 * product. Products without an honest trend are simply absent.
 */
export function trendMapByProduct(
  data: AnalysisResponse
): ReadonlyMap<string, Trend> {
  const map = new Map<string, Trend>();
  for (const item of data.growth?.items ?? []) {
    const trend = productTrend(item);
    if (trend) map.set(item.product, trend);
  }
  return map;
}

/**
 * The label naming the two periods a set of badges compares.
 *
 * Shown once above a group of badges rather than repeated on each one, which is
 * why it lives here instead of being baked into every badge.
 */
export function comparisonLabel(data: AnalysisResponse): string | null {
  const { previous_period: previousPeriod, latest_period: latestPeriod } = data.growth ?? {};
  if (!previousPeriod || !latestPeriod) return null;
  if (!data.growth?.has_growth_data) return null;
  return TREND_COPY.comparisonLabel(formatDate(latestPeriod), formatDate(previousPeriod));
}

/** Re-exported so a component can show a bare percentage without re-deriving it. */
export { formatPercent };