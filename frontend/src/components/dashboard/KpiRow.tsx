'use client';

import type { AnalysisResponse } from '@/lib/api';
import { cn } from '@/lib/cn';
import { StatNumber } from '@/components/ui/StatNumber';
import { KpiCustomize } from '@/components/dashboard/KpiCustomize';
import { DASHBOARD_COPY } from '@/lib/constants';
import {
  computeMetrics,
  resolveMetricSelection,
  type MetricId,
} from '@/lib/metrics';

interface KpiRowProps {
  data: AnalysisResponse;
  selected: readonly MetricId[];
  onSelectedChange: (next: MetricId[]) => void;
  className?: string;
}

/**
 * The row of key figures under the headline.
 *
 * Ruled tiles separated by hairlines rather than boxed cards, so the strip reads
 * as one line of type instead of a shelf of widgets.
 *
 * The compact number is what you see; the exact value rides along in the title
 * attribute, which is also what a screen reader announces for the figure.
 */
export function KpiRow({ data, selected, onSelectedChange, className }: KpiRowProps) {
  const available = computeMetrics(data);
  const values = resolveMetricSelection(selected, available);

  return (
    <div className={cn('space-y-5', className)}>
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="label-xs">{DASHBOARD_COPY.kpiAriaLabel}</h2>
        <KpiCustomize
          selected={selected}
          onSelectedChange={onSelectedChange}
          available={available}
        />
      </div>

      {/* A ruled ledger, not a shelf of cards: one hairline above the block and
          one under each row of figures, with whitespace doing the dividing.

          Horizontal rules are deliberate over vertical ones. The story column is
          capped at 760px, so six tiles across would leave ~120px each, which the
          display number overflows. Vertical rules also cannot express "not the
          first tile in its row" in CSS once the count is user-controlled, so
          they would draw a stray border at the start of a wrapped row.

          `@container` sits on each tile, not on the row: the figure is sized in
          container units, and the tile is the container it has to fit inside. On
          the row it would resolve against the full 728px and never shrink. */}
      <dl className="mt-4 grid grid-cols-2 gap-x-8 border-t border-[var(--color-rule)] sm:grid-cols-3">
        {values.map((metric) => (
          <div
            key={metric.id}
            className="@container min-w-0 border-b border-[var(--color-rule)] py-5"
          >
            <StatNumber
              value={metric.value}
              label={metric.label}
              status={metric.status}
              statusTone={metric.statusTone}
              title={`${metric.label}. ${DASHBOARD_COPY.kpiFullValuePrefix} ${metric.full}${
                metric.status
                  ? `. ${DASHBOARD_COPY.kpiStatusPrefix} ${metric.status}`
                  : ''
              }`}
            />
          </div>
        ))}
      </dl>
    </div>
  );
}