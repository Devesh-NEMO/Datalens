'use client';

import Link from 'next/link';
import { ArrowRight, RefreshCw, Sparkles } from 'lucide-react';
import { Button, Card } from '@/components/ui';
import { ProvenanceBadge, type Provenance } from './ProvenanceBadge';
import type { DatasetSummary, InsightsResponse } from '@/lib/aiTypes';

/**
 * Compact "Datalens Insight" card for Overview.
 *
 * Shows the grounded executive summary plus the first few section headings from
 * the insights payload, with honest provenance and a Regenerate action. It never
 * renders an empty shell: while loading it shows a skeleton, on a first-load
 * error a small retry row, and after success an always-present body.
 */
export function AiInsightCard({
  summary,
  insights,
  loading,
  error,
  onRegenerate,
}: {
  summary?: DatasetSummary;
  insights?: InsightsResponse;
  loading: boolean;
  error?: unknown;
  onRegenerate: () => void;
}) {
  const sections = (insights?.sections ?? []).filter((s) => s.available && s.body).slice(0, 4);

  return (
    <Card accent className="p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-[8px] bg-[color-mix(in_srgb,var(--color-purple)_14%,transparent)]">
            <Sparkles className="h-4 w-4 text-[var(--color-purple)]" aria-hidden="true" />
          </span>
          <h2 className="text-base font-semibold text-[var(--color-text)]">Datalens Insight</h2>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onRegenerate}
          disabled={loading}
          aria-label="Regenerate insight"
          title="Regenerate insight"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
        </Button>
      </div>

      {loading && !summary ? (
        <div className="mt-4 space-y-3" role="status" aria-label="Generating insight">
          <div className="h-4 w-full animate-pulse rounded bg-[var(--color-surface-2)]" />
          <div className="h-4 w-11/12 animate-pulse rounded bg-[var(--color-surface-2)]" />
          <div className="h-4 w-9/12 animate-pulse rounded bg-[var(--color-surface-2)]" />
          <span className="sr-only">Generating insight…</span>
        </div>
      ) : error && !summary ? (
        <div className="mt-4 flex items-center justify-between gap-3 text-sm">
          <span className="text-[var(--color-text-muted)]">
            The written insight could not be generated right now. The figures below are unaffected.
          </span>
          <Button variant="outline" size="sm" onClick={onRegenerate}>
            Retry
          </Button>
        </div>
      ) : (
        <>
          {summary?.text ? (
            <p className="mt-4 text-sm leading-relaxed text-[var(--color-text)]">{summary.text}</p>
          ) : (
            <p className="mt-4 text-sm text-[var(--color-text-muted)]">
              No written summary is available for this analysis. The figures below are computed from
              your file.
            </p>
          )}

          {sections.length ? (
            <ul className="mt-4 space-y-2">
              {sections.map((section) => (
                <li key={section.key} className="flex gap-2 text-sm text-[var(--color-text)]">
                  <span
                    aria-hidden="true"
                    className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-accent)]"
                  />
                  <span>
                    <span className="font-medium">{section.title}.</span>{' '}
                    <span className="text-[var(--color-text-muted)]">
                      {firstSentence(section.body)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <ProvenanceBadge provenance={(summary ?? insights ?? {}) as Provenance} />
            <Link
              href="/ai"
              className="app-btn app-btn-outline app-btn-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
            >
              Ask Datalens
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </>
      )}
    </Card>
  );
}

/** First sentence of a section body, so the bullet stays one line-ish. */
function firstSentence(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^(.*?[.!?])(\s|$)/);
  const sentence = match ? match[1] : trimmed;
  return sentence.length > 180 ? `${sentence.slice(0, 177)}…` : sentence;
}
