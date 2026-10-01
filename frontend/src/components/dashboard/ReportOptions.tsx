'use client';

import { useEffect, useId, useState } from 'react';
import { FileText } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/Dialog';
import { useDownload } from '@/hooks/useDownload';
import { triggerDownload } from '@/lib/download';
import { DOWNLOAD_COPY } from '@/lib/constants';
import { buildReport, type BuildReportOptions } from '@/lib/report/buildReport';
import { arePdfFontsAvailable } from '@/lib/report/fonts';
import type { ReportSettings } from '@/lib/report/reportSections';

type SectionKey =
  | 'includeSummary'
  | 'includeQuality'
  | 'includeSettings'
  | 'includeCharts'
  | 'includeLists'
  | 'includeRankingTable';

interface ReportOptionsProps {
  /** Everything the report needs except the user's section choices. */
  buildOptions: Omit<BuildReportOptions, 'settings'>;
  /** Base settings; the toggles below override the flags on top of it. */
  baseSettings: ReportSettings;
  /** Styles for the trigger button. */
  className?: string;
  /** Set false to render the panel without a trigger of its own. */
  withTrigger?: boolean;
}

const SECTION_TOGGLES: ReadonlyArray<{ key: SectionKey; label: string; hint: string }> = [
  { key: 'includeSummary', label: 'Summary', hint: 'Pareto insight and the four headline numbers' },
  { key: 'includeQuality', label: 'Quality and cleaning', hint: 'Every warning found while reading the file' },
  { key: 'includeSettings', label: 'Settings used', hint: 'Columns chosen and Top N' },
  { key: 'includeCharts', label: 'Charts', hint: 'Every chart, with its title and caption' },
  { key: 'includeLists', label: 'Most and least important', hint: 'Both product lists' },
  { key: 'includeRankingTable', label: 'Ranking table', hint: 'Full product ranking, paginated' },
];

/**
 * The report options dialog.
 *
 * Every section starts included, so the common case is one click: open, confirm,
 * download. The toggles exist for someone who wants a shorter document or who
 * would rather not hand over the whole product list.
 */
export function ReportOptions({
  buildOptions,
  baseSettings,
  className,
  withTrigger = true,
}: ReportOptionsProps) {
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const { run, isPreparing, failure, liveMessage, dismiss } = useDownload();
  const [sections, setSections] = useState<Record<SectionKey, boolean>>({
    includeSummary: true,
    includeQuality: true,
    includeSettings: true,
    includeCharts: true,
    includeLists: true,
    includeRankingTable: true,
  });
  // The table follows what is on screen by default. A user who filtered the
  // table down to a handful of rows and then exported everything would be
  // surprised.
  const [allRows, setAllRows] = useState(false);

  // Checked when the panel opens, so the warning is on screen before the user
  // commits to a download rather than after the report has already been built.
  const [fontsMissing, setFontsMissing] = useState(false);
  useEffect(() => {
    if (!open) return;
    let active = true;
    void arePdfFontsAvailable().then((available) => {
      if (active) setFontsMissing(!available);
    });
    return () => {
      active = false;
    };
  }, [open]);

  const nothingSelected = Object.values(sections).every((enabled) => !enabled);

  const toggle = (key: SectionKey) => {
    setSections((current) => ({ ...current, [key]: !current[key] }));
  };

  const download = async () => {
    const result = await buildReport({
      ...buildOptions,
      settings: { ...baseSettings, ...sections, tableScopeAll: allRows },
    });
    triggerDownload(result.blob, result.filename);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {withTrigger ? (
        <DialogTrigger
          onClick={() => setOpen(true)}
          className={cn(
            'inline-flex items-center gap-2 rounded-[6px] px-3 py-2 text-sm text-[var(--color-muted-text)]',
            'transition-colors hover:text-[var(--color-text)]',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]',
            className
          )}
        >
          <FileText className="h-4 w-4" aria-hidden="true" />
          Download full report
        </DialogTrigger>
      ) : null}
      <DialogContent titleId={titleId} className="max-w-xl">
        <DialogHeader>
          <DialogTitle id={titleId}>Download full report</DialogTitle>
          <DialogClose />
        </DialogHeader>

        <div className="space-y-5">
          <fieldset>
            <legend className="mb-2 text-xs uppercase tracking-widest text-[var(--color-muted-text)]">
              Sections
            </legend>
            <ul className="grid gap-1 sm:grid-cols-2">
              {SECTION_TOGGLES.map(({ key, label, hint }) => (
                <li key={key}>
                  <label className="flex cursor-pointer items-start gap-2 rounded-[6px] px-2 py-1.5 hover:bg-[var(--color-rule)]">
                    <input
                      type="checkbox"
                      checked={sections[key]}
                      onChange={() => toggle(key)}
                      className="mt-1"
                    />
                    <span>
                      <span className="block text-sm text-[var(--color-text)]">{label}</span>
                      <span className="block text-xs text-[var(--color-muted-text)]">{hint}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>

          <fieldset>
            <legend className="mb-2 text-xs uppercase tracking-widest text-[var(--color-muted-text)]">
              Ranking table contents
            </legend>
            <div className="space-y-1">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--color-text)]">
                <input
                  type="radio"
                  name="datalens-table-scope"
                  checked={!allRows}
                  onChange={() => setAllRows(false)}
                />
                The rows currently filtered and sorted on screen
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--color-text)]">
                <input
                  type="radio"
                  name="datalens-table-scope"
                  checked={allRows}
                  onChange={() => setAllRows(true)}
                />
                Every product in the file
              </label>
            </div>
          </fieldset>

          {fontsMissing && (
            // Not an error: the report is still produced, in Helvetica. Worth
            // saying because product names outside Latin-1 will not render.
            <p
              role="status"
              className="rounded-[6px] border border-[var(--color-rule)] bg-[var(--color-rule)]/40 p-3 text-sm text-[var(--color-muted-text)]"
            >
              {DOWNLOAD_COPY.fontFallbackWarning}
            </p>
          )}

          {nothingSelected && (
            <p role="status" className="text-sm text-[var(--color-muted-text)]">
              Select at least one section to download a report.
            </p>
          )}

          {failure && (
            <div
              role="alert"
              className="rounded-[6px] border border-[var(--color-class-c)] p-3 text-sm"
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

          {/* Announcements for the download itself, which happens here rather
              than in the chart menu. */}
          <span className="sr-only" role="status" aria-live="polite">
            {liveMessage}
          </span>
        </div>

        <DialogFooter>
          <DialogClose />
          <Button
            onClick={() => void run(download)}
            disabled={isPreparing || nothingSelected}
          >
            <FileText className="mr-2 h-4 w-4" aria-hidden="true" />
            {isPreparing ? DOWNLOAD_COPY.busyLabel : DOWNLOAD_COPY.downloadReport}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
