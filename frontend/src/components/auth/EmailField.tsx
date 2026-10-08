'use client';

import {
  FIELD_ERROR_CLASS,
  FIELD_HINT_CLASS,
  FIELD_LABEL_CLASS,
  INPUT_CLASS,
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

/** Real `<label>`, `autocomplete="email"`, `aria-invalid` + `aria-describedby`. */
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
        className={INPUT_CLASS}
      />
      {hint ? (
        <p id={hintId} className={FIELD_HINT_CLASS}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className={FIELD_ERROR_CLASS}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
