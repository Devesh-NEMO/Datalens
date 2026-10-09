'use client';

import { useState } from 'react';
import { CircleAlert, Eye, EyeOff, Lock } from 'lucide-react';
import {
  FIELD_ERROR_CLASS,
  FIELD_HINT_CLASS,
  FIELD_LABEL_CLASS,
  FIELD_WITH_ICON_CLASS,
} from './AuthCard';

export interface PasswordFieldProps {
  /** Stable id so the label, input and messages can reference each other. */
  id: string;
  value: string;
  onChange: (value: string) => void;
  /** `current-password` when signing in, `new-password` when choosing one. */
  autoComplete: 'current-password' | 'new-password';
  label?: string;
  error?: string;
  /** Helper text, e.g. the length-based strength hint on register. */
  hint?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  required?: boolean;
  /** Show the reveal toggle. Off is occasionally right for embedded forms. */
  showToggle?: boolean;
}

/**
 * Password input with a leading Lock icon and a reveal toggle. The toggle is a
 * real button inside the field, `type="button"` so it can never submit the
 * form, with a label that states what pressing it will do.
 */
export function PasswordField({
  id,
  value,
  onChange,
  autoComplete,
  label = 'Password',
  error,
  hint,
  disabled,
  autoFocus,
  required = true,
  showToggle = true,
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;

  return (
    <div>
      <label htmlFor={id} className={FIELD_LABEL_CLASS}>
        {label}
      </label>
      <div className="relative">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]"
        >
          <Lock className="h-4 w-4" />
        </span>
        <input
          id={id}
          name={id}
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          required={required}
          minLength={required ? 8 : undefined}
          maxLength={200}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          className={`${FIELD_WITH_ICON_CLASS} ${showToggle ? 'pr-10' : ''} ${error ? 'invalid' : ''}`}
        />
        {showToggle ? (
          <button
            type="button"
            onClick={() => setVisible((current) => !current)}
            disabled={disabled}
            aria-label={visible ? 'Hide password' : 'Show password'}
            aria-pressed={visible}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-[6px] p-1 text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/50"
          >
            {visible ? (
              <EyeOff className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Eye className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        ) : null}
      </div>
      {hint ? (
        <p id={hintId} className={FIELD_HINT_CLASS}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className={FIELD_ERROR_CLASS}>
          <CircleAlert aria-hidden="true" className="mt-[2px] h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}

/**
 * A length-based strength hint, mirroring the server's rule (8–200 characters).
 * Length, not symbol theatre: a 14-character passphrase beats `P@ss1!`.
 */
export function passwordStrengthHint(password: string): string | null {
  if (!password) return null;
  if (password.length < 8) return `Too short — use at least 8 characters (${password.length}/8).`;
  if (password.length <= 9) return 'Weak — 8 to 9 characters. Longer is easier, not fussier.';
  if (password.length <= 12) return 'Fair — 10 to 12 characters.';
  if (password.length <= 16) return 'Good — 13 to 16 characters.';
  return 'Strong — 17 or more characters.';
}