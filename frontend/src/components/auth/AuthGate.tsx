'use client';

import { useEffect, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';

/**
 * Client-side route protection.
 *
 * The token lives in Web Storage, so server middleware cannot see it — this
 * gate sits in the `(app)` layout and decides with the same session state the
 * rest of the app uses:
 *
 * - `loading` → skeleton, so protected content never flashes before the answer.
 * - `authRequired` + anonymous → replace to `/login?next=<current path>`, also
 *   rendering the skeleton (the navigation is one render away).
 * - `authRequired` false → children, sign-in or not.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { status, authRequired } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  const blocked = authRequired && status === 'anonymous';

  useEffect(() => {
    if (blocked) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [blocked, pathname, router]);

  if (status === 'loading' || blocked) {
    return (
      <div
        role="status"
        aria-label="Checking your session"
        className="min-h-screen bg-[var(--color-page)]"
      >
        <div className="fixed inset-y-0 left-0 hidden w-[var(--sidebar-w)] border-r border-[var(--color-border)] bg-[var(--color-surface)] md:block" />
        <div className="fixed left-0 right-0 top-0 h-[var(--topbar-h)] border-b border-[var(--color-border)] bg-[var(--color-surface)] md:left-[var(--sidebar-w)]" />
        <div className="space-y-4 p-6 pt-[calc(var(--topbar-h)+1.5rem)] md:pl-[calc(var(--sidebar-w)+1.5rem)]">
          <div className="h-8 w-56 animate-pulse rounded-[8px] bg-[var(--color-surface-2)]" />
          <div className="grid gap-4 md:grid-cols-3">
            <div className="h-24 animate-pulse rounded-[12px] bg-[var(--color-surface-2)]" />
            <div className="h-24 animate-pulse rounded-[12px] bg-[var(--color-surface-2)]" />
            <div className="h-24 animate-pulse rounded-[12px] bg-[var(--color-surface-2)]" />
          </div>
          <div className="h-64 animate-pulse rounded-[12px] bg-[var(--color-surface-2)]" />
          <span className="sr-only">Loading…</span>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
