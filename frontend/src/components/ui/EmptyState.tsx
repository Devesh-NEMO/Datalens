'use client';

import { ArrowRight, ChartPie, Sparkles, Upload, Zap } from 'lucide-react';
import { Dropzone } from '@/components/upload/Dropzone';
import { DatabaseHelp } from '@/components/upload/DatabaseHelp';
import { SampleButtons } from '@/components/upload/SampleButtons';
import { EMPTY_STATE_DESCRIPTION, TAGLINE } from '@/lib/constants';

interface EmptyStateProps {
  onUpload: (file: File) => void;
  onSampleSelect: (type: 'clean' | 'messy') => void;
  isLoading?: boolean;
}

/**
 * The Overview upload state: a compact sans-serif hero (an indigo "Sales
 * analytics" pill, a short headline, a one-line subtitle) with the dropzone
 * card and the sample-file cards sitting right underneath so everything fits
 * above the fold. A slim three-step strip explains what happens next.
 */
export function EmptyState({ onUpload, onSampleSelect, isLoading = false }: EmptyStateProps) {
  return (
    <div className="flex min-h-[calc(100vh-var(--topbar-h))] flex-col items-center justify-center gap-9 px-6 py-12">
      <div className="app-card-enter max-w-2xl space-y-4 text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[color-mix(in_srgb,#6366F1_35%,transparent)] bg-[color-mix(in_srgb,#6366F1_10%,transparent)] px-3 py-1 text-xs font-semibold text-[#6366F1]">
          <Zap className="h-3.5 w-3.5" aria-hidden="true" />
          Sales analytics
        </span>
        <h1 className="text-balance text-[2.375rem] font-semibold leading-[1.1] tracking-tight text-[var(--color-text)]">
          {TAGLINE}
        </h1>
        <p className="mx-auto max-w-xl text-[15px] leading-relaxed text-[var(--color-muted-text)]">
          {EMPTY_STATE_DESCRIPTION}
        </p>
      </div>

      <div className="app-card-enter w-full max-w-2xl space-y-4">
        <Dropzone onFileSelect={onUpload} isLoading={isLoading} />
        <SampleButtons onSampleSelect={onSampleSelect} isLoading={isLoading} />
      </div>

      {/* Slim three-step strip: what happens after the upload. */}
      <ol className="app-card-enter flex flex-col items-center gap-1.5 text-xs text-[var(--color-muted-text)] sm:flex-row sm:gap-2.5">
        <li className="flex items-center gap-1.5">
          <Upload className="h-3.5 w-3.5 text-[var(--color-accent)]" aria-hidden="true" />
          1 · Upload
        </li>
        <ArrowRight className="hidden h-3 w-3 sm:block" aria-hidden="true" />
        <li className="flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-[var(--color-accent)]" aria-hidden="true" />
          2 · We clean &amp; analyze
        </li>
        <ArrowRight className="hidden h-3 w-3 sm:block" aria-hidden="true" />
        <li className="flex items-center gap-1.5">
          <ChartPie className="h-3.5 w-3.5 text-[var(--color-accent)]" aria-hidden="true" />
          3 · Explore insights
        </li>
      </ol>

      <div className="app-card-enter">
        <DatabaseHelp />
      </div>
    </div>
  );
}