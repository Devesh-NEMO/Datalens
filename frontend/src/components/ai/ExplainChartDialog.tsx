'use client';

import { useState } from 'react';
import { HelpCircle } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  ErrorBanner,
  Spinner,
} from '@/components/ui';
import { useAskQuestion } from '@/hooks/useAi';
import { ProvenanceBadge } from './ProvenanceBadge';
import type { AnalysisResponse } from '@/lib/api';

/**
 * "Explain this chart" dialog.
 *
 * Asks one preset question about a chart and shows the grounded answer with its
 * provenance. The question is answered by the same engine as everything else, so
 * with no model configured it still returns a correct local explanation rather
 * than an error. Only aggregate figures leave the server; the note in the footer
 * says so. If the engine did not recognise the question, that is stated instead
 * of letting a loose answer pass.
 */
export function ExplainChartDialog({
  title,
  question,
  data,
  triggerLabel = 'Explain this chart',
}: {
  title: string;
  question: string;
  data: AnalysisResponse;
  triggerLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const ask = useAskQuestion();

  const run = () => {
    ask.mutate({ payload: data, question });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        onClick={() => {
          if (!ask.data && !ask.isPending) run();
        }}
        className="app-btn app-btn-ghost app-btn-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
      >
        <HelpCircle className="h-4 w-4" aria-hidden="true" />
        {triggerLabel}
      </DialogTrigger>

      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogClose />
        </DialogHeader>

        {ask.isPending ? (
          <Spinner message="Explaining…" />
        ) : ask.isError ? (
          <div className="space-y-3">
            <ErrorBanner
              code={ask.error?.code ?? 'ai_error'}
              message={ask.error?.message ?? 'The explanation could not be generated.'}
              hint={ask.error?.hint}
            />
            <Button variant="outline" size="sm" onClick={run}>
              Retry
            </Button>
          </div>
        ) : ask.data ? (
          <div className="space-y-4">
            {ask.data.intent_matched === false ? (
              <p className="rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-sm text-[var(--color-text-muted)]">
                This question wasn&apos;t recognised as one the analysis answers, so the reply below
                is a general summary rather than a specific answer.
              </p>
            ) : null}
            <p className="whitespace-pre-line text-sm leading-relaxed text-[var(--color-text)]">
              {ask.data.answer}
            </p>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <ProvenanceBadge provenance={ask.data} />
              <span className="text-xs text-[var(--color-text-muted)]">
                Only aggregate figures are sent — never your rows.
              </span>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
