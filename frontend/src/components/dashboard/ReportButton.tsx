'use client';

import { useMemo } from 'react';
import { FileText } from 'lucide-react';
import { cn } from '@/lib/cn';
import { DOWNLOAD_COPY } from '@/lib/constants';
import { useDownload } from '@/hooks/useDownload';
import { triggerDownload } from '@/lib/download';
import { buildReport, type BuildReportOptions } from '@/lib/report/buildReport';

interface ReportButtonProps {
  /** Everything the report needs. All sections are included. */
  buildOptions: BuildReportOptions;
  className?: string;
}

/**
 * Download the whole analysis as one PDF, with every section.
 *
 * This is the no-questions version for the end of the story, where someone has
 * read the report on screen and wants the document. The options dialog in the
 * top bar is the adjustable version; this one always takes everything so it
 * stays a single click.
 */
export function ReportButton({ buildOptions, className }: ReportButtonProps) {
  const { isPreparing, failure, liveMessage, run, dismiss } = useDownload();

  const download = useMemo(
    () => async () => {
      const result = await buildReport(buildOptions);
      triggerDownload(result.blob, result.filename);
    },
    [buildOptions]
  );

  return (
    <div className={cn('relative', className)}>
      <button
        type="button"
        disabled={isPreparing}
        onClick={() => void run(download)}
        className={cn(
          'inline-flex items-center gap-2 rounded-[6px] border border-[var(--color-rule)] px-4 py-2.5 text-sm',
          'text-[var(--color-text)] transition-colors hover:bg-[var(--color-rule)]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]',
          'disabled:cursor-not-allowed disabled:opacity-60'
        )}
      >
        <FileText className="h-4 w-4" aria-hidden="true" />
        {isPreparing ? DOWNLOAD_COPY.busyLabel : DOWNLOAD_COPY.downloadReport}
      </button>

      {failure && (
        <div
          role="alert"
          className="absolute right-0 top-full z-20 mt-2 w-64 rounded-[6px] border border-[var(--color-class-c)] bg-[var(--color-page)] p-3 text-sm"
        >
          <p className="font-medium text-[var(--color-text)]">{failure.title}</p>
          <p className="text-[var(--color-muted-text)]">{failure.hint}</p>
          <button
            type="button"
            onClick={dismiss}
            className="mt-2 rounded-[6px] border border-[var(--color-rule)] px-2 py-1 text-xs"
          >
            Dismiss
          </button>
        </div>
      )}

      <span className="sr-only" role="status" aria-live="polite">
        {liveMessage}
      </span>
    </div>
  );
}
