/**
 * Insight generation.
 *
 * Turns the `/analyze` response into a short list of findings, each one a single
 * sentence stating something the numbers actually support, each one pointing at
 * the chapter that shows the evidence.
 *
 * The rules this module exists to enforce:
 *
 * - **Nothing is invented.** Every figure in a sentence comes from the response.
 *   A finding that needs a field the backend did not send is not emitted.
 * - **Trivial is not interesting.** A count of zero, a 0.0% move, or a change
 *   worth 0.02% of total value is omitted rather than dressed up. The growth
 *   data is full of +350% moves on trivial amounts, and printing those would be
 *   worse than printing nothing.
 * - **Contradictory data is not used.** Shares that do not add up, a histogram
 *   that does not match the row count, or a growth item whose stated direction
 *   disagrees with its own numbers all suppress the affected findings.
 * - **Numbers are rounded for reading.** Percentages to one decimal, large
 *   values compacted, month labels spelled out.
 *
 * Everything here is pure, so the whole rule set is unit-testable without a DOM.
 */

import type {
  AnalysisResponse,
  MonthlyTrendItemResponse,
  ProductGrowthItemResponse,
} from '@/lib/api';
import { CHAPTER_IDS, INSIGHT_COPY, type ChapterId } from '@/lib/constants';
import { formatDate, formatNumber, formatPercent } from '@/lib/format';

export interface Insight {
  /** Stable within a response, used as the React key and the control id. */
  id: string;
  /** One sentence. No markup, no trailing period duplication. */
  text: string;
  /** The chapter that shows the evidence for this sentence. */
  targetChapterId: ChapterId;
}

/** A normal analysis lands in this range. Fewer is allowed for a sparse file. */
export const TARGET_MIN_INSIGHTS = 3;
export const MAX_INSIGHTS = 6;

/** Shares are compared with this much slack for float noise. */
const SHARE_TOLERANCE_PCT = 0.5;

/**
 * Smallest change worth reporting, as a share of total value.
 *
 * Without this the loudest movers are the ones with the least consequence: on
 * the sample file the top riser is +350%, which is 311 against 1.5M, or 0.02% of
 * the total. The gate keeps that out and surfaces the 18,705 drop instead.
 */
const MIN_MATERIAL_CHANGE_SHARE_PCT = 0.5;

/** Below this a month-on-month move is noise, not a finding. */
const MIN_TREND_CHANGE_PCT = 1;

/** Below this a row distribution is too lopsided to be worth a sentence. */
const MIN_ROW_CONCENTRATION_PCT = 60;

/** A Class A this thin is the story in itself. */
const THIN_CLASS_A_MAX = 2;

/* -------------------------------------------------------------------------- */
/* Coherence checks                                                            */
/* -------------------------------------------------------------------------- */

/**
 * True when the three class shares account for the whole file.
 *
 * If they do not, the ABC block is internally inconsistent and any sentence
 * built on those shares would be partly invented, so they all get suppressed.
 */
function abcSharesAreCoherent(data: AnalysisResponse): boolean {
  const abc = data.ranking?.abc_summary;
  if (!abc) return false;
  const { class_a_share_pct: a, class_b_share_pct: b, class_c_share_pct: c } = abc;
  if (![a, b, c].every((share) => typeof share === 'number' && Number.isFinite(share))) {
    return false;
  }
  return Math.abs(a + b + c - 100) <= SHARE_TOLERANCE_PCT;
}

/**
 * True when the histogram buckets account for every row.
 *
 * The buckets are pre-aggregated counts, so this is the only way to know the
 * distribution sentence describes the file that was actually read.
 */
function histogramMatchesRows(data: AnalysisResponse): boolean {
  const buckets = data.charts?.value_histogram;
  const rows = data.meta?.rows;
  if (!buckets || buckets.length === 0 || typeof rows !== 'number') return false;
  const counted = buckets.reduce((sum, bucket) => sum + (bucket.count ?? 0), 0);
  // Rows with a null value are not bucketed, so allow a small shortfall.
  return counted <= rows && rows - counted <= Math.max(1, rows * 0.01);
}

/**
 * Whether the "Over time" chapter will be rendered.
 *
 * page.tsx hides that chapter when there are no dates, so any finding that
 * targets it has to be withheld too — otherwise the insight list would hold a
 * link to an anchor that does not exist in the document. Growth data can outlive
 * the trend: a file can report a latest period and no monthly series.
 */
function hasTimeChapter(data: AnalysisResponse): boolean {
  const trend = data.charts?.monthly_trend;
  return Array.isArray(trend) && trend.length > 0;
}

