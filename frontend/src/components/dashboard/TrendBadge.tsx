'use client';

import { TREND_GLYPH, type Trend } from '@/lib/trends';
import { TREND_COPY } from '@/lib/constants';
import { cn } from '@/lib/cn';

interface TrendBadgeProps {
  trend: Trend | null | undefined;
  /**
   * Names the comparison when one badge stands alone, e.g. beside the total value
   * in the summary. A list shows the pair of periods once above it instead, so
   * there the badge stays quiet.
   */
  comparison?: string;
  /** Shown beside the arrow and the percentage. */
  className?: string;
}

/**
 * Tone on the arrow only; the percentage stays muted.
 *
 * The ABC green is 3.07:1 and the ABC red 3.94:1 on the light page, both short of
 * AA's 4.5:1 for text this size. The arrow is a graphic, where AA asks 3:1, so the
 * colour lives there; the number beside it uses muted text at 5.13:1. This is the
 * same split `ClassBadge` and `StatNumber` already use, so the three agree.
 */
const TONE: Record<Trend['direction'], string> = {
  up: 'text-[var(--color-class-a)]',
  down: 'text-[var(--color-class-c)]',
  flat: 'text-[var(--color-muted-text)]',
};

/**
 * A direction of travel: an arrow, a percentage, and what it is measured against.
 *
 * The colour is the ABC green and red already in use elsewhere, and the arrow is
 * always present, so the direction survives being printed, seen in greyscale, or
 * read by someone who cannot separate those two colours.
 *
 * The comparison label is part of the badge rather than a tooltip. A bare
 * "+10.3%" tells the reader nothing about what it is against, and a tooltip is
 * unavailable to a keyboard or touch user.
 *
 * The spoken wording sits off screen instead of being an aria-label on the
 * wrapper: aria-label on a generic span is inconsistently honoured, and here it
 * would replace rather than accompany the visible text.
 */
export function TrendBadge({ trend, comparison, className }: TrendBadgeProps) {
  if (!trend) return null;

  return (
    <span className={cn('inline-flex items-baseline gap-1 text-xs', className)}>
      <span aria-hidden="true" className={TONE[trend.direction]}>
        {TREND_GLYPH[trend.direction]}
      </span>
      {/* Muted rather than toned: see TONE. The glyph already carries direction. */}
      <span aria-hidden="true" className="text-[var(--color-muted-text)]">
        {trend.displayPct}
      </span>
      {/* The whole indicator read as one phrase: "fell 10.5% versus November 2025". */}
      <span className="sr-only">{trend.srText}</span>
      {comparison && (
        <>
          <span aria-hidden="true" className="text-[var(--color-muted-text)]">
            {comparison}
          </span>
          <span className="sr-only">{TREND_COPY.comparisonPrevious}</span>
        </>
      )}
    </span>
  );
}

interface TrendBadgeGroupProps {
  /** Names the pair of periods once, above a group of badges. */
  label: string | null;
  className?: string;
}

/**
 * A row of per-product badges under one shared comparison label.
 *
 * Naming the periods once above the group keeps each row readable: repeating
 * "vs Nov 2025" fifteen times would bury the figures it belongs to.
 *
 * The label is duplicated to the reader as a phrase, because "Dec 2025 vs Nov
 * 2025" alone does not say what is being compared.
 */
export function TrendBadgeGroup({ label, className }: TrendBadgeGroupProps) {
  if (!label) return null;

  return (
    <p className={cn('text-xs text-[var(--color-muted-text)]', className)}>
      <span aria-hidden="true">{label}</span>
      <span className="sr-only">{TREND_COPY.comparisonPrevious}</span>
    </p>
  );
}