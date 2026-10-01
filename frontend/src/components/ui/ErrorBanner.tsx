'use client';

import { cn } from '@/lib/cn';
import { X } from 'lucide-react';

interface ErrorBannerProps {
  code: string;
  message: string;
  hint?: string;
  onDismiss?: () => void;
}

export function ErrorBanner({ code, message, hint, onDismiss }: ErrorBannerProps) {
  return (
    <div
      className={cn(
        'flex gap-3 p-4 rounded-[6px] border',
        'bg-[var(--color-rule)]/50 border-[var(--color-class-c)]',
        'text-[var(--color-text)]'
      )}
      role="alert"
      aria-live="assertive"
    >
      <div className="flex-1 space-y-1">
        <div className="flex items-start justify-between gap-3">
          <div>
            <span className="text-xs font-mono text-[var(--color-class-c)] mr-2">{code}</span>
            <span className="font-medium">{message}</span>
          </div>
          {onDismiss && (
            <button
              onClick={onDismiss}
              className="p-1 hover:bg-[var(--color-page)] rounded transition-colors text-[var(--color-muted-text)]"
              aria-label="Dismiss error"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
        {hint && (
          <p className="text-sm text-[var(--color-muted-text)]">{hint}</p>
        )}
      </div>
    </div>
  );
}