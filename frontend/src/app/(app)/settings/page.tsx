'use client';

import Link from 'next/link';
import { LogOut, Moon, Sun } from 'lucide-react';
import { Button, Card, Spinner } from '@/components/ui';
import { PageContainer, PageHeader } from '@/components/app';
import { useAuth } from '@/hooks/useAuth';
import { useTheme } from '@/hooks/useTheme';
import { initials } from '@/components/shell/AccountMenu';
import { useAiStatus, useTestAiConnection } from '@/hooks/useAi';
import { cn } from '@/lib/cn';

/** What the account section shows for an anonymous visitor with auth optional. */
function AnonymousAccount() {
  return (
    <div className="flex flex-col items-start gap-3">
      <p className="text-sm text-[var(--color-text-muted)]">
        You&apos;re not signed in. Analyses work without an account; sign in to keep
        saved datasets across browser sessions.
      </p>
      <Link
        href="/login"
        className="app-btn app-btn-primary app-btn-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6366F1]"
      >
        Sign in
      </Link>
    </div>
  );
}

/** Light/Dark segmented control wired to the shared ThemeProvider. */
function AppearanceSection() {
  const { theme, setTheme } = useTheme();

  return (
    <div
      role="group"
      aria-label="Theme"
      className="flex w-fit rounded-[10px] border border-[var(--color-border)] bg-[var(--color-page)] p-1"
    >
      {(['light', 'dark'] as const).map((mode) => {
        const active = theme === mode;
        return (
          <button
            key={mode}
            type="button"
            onClick={() => setTheme(mode)}
            aria-pressed={active}
            className={cn(
              'flex items-center gap-2 rounded-[8px] px-4 py-2 text-sm font-medium transition-all duration-150',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6366F1]',
              active
                ? 'border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] shadow-sm'
                : 'border border-transparent text-[var(--color-muted-text)] hover:text-[var(--color-text)]'
            )}
          >
            {mode === 'light' ? (
              <Sun className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Moon className="h-4 w-4" aria-hidden="true" />
            )}
            {mode === 'light' ? 'Light' : 'Dark'}
          </button>
        );
      })}
    </div>
  );
}

export default function SettingsPage() {
  const { user, status, logout } = useAuth();

  return (
    <PageContainer>
      <PageHeader
        title="Settings"
        description="Your account and how Datalens looks on this device."
      />

      <div className="mt-8 max-w-2xl space-y-8">
        <AISection />
        <section aria-labelledby="account-heading">
          <h2 id="account-heading" className="label-xs">
            Account
          </h2>
          <Card className="mt-3 px-6 py-6">
            {status === 'loading' ? (
              <div className="h-16 w-full animate-pulse rounded-[8px] bg-[var(--color-surface-2)]" />
            ) : !user ? (
              <AnonymousAccount />
            ) : (
              <div className="flex items-start gap-4">
                <span
                  aria-hidden="true"
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#6366F1] text-sm font-semibold text-white"
                >
                  {initials(user)}
                </span>
                <dl className="min-w-0 flex-1 space-y-3">
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-widest text-[var(--color-muted-text)]">
                      Display name
                    </dt>
                    <dd className="mt-0.5 truncate text-sm font-medium text-[var(--color-text)]">
                      {user.display_name?.trim() || '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-widest text-[var(--color-muted-text)]">
                      Email
                    </dt>
                    <dd className="mt-0.5 truncate text-sm text-[var(--color-text)]">{user.email}</dd>
                  </div>
                  <div className="pt-2">
                    <Button variant="danger" size="sm" onClick={() => void logout()}>
                      <LogOut className="h-4 w-4" aria-hidden="true" />
                      Sign out
                    </Button>
                  </div>
                </dl>
              </div>
            )}
          </Card>
        </section>

        <section aria-labelledby="appearance-heading">
          <h2 id="appearance-heading" className="label-xs">
            Appearance
          </h2>
          <Card className="mt-3 px-6 py-6">
            <p className="text-sm text-[var(--color-muted-text)]">
              Choose how Datalens looks on this device. Your choice is remembered in
              this browser.
            </p>
            <div className="mt-4">
              <AppearanceSection />
            </div>
          </Card>
        </section>
      </div>
    </PageContainer>
  );
}
function AISection() {
  const { data: status, isLoading, refetch } = useAiStatus();
  const test = useTestAiConnection();

  return (
    <section aria-labelledby="ai-heading">
      <Card className="p-6">
        <h2 id="ai-heading" className="text-lg font-semibold">AI</h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Read-only status of AI configuration. The API key is set in the backend environment.
        </p>
        <dl className="mt-4 grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
          <div>
            <dt className="text-[var(--color-text-muted)]">Enabled</dt>
            <dd className="font-medium">{status?.enabled ? 'Yes' : 'No'}</dd>
          </div>
          <div>
            <dt className="text-[var(--color-text-muted)]">Configured</dt>
            <dd className="font-medium">{status?.configured ? 'Yes' : 'No'}</dd>
          </div>
          <div>
            <dt className="text-[var(--color-text-muted)]">Provider</dt>
            <dd className="font-medium">{status?.provider || '-'}</dd>
          </div>
          <div>
            <dt className="text-[var(--color-text-muted)]">Model</dt>
            <dd className="font-medium">{status?.model || '-'}</dd>
          </div>
          <div className="md:col-span-2">
            <dt className="text-[var(--color-text-muted)]">Base URL</dt>
            <dd className="font-medium break-all">{status?.base_url || '-'}</dd>
          </div>
          <div>
            <dt className="text-[var(--color-text-muted)]">Local fallback enabled</dt>
            <dd className="font-medium">{status?.local_fallback_enabled ? 'Yes' : 'No'}</dd>
          </div>
        </dl>
        <div className="mt-4 flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>Refresh</Button>
          <Button variant="primary" size="sm" onClick={() => test.mutate()} disabled={test.isPending || !status?.enabled}>Test connection</Button>
          {test.isPending ? <Spinner className="h-4 w-4" /> : null}
        </div>
        {test.data ? (
          <div className="mt-3 text-sm text-[var(--color-text-muted)]">
            {test.data.status}: {test.data.message} {test.data.latency_ms ? `(${test.data.latency_ms}ms)` : ''}
          </div>
        ) : test.error ? (
          <div className="mt-3 text-sm text-red-600">{(test.error as { message?: string })?.message || 'Test failed'}</div>
        ) : null}
        <p className="mt-3 text-xs text-[var(--color-text-muted)]">The API key is set in backend/.env and the server must be restarted after changes.</p>
      </Card>
    </section>
  );
}
