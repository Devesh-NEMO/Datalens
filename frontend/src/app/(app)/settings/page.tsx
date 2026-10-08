'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/hooks/useAuth';

/** What the account section shows for an anonymous visitor with auth optional. */
function AnonymousAccount() {
  return (
    <div className="flex flex-col items-start gap-3">
      <p className="text-sm text-[var(--color-text-muted)]">
        You&apos;re not signed in. Analyses work without an account; sign in to keep
        saved datasets across browser sessions.
      </p>
      <Link href="/login">
        <Button variant="outline" size="sm">
          Sign in
        </Button>
      </Link>
    </div>
  );
}

export default function SettingsPage() {
  const { user, status, logout } = useAuth();

  return (
    <div className="max-w-[760px] mx-auto px-4 py-8">
      <h1 className="text-2xl font-semibold text-[var(--color-text)]">Settings</h1>

      <section aria-labelledby="account-heading" className="mt-8">
        <h2
          id="account-heading"
          className="text-xs uppercase tracking-widest text-[var(--color-muted-text)]"
        >
          Account
        </h2>

        <div className="mt-3 rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
          {status === 'loading' ? (
            <div className="h-16 w-full animate-pulse rounded-[8px] bg-[var(--color-surface-2)]" />
          ) : !user ? (
            <AnonymousAccount />
          ) : (
            <dl className="space-y-4">
              <div>
                <dt className="text-sm font-medium text-[var(--color-text-muted)]">Email</dt>
                <dd className="mt-0.5 text-sm text-[var(--color-text)]">{user.email}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-[var(--color-text-muted)]">
                  Display name
                </dt>
                <dd className="mt-0.5 text-sm text-[var(--color-text)]">
                  {user.display_name?.trim() || '—'}
                </dd>
              </div>
              <div className="pt-2">
                <Button variant="outline" size="sm" onClick={() => void logout()}>
                  Sign out
                </Button>
              </div>
            </dl>
          )}
        </div>
      </section>
    </div>
  );
}
