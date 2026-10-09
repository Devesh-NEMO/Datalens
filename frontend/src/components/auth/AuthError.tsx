'use client';

import type { ReactNode } from 'react';
import { CircleAlert, X } from 'lucide-react';

export interface AuthErrorProps {
  /** The message to show. When empty the live region stays mounted, silent. */
  message?: string | null;
  /** Secondary line — the server's `hint`, or a next step. */
  hint?: string | null;
  /** A recovery action, e.g. a retry button or a link to sign in. */
  action?: ReactNode;
  /** Dismisses the banner (the caller owns the error state). */
  onDismiss?: () => void;
}

/**
 * Form-level error banner at the top of the card, always mounted as an
 * `aria-live="polite"` region so screen readers register it before content
 * arrives. Field-level errors live next to their input; this carries what went
 * wrong overall, with an icon, the optional hint, an action, and a dismiss
 * button.
 */
export function AuthError({ message, hint, action, onDismiss }: AuthErrorProps) {
  if (!message) return <div aria-live="polite" />;

  return (
    <div
      role="alert"
      aria-live="polite"
      className="relative rounded-[10px] border border-[color:color-mix(in_srgb,var(--color-critical)_45%,transparent)] bg-[color:color-mix(in_srgb,var(--color-critical)_9%,transparent)] py-3 pl-3.5 pr-10"
    >
      <div className="flex items-start gap-2.5">
        <CircleAlert
          aria-hidden="true"
          className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-critical)]"
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium leading-relaxed text-[var(--color-text)]">{message}</p>
          {hint ? (
            <p className="mt-1 text-xs leading-relaxed text-[var(--color-text-muted)]">{hint}</p>
          ) : null}
          {action ? <div className="mt-2 text-sm">{action}</div> : null}
        </div>
      </div>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss error"
          className="absolute right-2 top-2 rounded-md p-1 text-[var(--color-text-muted)] transition-colors hover:bg-[color:color-mix(in_srgb,var(--color-text)_6%,transparent)] hover:text-[var(--color-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/50"
        >
          <X aria-hidden="true" className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}