/**
 * The growth item with the largest change in absolute value, if that change is
 * material.
 *
 * Also the guard against self-contradiction: an item whose `direction` disagrees
 * with the sign of its own `change_pct` is dropped, because we cannot tell which
 * of the two is wrong and either could produce a false sentence.
 */
function largestMaterialMover(data: AnalysisResponse): {
  item: ProductGrowthItemResponse;
  absoluteChange: number;
} | null {
  const items = data.growth?.items;
  const total = data.ranking?.total_value;
  if (!items || items.length === 0 || !total || total <= 0) return null;

  let best: { item: ProductGrowthItemResponse; absoluteChange: number } | null = null;

  for (const item of items) {
    const previous = item.previous_value;
    const latest = item.latest_value;
    const change = item.change_pct;
    if (
      typeof previous !== 'number' ||
      typeof latest !== 'number' ||
      typeof change !== 'number' ||
      !Number.isFinite(previous) ||
      !Number.isFinite(latest) ||
      !Number.isFinite(change)
    ) {
      continue;
    }

    // A flat item has no story either way.
    if (item.direction === 'flat' || change === 0) continue;

    // Contradiction: the label and the number disagree.
    const claimedUp = item.direction === 'rising';
    const actuallyUp = latest > previous;
    if (claimedUp !== actuallyUp) continue;

    const absoluteChange = Math.abs(latest - previous);
    const shareOfTotal = (absoluteChange / total) * 100;
    if (shareOfTotal < MIN_MATERIAL_CHANGE_SHARE_PCT) continue;

    if (!best || absoluteChange > best.absoluteChange) {
      best = { item, absoluteChange };
    }
  }

  return best;
}

/** The last two months of the trend, in order, when both are usable. */
function lastTwoMonths(
  trend: readonly MonthlyTrendItemResponse[] | undefined
): { latest: MonthlyTrendItemResponse; previous: MonthlyTrendItemResponse } | null {
  if (!trend || trend.length < 2) return null;
  const sorted = [...trend].sort((a, b) => a.month.localeCompare(b.month));
  const latest = sorted[sorted.length - 1];
  const previous = sorted[sorted.length - 2];
  if (!latest || !previous) return null;
  if (!(latest.value > 0) || !(previous.value > 0)) return null;
  return { latest, previous };
}

/* -------------------------------------------------------------------------- */
/* Candidate findings                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Each builder returns one finding or null.
 *
 * They are written as independent candidates rather than a single pass so that a
 * guard that rejects one finding cannot accidentally suppress another, and so the
 * priority order below is the only thing deciding what a reader sees.
 */
