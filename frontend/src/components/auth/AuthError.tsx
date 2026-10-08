'use client';

import type { ReactNode } from 'react';

export interface AuthErrorProps {
  /** The message to show. When empty the live region stays mounted, silent. */
  message?: string | null;
  /** Secondary line — the server's `hint`, or a next step. */
  hint?: string | null;
  /** A recovery action, e.g. a retry button or a link to sign in. */
  action?: ReactNode;
}

/**
 * Form-level error region, always mounted so screen readers register the live
 * region before content arrives (`aria-live="polite"` — errors here are never
 * urgent enough to interrupt). Field-level errors live next to their input;
 * this carries what went wrong overall.
 */
export function AuthError({ message, hint, action }: AuthErrorProps) {
  if (!message) return <div aria-live="polite" />;

  return (
    <div
      role="alert"
      aria-live="polite"
      className="rounded-[8px] border border-[var(--color-critical)]/40 bg-[var(--color-critical)]/10 px-3 py-2.5"
    >
      <p className="text-sm font-medium text-[var(--color-text)]">{message}</p>
      {hint ? <p className="mt-1 text-xs text-[var(--color-text-muted)]">{hint}</p> : null}
      {action ? <div className="mt-2 text-sm">{action}</div> : null}
    </div>
  );
}
