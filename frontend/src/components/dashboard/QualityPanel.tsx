'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import { Chapter } from '@/components/ui';
import type { AnalysisResponse } from '@/lib/api';
import { formatNumber } from '@/lib/format';

interface QualityPanelProps {
  data: AnalysisResponse;
}

interface StatProps {
  label: string;
  value: string;
}

function Stat({ label, value }: StatProps) {
  return (
    <div className="space-y-1">
      <span className="label-xs">{label}</span>
      <p className="font-serif text-[1.75rem] leading-none text-[var(--color-text)]">{value}</p>
    </div>
  );
}

/** A warning the reader can dismiss for this session. */
function Warning({ text, onDismiss }: { text: string; onDismiss: () => void }) {
  return (
    <li className="flex items-start justify-between gap-3 border-b border-[var(--color-rule)] py-2 last:border-0">
      <span className="flex items-start gap-2 text-sm text-[var(--color-muted-text)]">
        <span className="mt-1.5 h-1 w-1 flex-shrink-0 rounded-full bg-[var(--color-class-b)]" aria-hidden="true" />
        {text}
      </span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={`Dismiss warning: ${text}`}
        className="flex-shrink-0 rounded p-0.5 text-[var(--color-muted-text)] transition-colors hover:text-[var(--color-text)]"
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </li>
  );
}

export function QualityPanel({ data }: QualityPanelProps) {
  const { quality, cleaning, warnings } = data;
  const [dismissed, setDismissed] = useState<readonly string[]>([]);

  const visibleWarnings = (warnings ?? []).filter((w) => !dismissed.includes(w));

  return (
    <Chapter number={1} title="Your data">
      <div className="space-y-8">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Stat label="Missing cells" value={formatNumber(quality.total_missing_cells)} />
          <Stat label="Duplicate rows" value={formatNumber(quality.duplicate_row_count)} />
          <Stat label="Quality score" value={`${quality.score.toFixed(0)}/100`} />
        </div>

        <p className="text-sm text-[var(--color-muted-text)]">{quality.description}</p>

        <div className="space-y-2">
          <span className="label-xs">Cleaning</span>
          <p className="text-sm text-[var(--color-muted-text)]">
            {formatNumber(cleaning.rows_before)} rows in, {formatNumber(cleaning.rows_after)} out
            {cleaning.rows_dropped > 0 && ` · ${formatNumber(cleaning.rows_dropped)} dropped`}
            {(cleaning.columns_dropped ?? []).length > 0 &&
              ` · columns dropped: ${(cleaning.columns_dropped ?? []).join(', ')}`}
          </p>
          {cleaning.null_like_values_converted > 0 && (
            <p className="text-sm text-[var(--color-muted-text)]">
              {formatNumber(cleaning.null_like_values_converted)} null-like values converted
            </p>
          )}
          {(cleaning.failed_numeric_conversions > 0 ||
            cleaning.failed_date_conversions > 0) && (
            <p className="text-sm text-[var(--color-muted-text)]">
              {formatNumber(cleaning.failed_numeric_conversions)} numeric and{' '}
              {formatNumber(cleaning.failed_date_conversions)} date cells could not be parsed
            </p>
          )}
          {(cleaning.conversions_performed ?? []).length > 0 && (
            <ul className="mt-2 space-y-1">
              {(cleaning.conversions_performed ?? []).map((conversion) => (
                <li
                  key={conversion}
                  className="text-sm text-[var(--color-muted-text)] before:mr-2 before:text-[var(--color-rule)] before:content-['—']"
                >
                  {conversion}
                </li>
              ))}
            </ul>
          )}
        </div>

        {visibleWarnings.length > 0 && (
          <div className="space-y-2">
            <span className="label-xs">Warnings</span>
            <ul>
              {visibleWarnings.map((warning) => (
                <Warning
                  key={warning}
                  text={warning}
                  onDismiss={() => setDismissed((prev) => [...prev, warning])}
                />
              ))}
            </ul>
          </div>
        )}
      </div>
    </Chapter>
  );
}