const CANDIDATES: readonly ((data: AnalysisResponse) => Insight | null)[] = [
  // 1. Did the month on the latest month go up or down? The most decision-relevant
  //    fact in the file and the one the Pareto headline never mentions.
  (data) => {
    const months = lastTwoMonths(data.charts?.monthly_trend);
    if (!months) return null;

    const { latest, previous } = months;
    const changePct = ((latest.value - previous.value) / previous.value) * 100;
    if (!Number.isFinite(changePct)) return null;
    if (Math.abs(changePct) < MIN_TREND_CHANGE_PCT) return null;

    return {
      id: 'trend-change',
      text: INSIGHT_COPY.trendChange(
        formatDate(latest.month),
        formatPercent(Math.abs(changePct)),
        changePct > 0 ? INSIGHT_COPY.trendAbove : INSIGHT_COPY.trendBelow,
        formatDate(previous.month)
      ),
      targetChapterId: CHAPTER_IDS.time,
    };
  },

  // 2. Which single product moved the most value? Reported in percent *and* only
  //    when the underlying amount is material.
  (data) => {
    if (!hasTimeChapter(data)) return null;
    if (!data.growth?.has_growth_data || !data.growth.latest_period) return null;
    const mover = largestMaterialMover(data);
    if (!mover) return null;

    const changePct = mover.item.change_pct;
    if (typeof changePct !== 'number' || !Number.isFinite(changePct)) return null;

    const sign = changePct > 0 ? '+' : '-';
    return {
      id: 'value-mover',
      text: INSIGHT_COPY.valueMover(
        mover.item.product,
        `${sign}${Math.abs(changePct).toFixed(1)}%`,
        formatDate(data.growth.latest_period)
      ),
      targetChapterId: CHAPTER_IDS.time,
    };
  },

  // 3. Is Class A one product? When it is, that is the finding, and it is not
  //    visible anywhere else in the story.
  (data) => {
    if (!abcSharesAreCoherent(data)) return null;
    const abc = data.ranking.abc_summary;
    if (!abc) return null;

    const count = abc.class_a_count;
    if (typeof count !== 'number' || count < 1 || count > THIN_CLASS_A_MAX) return null;

    return {
      id: 'class-a-thin',
      text: INSIGHT_COPY.classAFewProducts(count, formatPercent(abc.class_a_share_pct)),
      targetChapterId: CHAPTER_IDS.split,
    };
  },

  // 4. The long tail against the leader. Comparing the tail to the single top
  //    product says more than either share does alone.
  (data) => {
    if (!abcSharesAreCoherent(data)) return null;
    const abc = data.ranking?.abc_summary;
    const leader = data.ranking?.items?.[0];
    if (!abc || !leader) return null;

    const tailCount = abc.class_c_count;
    if (typeof tailCount !== 'number' || tailCount < 3) return null;
    // Only true when the comparison actually holds; otherwise it would read as a
    // contradiction.
    if (abc.class_c_share_pct >= leader.share_pct) return null;

    return {
      id: 'long-tail-vs-leader',
      text: INSIGHT_COPY.longTailVsLeader(
        tailCount,
        formatPercent(abc.class_c_share_pct),
        leader.product,
        formatPercent(leader.share_pct)
      ),
      targetChapterId: CHAPTER_IDS.tail,
    };
  },

  // 5. Data the reader should not trust without knowing. Only when non-zero: a
  //    clean file gets no "0 duplicate rows were found" sentence.
  (data) => {
    const duplicates = data.quality?.duplicate_row_count;
    if (typeof duplicates !== 'number' || !Number.isFinite(duplicates) || duplicates <= 0) {
      return null;
    }
    return {
      id: 'duplicates-found',
      text: INSIGHT_COPY.duplicatesFound(formatNumber(duplicates)),
      targetChapterId: CHAPTER_IDS.quality,
    };
  },

  // 6. Rows the backend discarded. `rows_dropped` really is a count of rows
  //    removed, so unlike duplicates it can be described as dropped.
  (data) => {
    const dropped = data.cleaning?.rows_dropped;
    if (typeof dropped !== 'number' || !Number.isFinite(dropped) || dropped <= 0) return null;
    return {
      id: 'rows-dropped',
      text: INSIGHT_COPY.rowsDropped(formatNumber(dropped)),
      targetChapterId: CHAPTER_IDS.quality,
    };
  },

  // 7. Missing cells, same reasoning as duplicates.
  (data) => {
    const missing = data.quality?.total_missing_cells;
    if (typeof missing !== 'number' || !Number.isFinite(missing) || missing <= 0) return null;
    return {
      id: 'missing-cells',
      text: INSIGHT_COPY.missingCells(formatNumber(missing)),
      targetChapterId: CHAPTER_IDS.quality,
    };
  },

  // 8. How lopsided the row distribution is. Says "rows", never "products": the
  //    histogram counts rows, and conflating the two would be a false claim.
  (data) => {
    if (!histogramMatchesRows(data)) return null;
    const buckets = data.charts.value_histogram;
    const rows = data.meta.rows;

    const sorted = [...buckets].sort((a, b) => a.bucket_min - b.bucket_min);
    const lowest = sorted[0];
    if (!lowest) return null;

    const count = lowest.count ?? 0;
    if (count <= 0) return null;
    const pct = (count / rows) * 100;
    if (pct < MIN_ROW_CONCENTRATION_PCT) return null;

    return {
      id: 'row-concentration',
      text: INSIGHT_COPY.rowConcentration(
        formatNumber(count),
        formatNumber(rows),
        formatPercent(pct)
      ),
      targetChapterId: CHAPTER_IDS.shape,
    };
  },
];

/**
 * Build the insight list for a response.
 *
 * Candidates run in priority order and the list is capped at MAX_INSIGHTS, so
 * the findings a reader sees first are the ones that change a decision. A file
 * too sparse to support TARGET_MIN_INSIGHTS returns fewer rather than padding
 * with weak sentences, and a caller should render nothing at all if it gets an
 * empty list.
 */
export function generateInsights(data: AnalysisResponse): Insight[] {
  const insights: Insight[] = [];
  const seen = new Set<string>();

  for (const candidate of CANDIDATES) {
    if (insights.length >= MAX_INSIGHTS) break;

    let insight: Insight | null = null;
    try {
      insight = candidate(data);
    } catch {
      // A malformed field should cost one finding, never the whole page.
      insight = null;
    }
    if (!insight || seen.has(insight.id)) continue;

    seen.add(insight.id);
    insights.push(insight);
  }

  return insights;
}