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
 * The form's primary action: indigo (#6366F1) per the auth design, full width,
 * with a spinner while the request is in flight. `Button` already disables and
 * marks `aria-busy` when `loading`, so double submits are structurally
 * impossible — the guard in the page handler is a second belt, not the only one.
 */
export function SubmitButton({ children, loading, disabled }: SubmitButtonProps) {
  return (
    <Button
      type="submit"
      variant="primary"
      loading={loading}
      disabled={disabled || loading}
      className="w-full rounded-[8px] bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent)]/90 hover:text-white focus-visible:ring-[var(--color-accent)]"
    >
      {children}
    </Button>
  );
}
