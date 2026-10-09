'use client';

import Link from 'next/link';
import { LogOut, Moon, Sun } from 'lucide-react';
import { Button, Card } from '@/components/ui';
import { PageContainer, PageHeader } from '@/components/app';
import { useAuth } from '@/hooks/useAuth';
import { useTheme } from '@/hooks/useTheme';
import { initials } from '@/components/shell/AccountMenu';
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