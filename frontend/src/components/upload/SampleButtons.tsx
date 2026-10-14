'use client';

import { Check, FileText } from 'lucide-react';
import { cn } from '@/lib/cn';

interface SampleButtonsProps {
  onSampleSelect?: (type: 'clean' | 'messy') => void;
  isLoading?: boolean;
  activeSample?: 'clean' | 'messy' | null;
}

/**
 * Sample cards are disabled since sample datasets have been removed.
 * A small inline notice is shown instead of the sample selector.
 */
export function SampleButtons({ onSampleSelect, isLoading, activeSample }: SampleButtonsProps) {
  const isDisabled = !onSampleSelect || isLoading;

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {/* Clean sample */}
      <button
        key="clean"
        type="button"
        onClick={() => onSampleSelect?.('clean')}
        disabled={isDisabled || isLoading}
        className={cn(
          'app-card app-card-interactive app-card-enter group flex items-center gap-3 px-4 py-3 text-left',
          'opacity-50 cursor-not-allowed'
        )}
      >
        <span
          aria-hidden="true"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-[color-mix(in_srgb,#6366F1_12%,transparent)] text-[#6366F1]"
        >
          <FileText className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-[var(--color-text)]">
            Clean sample
          </span>
          <span className="mt-0.5 block text-xs text-[var(--color-text-muted)]">
            Unavailable — sample datasets removed
          </span>
        </span>
        {activeSample === 'clean' ? (
          <Check className="h-4 w-4 shrink-0 text-[var(--color-accent)]" aria-hidden="true" />
        ) : null}
      </button>

      {/* Messy sample */}
      <button
        key="messy"
        type="button"
        onClick={() => onSampleSelect?.('messy')}
        disabled={isDisabled || isLoading}
        className={cn(
          'app-card app-card-interactive app-card-enter group flex items-center gap-3 px-4 py-3 text-left',
          'opacity-50 cursor-not-allowed'
        )}
      >
        <span
          aria-hidden="true"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-[color-mix(in_srgb,#6366F1_12%,transparent)] text-[#6366F1]"
        >
          <FileText className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-[var(--color-text)]">
            Messy sample
          </span>
          <span className="mt-0.5 block text-xs text-[var(--color-text-muted)]">
            Unavailable — sample datasets removed
          </span>
        </span>
        {activeSample === 'messy' ? (
          <Check className="h-4 w-4 shrink-0 text-[var(--color-accent)]" aria-hidden="true" />
        ) : null}
      </button>
    </div>
  );
}