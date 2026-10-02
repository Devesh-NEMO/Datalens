'use client';

import { cn } from '@/lib/cn';

interface StatNumberProps {
  value: string | number;
  label: string;
  className?: string;
  /** Optional status word, coloured by a dot but always spelled out in text. */
  status?: string;
  statusTone?: 'positive' | 'neutral' | 'negative';
  /**
   * Full-sentence description, usually the exact value behind a rounded one.
   * Doubles as the tooltip and as what assistive tech reads for the figure.
   */
  title?: string;
}

/**
 * Tone colours, used for the dot only.
 *
 * The word itself is always in the muted text colour. These ABC greens and reds
 * clear 3:1 against the page, which is enough for a graphic and for large text,
 * but not the 4.5:1 that 12px body text needs — the light theme's Class A green
 * measures 3.07:1. So the colour moves to a dot, the same pattern ClassBadge
 * uses for a class letter, and the readable word carries the meaning.
 */
const TONE_DOT: Record<NonNullable<StatNumberProps['statusTone']>, string> = {
  positive: 'bg-[var(--color-class-a)]',
  neutral: 'bg-[var(--color-muted-text)]',
  negative: 'bg-[var(--color-class-c)]',
};

export function StatNumber({
  value,
  label,
  className,
  status,
  statusTone = 'neutral',
  title,
}: StatNumberProps) {
  return (
    <div className={cn('flex flex-col items-start', className)} title={title}>
      <span className="font-serif text-stat leading-none text-[var(--color-text)]">{value}</span>
      <span className="label-xs mt-2">{label}</span>
      {status && (
        <span className="mt-1 inline-flex items-center gap-1.5 text-xs text-[var(--color-muted-text)]">
          {/* Decorative: the word beside it already says what the tone means. */}
          <span
            aria-hidden="true"
            className={cn('h-1.5 w-1.5 flex-shrink-0 rounded-full', TONE_DOT[statusTone])}
          />
          {status}
        </span>
      )}
    </div>
  );
}
