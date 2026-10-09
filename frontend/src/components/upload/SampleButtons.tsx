'use client';

import { ArrowRight, Check, FileText } from 'lucide-react';
import { cn } from '@/lib/cn';
import { SAMPLE_FILES } from '@/lib/constants';

interface SampleButtonsProps {
  onSampleSelect: (type: 'clean' | 'messy') => void;
  isLoading?: boolean;
  activeSample?: 'clean' | 'messy' | null;
}

/**
 * Sample files as two clickable cards: a file icon in a tinted square, the
 * file name, a one-line description ("Clean sample" / "Messy sample:
 * duplicates, invalid dates") and an arrow that nudges on hover. The whole
 * card is a real <button>, so it needs no role shim.
 */
export function SampleButtons({ onSampleSelect, isLoading, activeSample }: SampleButtonsProps) {
  const samples = [
    { type: 'clean' as const, label: SAMPLE_FILES.clean.label, description: 'Clean sample' },
    {
      type: 'messy' as const,
      label: SAMPLE_FILES.messy.label,
      description: 'Messy sample: duplicates, invalid dates',
    },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {samples.map((sample) => {
        const active = activeSample === sample.type;
        return (
          <button
            key={sample.type}
            type="button"
            onClick={() => onSampleSelect(sample.type)}
            disabled={isLoading}
            className={cn(
              'app-card app-card-interactive app-card-enter group flex items-center gap-3 px-4 py-3 text-left',
              active && 'border-[color-mix(in_srgb,var(--color-accent)_55%,var(--color-border))]',
              isLoading && 'cursor-not-allowed opacity-60'
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
                {sample.label}
              </span>
              <span className="mt-0.5 block text-xs text-[var(--color-muted-text)]">
                {sample.description}
              </span>
            </span>
            {active ? (
              <Check className="h-4 w-4 shrink-0 text-[var(--color-accent)]" aria-hidden="true" />
            ) : (
              <ArrowRight
                className="h-4 w-4 shrink-0 text-[var(--color-muted-text)] transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-[var(--color-accent)]"
                aria-hidden="true"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}