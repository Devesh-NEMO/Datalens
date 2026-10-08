'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AuthCard,
  AuthError,
  EmailField,
  PasswordField,
  SubmitButton,
  passwordStrengthHint,
} from '@/components/auth';
import { useAuth } from '@/hooks/useAuth';
import { readNextParam, sanitizeNext } from '@/lib/auth';
import type { AnalyzeError } from '@/lib/api';

interface FormError {
  message: string;
  hint?: string;
}

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/**
 * Server-aligned error copy. 409 links back to sign-in (the account exists —
 * that is exactly what the user just proved by trying). 422 shows the server's
 * message. 503 shows message plus hint.
 */
function toFormError(err: unknown): FormError {
  const failure = err as Partial<AnalyzeError> | null;
  if (!failure || typeof failure.message !== 'string' || failure.status === 0) {
    return { message: "Can't reach the server", hint: 'Check your connection and try again.' };
  }
  if (failure.status === 409) {
    return { message: failure.message || 'An account with that email already exists' };
  }
  if (failure.status === 503) {
    return { message: failure.message, hint: failure.hint };
  }
  return { message: failure.message, hint: failure.hint };
}

export default function RegisterPage() {
  const router = useRouter();
  const { status, register } = useAuth();

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{
    displayName?: string;
    email?: string;
    password?: string;
    confirm?: string;
  }>({});
  const [formError, setFormError] = useState<FormError | null>(null);
  const [isDuplicate, setIsDuplicate] = useState(false);
  const inFlight = useRef(false);

  // Already signed in (returning user, or another tab): leave immediately.
  useEffect(() => {
    if (status === 'authenticated') {
      router.replace(sanitizeNext(readNextParam()));
    }
  }, [status, router]);

  const strengthHint = passwordStrengthHint(password);

  async function attempt(): Promise<void> {
    if (inFlight.current) return;

    const errors: typeof fieldErrors = {};
    if (displayName.length > 80) errors.displayName = 'Keep the display name to 80 characters or fewer.';
    if (!email.trim()) errors.email = 'Enter your email address.';
    else if (!looksLikeEmail(email)) errors.email = 'Enter a valid email address.';
    // Mirror the server: 8–200 characters, judged by length alone.
    if (password.length < 8) errors.password = 'Password must be at least 8 characters.';
    else if (password.length > 200) errors.password = 'Password must be 200 characters or fewer.';
    if (!confirm) errors.confirm = 'Confirm your password.';
    else if (password !== confirm) errors.confirm = "Passwords don't match.";

    if (Object.values(errors).some(Boolean)) {
      setFieldErrors(errors);
      setFormError({ message: 'Check the highlighted fields and try again.' });
      return;
    }

    setFieldErrors({});
    setFormError(null);
    setIsDuplicate(false);
    setSubmitting(true);
    inFlight.current = true;
    try {
      // 201 signs the user in immediately with the returned token, then leaves.
      await register({ email: email.trim(), password, displayName });
      setPassword('');
      setConfirm('');
      router.replace(sanitizeNext(readNextParam()));
    } catch (err) {
      const mapped = toFormError(err);
      setFormError(mapped);
      setIsDuplicate((err as Partial<AnalyzeError> | null)?.status === 409);
      // The password stays in state on failure only so a retry does not force
      // retyping everything; it is never written anywhere but the request body.
    } finally {
      setSubmitting(false);
      inFlight.current = false;
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void attempt();
  }

  return (
    <AuthCard
      title="Create your account"
      description="One account, your analyses kept together across visits."
      footer={
        <>
          Already have an account?{' '}
          <Link
            href="/login"
            className="font-medium text-[var(--color-accent)] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/40 rounded-[4px]"
          >
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <div>
          <label
            htmlFor="register-name"
            className="block mb-1.5 text-sm font-medium text-[var(--color-text)]"
          >
            Display name{' '}
            <span className="font-normal text-[var(--color-text-muted)]">(optional)</span>
          </label>
          <input
            id="register-name"
            name="displayName"
            type="text"
            autoComplete="name"
            maxLength={80}
            value={displayName}
            disabled={submitting}
            onChange={(event) => setDisplayName(event.target.value)}
            aria-invalid={Boolean(fieldErrors.displayName)}
            aria-describedby={fieldErrors.displayName ? 'register-name-error' : undefined}
            className="w-full rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] transition-colors focus:border-[var(--color-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/40 disabled:opacity-60"
          />
          {fieldErrors.displayName ? (
            <p id="register-name-error" className="mt-1.5 text-xs text-[var(--color-critical)]">
              {fieldErrors.displayName}
            </p>
          ) : null}
        </div>

        <EmailField
          id="register-email"
          value={email}
          onChange={setEmail}
          error={fieldErrors.email}
          disabled={submitting}
        />
        <PasswordField
          id="register-password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          hint={strengthHint ?? undefined}
          error={fieldErrors.password}
          disabled={submitting}
        />
        <PasswordField
          id="register-confirm"
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
          label="Confirm password"
          error={fieldErrors.confirm}
          disabled={submitting}
          showToggle={false}
        />

        <AuthError
          message={formError?.message}
          hint={formError?.hint}
          action={
            isDuplicate ? (
              <Link
                href="/login"
                className="font-medium text-[var(--color-accent)] underline-offset-4 hover:underline"
              >
                Sign in instead
              </Link>
            ) : null
          }
        />

        <SubmitButton loading={submitting}>Create account</SubmitButton>
      </form>
    </AuthCard>
  );
}
