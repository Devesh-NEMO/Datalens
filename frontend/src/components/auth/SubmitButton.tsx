'use client';

import type { ReactNode } from 'react';
import { Button } from '@/components/ui/Button';

export interface SubmitButtonProps {
  children: ReactNode;
  /** Shows the spinner and blocks every path to a second submit. */
  loading?: boolean;
  disabled?: boolean;
}

/**
 * The form's primary action: solid indigo (#6366F1, hover #4F46E5) with white
 * text (WCAG AA on both stops), 44px tall, a soft shadow, a 1px hover lift, a
 * pressed state, and a spinner while the request is in flight. Deliberately
 * uses the fixed indigo stops in both themes: the dark-theme accent
 * (`--color-accent` → #818CF8) does not meet AA with white text.
 */
export function SubmitButton({ children, loading, disabled }: SubmitButtonProps) {
  return (
    <Button
      type="submit"
      variant="primary"
      loading={loading}
      disabled={disabled || loading}
      className="h-11 w-full rounded-[10px] bg-[#6366F1] text-white shadow-[0_1px_2px_rgba(2,6,23,0.2),0_10px_24px_-8px_rgba(99,102,241,0.5)] transition-all duration-150 ease-out hover:-translate-y-px hover:bg-[#4F46E5] hover:text-white hover:opacity-100 hover:shadow-[0_2px_4px_rgba(2,6,23,0.16),0_14px_32px_-10px_rgba(79,70,229,0.6)] active:translate-y-0 active:bg-[#4338CA] focus-visible:ring-[#6366F1] disabled:translate-y-0 disabled:opacity-60 disabled:hover:bg-[#6366F1]"
    >
      {children}
    </Button>
  );
}