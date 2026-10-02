'use client';

import type { AnalysisResponse } from '@/lib/api';
import { ExecutiveSummary } from '@/components/dashboard/ExecutiveSummary';
import { KpiRow } from '@/components/dashboard/KpiRow';
import type { MetricId } from '@/lib/metrics';

/**
 * The backend's Pareto summary is the headline. Percentages inside it are
 * highlighted in the Class A colour so the finding reads at a glance; the text
 * stays intact so screen readers and copy-paste are unaffected.
 */
function HighlightedParetoSummary({ summary }: { summary: string }) {
  const parts = summary.split(/(\d+(?:\.\d+)?%)/g);
  return (
    <>
      {parts.map((part, i) =>
        /^\d+(?:\.\d+)?%$/.test(part) ? (
          <span key={i} className="text-[var(--color-class-a)]">
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

interface HeroProps {
  data: AnalysisResponse;
  /** Which figures the KPI row shows, and how to change that selection. */
  metricSelection: readonly MetricId[];
  onMetricSelectionChange: (next: MetricId[]) => void;
}

export function Hero({ data, metricSelection, onMetricSelectionChange }: HeroProps) {
  const { ranking } = data;

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <span className="label-xs">The finding</span>
        <h1 className="font-serif text-hero leading-[1.05] text-[var(--color-text)]">
          <HighlightedParetoSummary summary={ranking.pareto_summary} />
        </h1>
      </div>

      {/* Replaces the old one-line class-count sentence: the same facts, scannable. */}
      <ExecutiveSummary data={data} />

      <KpiRow
        data={data}
        selected={metricSelection}
        onSelectedChange={onMetricSelectionChange}
      />
    </div>
  );
}