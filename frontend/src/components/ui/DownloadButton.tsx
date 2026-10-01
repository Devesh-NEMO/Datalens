'use client';

/**
 * A single-format download button: the plain-button counterpart to
 * `DownloadMenu`, used where there is only one sensible format to offer.
 *
 * It owns the same concerns `DownloadMenu` does — busy state, spinner, failure
 * banner, live-region announcement, focus-visible ring — so a "Download CSV"
 * button behaves identically to a "Download PDF" one and to the chart menu's
 * CSV option.
 */

import type { LucideIcon } from 'lucide-react';
import { Check, Download, Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { DOWNLOAD_COPY } from '@/lib/constants';
import { useDownload } from '@/hooks/useDownload';

interface DownloadButtonProps {
  /** Button text, e.g. "Download CSV". */
  label: string;
  /** Icon shown before the label. */
  icon?: LucideIcon;
  /** Format shown beside the label, e.g. "CSV". */
  format?: string;
  /** The work to do. Rejections surface as the shared failure banner. */
  run: () => void | Promise<void>;
  disabled?: boolean;
  className?: string;
}

export function DownloadButton({
  label,
  icon: Icon = Download,
  format,
  run,
  disabled = false,
  className,
}: DownloadButtonProps) {
  const { isPreparing, failure, liveMessage, run: startRun, dismiss } = useDownload();
  const busy = isPreparing || disabled;

  return (
    <div className={cn('relative inline-block', className)}>
      <button
        type="button"
        disabled={busy}
        onClick={() => void startRun(run)}
        className={cn(
          'inline-flex items-center gap-2 rounded-[6px] border px-3 py-2 text-sm',
          'border-[var(--color-rule)] text-[var(--color-text)] bg-transparent',
          'hover:bg-[var(--color-rule)] transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]',
          'disabled:opacity-50 disabled:cursor-not-allowed'
        )}
      >
        {isPreparing ? (
          <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        ) : (
          <Icon className="h-4 w-4" aria-hidden="true" />
        )}
        <span>{isPreparing ? DOWNLOAD_COPY.busyLabel : label}</span>
        {format && !isPreparing ? (
          <span className="text-xs uppercase tracking-wide text-[var(--color-muted-text)]">
            {format}
          </span>
        ) : null}
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
            className="mt-2 inline-flex items-center gap-1 rounded-[6px] border border-[var(--color-rule)] px-2 py-1 text-xs"
          >
            <Check className="h-3 w-3" aria-hidden="true" />
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