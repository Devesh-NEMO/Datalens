'use client';

import { cn } from '@/lib/cn';

interface StatNumberProps {
  value: string | number;
  label: string;
  className?: string;
  /** Optional status word, colored by the ABC palette but also spelled out. */
  status?: string;
  statusTone?: 'positive' | 'neutral' | 'negative';
}

const TONE: Record<NonNullable<StatNumberProps['statusTone']>, string> = {
  positive: 'text-[var(--color-class-a)]',
  neutral: 'text-[var(--color-muted-text)]',
  negative: 'text-[var(--color-class-c)]',
};

export function StatNumber({ value, label, className, status, statusTone = 'neutral' }: StatNumberProps) {
  return (
    <div className={cn('flex flex-col items-start', className)}>
      <span className="font-serif text-stat leading-none text-[var(--color-text)]">{value}</span>
      <span className="label-xs mt-2">{label}</span>
      {status && (
        <span className={cn('text-xs mt-1', TONE[statusTone])}>{status}</span>
      )}
    </div>
  );
}
