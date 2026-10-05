'use client';

import type { AnalysisResponse } from '@/lib/api';
import { formatNumber, formatPercent } from '@/lib/format';
import { cn } from '@/lib/cn';
import { ClassBadge } from '@/components/ui/ClassBadge';
import { TrendBadge } from '@/components/dashboard/TrendBadge';
import { DASHBOARD_COPY, TREND_COPY, asAbcClass } from '@/lib/constants';
import { deriveMonthRange, qualityLevel, type StatusTone } from '@/lib/metrics';
import { totalValueTrend, comparisonLabel } from '@/lib/trends';

interface ExecutiveSummaryProps {
  data: AnalysisResponse;
  className?: string;
}

interface SummaryFact {
  /** Stable id for React's key. Never rendered. */
  textKey: string;
  /**
   * Renderable rather than a string, because the total-value row carries a trend
   * badge next to its label.
   */
  label: React.ReactNode;
  children: React.ReactNode;
}

const TONE_DOT: Record<StatusTone, string> = {
  positive: 'bg-[var(--color-class-a)]',
  neutral: 'bg-[var(--color-muted-text)]',
  negative: 'bg-[var(--color-class-c)]',
};

/**
 * One scannable block under the Pareto headline.
 *
 * Deliberately a ruled block rather than a card: a hairline above and below, no
 * border box, no shadow. Each fact is label-over-value so the eye can run down
 * the labels and stop at the one it cares about.
 *
 * Every line is omitted rather than faked when the data is missing — a file with
 * no dates simply has no "months covered" line.
 */
export function ExecutiveSummary({ data, className }: ExecutiveSummaryProps) {
  const { ranking, quality, meta } = data;

  const leader = ranking.items[0];
  const monthRange = deriveMonthRange(data.charts?.monthly_trend);
  const qualityBadge = qualityLevel(quality.score);

  // The badge sits on the total value because that is the figure whose movement
  // changes the headline. Names its own comparison, since nothing else on screen
  // would tell the reader what "Dec 2025 vs Nov 2025" was against.
  const totalTrend = totalValueTrend(data);
  const trendComparison = comparisonLabel(data);

  const facts: SummaryFact[] = [];

  facts.push({
    textKey: DASHBOARD_COPY.summaryTotalValue,
    label: (
      <span className="inline-flex items-baseline gap-2">
        {DASHBOARD_COPY.summaryTotalValue}
        <TrendBadge trend={totalTrend} comparison={trendComparison ?? undefined} />
      </span>
    ),
    children: (
      <span title={ranking.total_value.toLocaleString('en-US')}>
        {formatNumber(ranking.total_value)}
        {/* The badge is not decorative: name what it measures for anyone who
            cannot see the arrow, without duplicating it in every heading. */}
        <span className="sr-only">
          {totalTrend ? ` ${TREND_COPY.totalValueAriaLabel}: ${totalTrend.srText}` : ''}
        </span>
      </span>
    ),
  });

  if (leader) {
    facts.push({
      textKey: DASHBOARD_COPY.summaryTopProduct,
      label: DASHBOARD_COPY.summaryTopProduct,
      children: (
        <span className="inline-flex flex-wrap items-baseline gap-x-2">
          <span>{leader.product}</span>
          {/* The class letter is always spelled out, never colour alone. */}
          <ClassBadge class={asAbcClass(leader.abc_class)} size="sm" />
          <span className="text-[var(--color-muted-text)]">
            {DASHBOARD_COPY.summaryTopProductShare(formatPercent(leader.share_pct))}
          </span>
        </span>
      ),
    });
  }

  facts.push({
    textKey: DASHBOARD_COPY.summaryQuality,
    label: DASHBOARD_COPY.summaryQuality,
    children: (
      /* The score is ordinary text and the level word carries the tone beside a
         dot. Colouring the word itself would put 12-to-20px text at the ABC
         green's 3.07:1 in the light theme, short of AA's 4.5:1, and this size
         does not qualify as large text. See StatNumber for the same rule. */
      <span className="inline-flex flex-wrap items-baseline gap-x-2">
        <span>{quality.score.toFixed(0)}</span>
        <span className="inline-flex items-center gap-1.5 text-[var(--color-muted-text)]">
          <span
            aria-hidden="true"
            className={cn('h-1.5 w-1.5 flex-shrink-0 rounded-full', TONE_DOT[qualityBadge.tone])}
          />
          {qualityBadge.label}
        </span>
      </span>
    ),
  });

  facts.push({
    textKey: DASHBOARD_COPY.summaryRowsProcessed,
    label: DASHBOARD_COPY.summaryRowsProcessed,
    children: <span>{formatNumber(meta.rows)}</span>,
  });

  return (
    <div className={cn('border-y border-[var(--color-rule)] py-5', className)}>
      <span className="label-xs">{DASHBOARD_COPY.summaryEyebrow}</span>

      <dl className="mt-4 grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
        {facts.map((fact) => (
          // Keyed on the plain label: it is a stable string, and the label now
          // holds an element alongside it for the trend badge.
          <div key={fact.textKey} className="flex flex-col gap-1">
            <dt className="text-xs uppercase tracking-widest text-[var(--color-muted-text)]">
              {fact.label}
            </dt>
            <dd className="font-serif text-xl leading-tight text-[var(--color-text)]">
              {fact.children}
            </dd>
          </div>
        ))}

        {/* Month granularity only: the response has no min/max date. */}
        {monthRange && (
          <div className="flex flex-col gap-1">
            <dt className="text-xs uppercase tracking-widest text-[var(--color-muted-text)]">
              Months covered
            </dt>
            <dd className="font-serif text-xl leading-tight text-[var(--color-text)]">
              {monthRange.label}
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}