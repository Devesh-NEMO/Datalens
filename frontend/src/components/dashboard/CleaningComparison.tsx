'use client';

import type { AnalysisResponse } from '@/lib/api';
import { CLEANING_COPY } from '@/lib/constants';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/cn';

interface CleaningComparisonProps {
  data: AnalysisResponse;
  className?: string;
}

interface Measure {
  label: string;
  before: string;
  after: string;
  changed: boolean;
}

interface AppliedChange {
  text: string;
}

/**
 * Work done to the file, split into the two kinds of statement the response can
 * actually support.
 *
 * The table holds only measures with a real figure on **both** sides. The rows
 * dropped and the columns kept come from the explicit before/after counts; the
 * column after-count is derived by subtraction rather than read from the profile,
 * so the table never depends on a field whose post-cleaning meaning is inferred.
 *
 * The list below holds the counts that have no "before" figure at all. Showing
 * those in the table would mean inventing the left-hand column, so they are
 * labelled as work done instead.
 */
function buildMeasures(data: AnalysisResponse): Measure[] {
  const cleaning = data.cleaning;
  const meta = data.meta;
  const columnsDropped = cleaning?.columns_dropped?.length ?? 0;

  const rowsBefore = cleaning?.rows_before ?? 0;
  const rowsAfter = cleaning?.rows_after ?? 0;

  const columnsBefore = meta?.columns ?? 0;
  const columnsAfter = Math.max(0, columnsBefore - columnsDropped);

  return [
    {
      label: CLEANING_COPY.rowsLabel,
      before: formatNumber(rowsBefore),
      after: formatNumber(rowsAfter),
      changed: rowsAfter !== rowsBefore,
    },
    {
      label: CLEANING_COPY.columnsLabel,
      before: formatNumber(columnsBefore),
      after: formatNumber(columnsAfter),
      changed: columnsAfter !== columnsBefore,
    },
  ];
}

function buildChanges(data: AnalysisResponse): AppliedChange[] {
  const cleaning = data.cleaning;
  if (!cleaning) return [];

  const changes: AppliedChange[] = [];
  const droppedColumns = cleaning.columns_dropped ?? [];

  if (cleaning.rows_dropped > 0) {
    changes.push({ text: CLEANING_COPY.rowsDropped(formatNumber(cleaning.rows_dropped)) });
  }
  if (droppedColumns.length > 0) {
    changes.push({ text: CLEANING_COPY.columnsDropped(droppedColumns.join(', ')) });
  }
  if (cleaning.null_like_values_converted > 0) {
    changes.push({
      text: CLEANING_COPY.nullLikeConverted(formatNumber(cleaning.null_like_values_converted)),
    });
  }
  if (cleaning.failed_date_conversions > 0) {
    changes.push({
      text: CLEANING_COPY.failedDates(formatNumber(cleaning.failed_date_conversions)),
    });
  }
  if (cleaning.failed_numeric_conversions > 0) {
    changes.push({
      text: CLEANING_COPY.failedNumbers(formatNumber(cleaning.failed_numeric_conversions)),
    });
  }

  return changes;
}

/**
 * Before and after cleaning, inside the "Your data" chapter.
 *
 * Ruled rows rather than a boxed table: the left column of numbers belongs to the
 * file as uploaded and the right column to the file as analysed, and a hairline
 * between them says so without adding a card around it.
 *
 * Says "no changes were needed" when every count is zero. That is a real
 * statement about the file, so it replaces the table rather than sitting above an
 * empty one.
 */
export function CleaningComparison({ data, className }: CleaningComparisonProps) {
  const measures = buildMeasures(data);
  const changes = buildChanges(data);

  // Any measure that moved, or any change applied, means the file was altered.
  const wasChanged = measures.some((measure) => measure.changed) || changes.length > 0;

  return (
    <div className={cn('space-y-4', className)}>
      <span className="label-xs">{CLEANING_COPY.eyebrow}</span>

      {!wasChanged ? (
        <p className="text-sm text-[var(--color-muted-text)]">{CLEANING_COPY.noChanges}</p>
      ) : (
        <>
          <p className="text-sm text-[var(--color-muted-text)]">{CLEANING_COPY.caption}</p>

          <table className="w-full text-sm">
            <caption className="sr-only">{CLEANING_COPY.caption}</caption>
            <thead>
              <tr className="border-y border-[var(--color-rule)]">
                {/* Empty corner cell: the row header needs a column of its own,
                    and a caption here would misname it. */}
                <th scope="col" className="py-2 text-left font-normal">
                  <span className="sr-only">{CLEANING_COPY.measure}</span>
                </th>
                <th scope="col" className="py-2 text-right font-normal">
                  <span className="label-xs">{CLEANING_COPY.before}</span>
                </th>
                <th scope="col" className="py-2 text-right font-normal">
                  <span className="label-xs">{CLEANING_COPY.after}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {measures.map((measure) => (
                <tr key={measure.label} className="border-b border-[var(--color-rule)] last:border-0">
                  <th scope="row" className="py-2.5 text-left font-normal text-[var(--color-muted-text)]">
                    {measure.label}
                  </th>
                  <td className="py-2.5 text-right font-serif tabular-nums text-[var(--color-muted-text)]">
                    {measure.before}
                  </td>
                  <td className="py-2.5 text-right font-serif tabular-nums text-[var(--color-text)]">
                    {measure.after}
                    {!measure.changed && (
                      <span className="sr-only"> {CLEANING_COPY.unchanged}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {changes.length > 0 && (
            <div className="space-y-2">
              <span className="label-xs">{CLEANING_COPY.appliedEyebrow}</span>
              <ul>
                {changes.map((change) => (
                  <li
                    key={change.text}
                    className="border-b border-[var(--color-rule)] py-2 text-sm text-[var(--color-muted-text)] last:border-0"
                  >
                    {change.text}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}