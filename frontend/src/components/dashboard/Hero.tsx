'use client';

import { StatNumber } from '@/components/ui';
import type { AnalysisResponse } from '@/lib/api';
import { formatNumber } from '@/lib/format';

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

export function Hero({ data }: { data: AnalysisResponse }) {
  const { ranking, meta, quality } = data;
  const { abc_summary: abc } = ranking;

  const qualityTone =
    quality.score >= 90 ? 'positive' : quality.score >= 50 ? 'neutral' : 'negative';

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <span className="label-xs">The finding</span>
        <h1 className="font-serif text-hero leading-[1.05] text-[var(--color-text)]">
          <HighlightedParetoSummary summary={ranking.pareto_summary} />
        </h1>
        <p className="text-lg text-[var(--color-muted-text)]">
          {abc.class_a_count} {abc.class_a_count === 1 ? 'product' : 'products'} in Class A,{' '}
          {abc.class_b_count} in Class B, and {abc.class_c_count} in Class C
        </p>
      </div>

      <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
        <StatNumber value={formatNumber(meta.rows)} label="Rows" />
        <StatNumber value={formatNumber(meta.columns)} label="Columns" />
        <StatNumber value={formatNumber(ranking.total_value)} label="Total value" />
        <StatNumber
          value={quality.score.toFixed(0)}
          label="Quality score"
          status={quality.status}
          statusTone={qualityTone}
        />
      </div>
    </div>
  );
}
