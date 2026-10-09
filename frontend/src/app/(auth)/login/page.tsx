'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check } from 'lucide-react';
import { AuthCard, AuthError, EmailField, PasswordField, SubmitButton } from '@/components/auth';
import { useAuth } from '@/hooks/useAuth';
import { DEFAULT_LANDING, readNextParam, sanitizeNext } from '@/lib/auth';
import type { AnalyzeError } from '@/lib/api';

interface FormError {
  message: string;
  hint?: string;
  /** True when retrying the same credentials could plausibly work. */
  retry?: boolean;
}

/** Minimal email shape check — the server owns the real rules. */
function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/**
 * Translate a thrown auth error into what this page shows.
 *
 * 401 shows the server's message verbatim — the backend guarantees it is the
 * same sentence whether the email exists or not, so nothing leaks. 403 is the
 * deactivated-account case and gets its own copy. 503 shows the server's
 * message and hint. Anything that never reached the server is a network error
 * with a retry.
 */
function toFormError(err: unknown): FormError {
  const failure = err as Partial<AnalyzeError> | null;

  if (!failure || typeof failure.message !== 'string') {
    return { message: "Can't reach the server", retry: true };
  }
  if (failure.status === 0 || failure.code === 'network_error') {
    return { message: "Can't reach the server", retry: true };
  }
  if (failure.status === 401) {
    return { message: failure.message || 'That email and password do not match.' };
  }
  if (failure.status === 403) {
    return { message: 'This account is no longer active.' };
  }
  return { message: failure.message, hint: failure.hint };
}

export default function LoginPage() {
  const router = useRouter();
  const { status, authRequired, login } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState<FormError | null>(null);
  // Belt to the disabled button's braces: a submit that is already in flight
  // never starts a second one, however it was triggered.
  const inFlight = useRef(false);

  // Already signed in (returning user, or another tab): leave immediately.
  useEffect(() => {
    if (status === 'authenticated') {
      router.replace(sanitizeNext(readNextParam()));
    }
  }, [status, router]);

  async function attempt(): Promise<void> {
    if (inFlight.current) return;

    const errors: { email?: string; password?: string } = {};
    if (!email.trim()) errors.email = 'Enter your email address.';
    else if (!looksLikeEmail(email)) errors.email = 'Enter a valid email address.';
    if (!password) errors.password = 'Enter your password.';
    if (errors.email || errors.password) {
      setFieldErrors(errors);
      setFormError({ message: 'Check the highlighted fields and try again.' });
      return;
    }

    setFieldErrors({});
    setFormError(null);
    setSubmitting(true);
    inFlight.current = true;
    try {
      await login({ email: email.trim(), password, remember });
      // The token is stored; the password has served its purpose. Cleared on
      // success (on failure it stays so the retry action can use it — it is
      // never persisted anywhere, only held in this component's state).
      setPassword('');
      router.replace(sanitizeNext(readNextParam()));
    } catch (err) {
      setFormError(toFormError(err));
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
      title="Sign in"
      description="Welcome back. Sign in to reach your saved datasets and history."
      footer={
        <>
          New to Datalens?{' '}
          <Link
            href="/register"
            className="font-medium text-[var(--color-accent)] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/40 rounded-[4px]"
          >
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <EmailField
          id="login-email"
          value={email}
          onChange={setEmail}
          error={fieldErrors.email}
          disabled={submitting}
          autoFocus
        />
        <PasswordField
          id="login-password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          error={fieldErrors.password}
          disabled={submitting}
        />

        <div className="flex items-center justify-between">
          <label className="relative flex cursor-pointer select-none items-center text-sm text-[var(--color-text-muted)]">
            <input
              type="checkbox"
              checked={remember}
              onChange={(event) => setRemember(event.target.checked)}
              disabled={submitting}
              className="auth-checkbox peer absolute left-0 top-1/2 h-[18px] w-[18px] -translate-y-1/2 cursor-pointer appearance-none rounded-[5px] transition-colors checked:border-[#6366F1] checked:bg-[#6366F1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6366F1]/50 focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--color-page)] disabled:cursor-not-allowed disabled:opacity-50"
            />
            <span
              aria-hidden="true"
              className="pointer-events-none absolute left-[3px] top-1/2 -translate-y-1/2 text-white opacity-0 transition-opacity peer-checked:opacity-100"
            >
              <Check className="h-3 w-3" strokeWidth={3.5} />
            </span>
            <span className="pl-[26px]">Remember me</span>
          </label>
        </div>

        <AuthError
          message={formError?.message}
          hint={formError?.hint}
          onDismiss={() => setFormError(null)}
          action={
            formError?.retry ? (
              <button
                type="button"
                onClick={() => void attempt()}
                disabled={submitting}
                className="font-medium text-[var(--color-accent)] underline-offset-4 hover:underline disabled:opacity-50"
              >
                Try again
              </button>
            ) : null
          }
        />

        <SubmitButton loading={submitting}>Sign in</SubmitButton>

        {status === 'anonymous' && !authRequired ? (
          <div className="pt-1">
            <div aria-hidden="true" className="flex items-center gap-3">
              <span className="h-px flex-1 bg-[color:color-mix(in_srgb,var(--color-text)_10%,transparent)]" />
              <span className="text-xs uppercase tracking-[0.14em] text-[var(--color-text-muted)]">
                or
              </span>
              <span className="h-px flex-1 bg-[color:color-mix(in_srgb,var(--color-text)_10%,transparent)]" />
            </div>
            <Link
              href={DEFAULT_LANDING}
              className="mt-5 inline-flex h-11 w-full items-center justify-center rounded-[10px] border border-[color:color-mix(in_srgb,var(--color-text)_14%,transparent)] bg-[var(--color-surface)] text-sm font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/50"
            >
              Continue without signing in
            </Link>
            <p className="mt-2.5 text-center text-xs text-[var(--color-text-muted)]">
              Saved datasets are kept for this browser session only.
            </p>
          </div>
        ) : null}
      </form>
    </AuthCard>
  );
}
