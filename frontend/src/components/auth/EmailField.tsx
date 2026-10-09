'use client';

import { CircleAlert, Mail } from 'lucide-react';
import {
  FIELD_ERROR_CLASS,
  FIELD_HINT_CLASS,
  FIELD_LABEL_CLASS,
  FIELD_WITH_ICON_CLASS,
} from './AuthCard';

export interface EmailFieldProps {
  /** Stable id so the label, input and messages can reference each other. */
  id: string;
  value: string;
  onChange: (value: string) => void;
  /** Validation or server message for this field, if any. */
  error?: string;
  /** Optional helper text, announced before the value. */
  hint?: string;
  disabled?: boolean;
  /** Autofocus only on the login page — register has a field above it. */
  autoFocus?: boolean;
}

/** Real `<label>`, `autocomplete="email"`, `aria-invalid` + `aria-describedby`,
 *  a leading Mail icon, and the error hint next to the field. */
export function EmailField({
  id,
  value,
  onChange,
  error,
  hint,
  disabled,
  autoFocus,
}: EmailFieldProps) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;

  return (
    <div>
      <label htmlFor={id} className={FIELD_LABEL_CLASS}>
        Email
      </label>
      <div className="relative">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]"
        >
          <Mail className="h-4 w-4" />
        </span>
        <input
          id={id}
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoFocus={autoFocus}
          required
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          placeholder="you@example.com"
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          className={`${FIELD_WITH_ICON_CLASS} ${error ? 'invalid' : ''}`}
        />
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