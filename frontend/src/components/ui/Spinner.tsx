'use client';

import { cn } from '@/lib/cn';

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  message?: string;
}

const SIZES = {
  sm: 'h-4 w-4',
  md: 'h-8 w-8',
  lg: 'h-12 w-12',
};

export function Spinner({ size = 'md', className, message }: SpinnerProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3', className)} role="status" aria-live="polite" aria-label={message || 'Loading'}>
      <svg className={cn('animate-spin text-[var(--color-accent)]', SIZES[size])} viewBox="0 0 24 24" aria-hidden="true">
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="3"
          fill="none"
        />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
        />
      </svg>
      {message && <span className="text-sm text-[var(--color-muted-text)]">{message}</span>}
    </div>
  );
}