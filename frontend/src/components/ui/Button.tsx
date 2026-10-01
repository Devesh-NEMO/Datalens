'use client';

import { forwardRef, ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'outline' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'outline', size = 'md', loading, disabled, children, ...props }, ref) => {
    const baseStyles = `
      inline-flex items-center justify-center font-medium transition-colors
      focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]
      focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-page)]
      disabled:opacity-50 disabled:cursor-not-allowed rounded-[6px]
    `;

    const variants = {
      primary: 'bg-[var(--color-text)] text-[var(--color-page)] hover:opacity-90',
      outline: 'border border-[var(--color-rule)] bg-transparent hover:bg-[var(--color-rule)] text-[var(--color-text)]',
      ghost: 'bg-transparent hover:bg-[var(--color-rule)] text-[var(--color-text)]',
    };

    const sizes = {
      sm: 'px-3 py-1.5 text-sm gap-1.5',
      md: 'px-4 py-2 text-sm gap-2',
      lg: 'px-6 py-3 text-base gap-2',
    };

    return (
      <button
        ref={ref}
        className={cn(baseStyles, variants[variant], sizes[size], className)}
        disabled={disabled || loading}
        {...props}
      >
        {loading && (
          <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" aria-hidden="true">
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
        )}
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';