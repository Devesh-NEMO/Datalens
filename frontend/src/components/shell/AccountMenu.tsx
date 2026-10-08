'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, LogOut, Settings } from 'lucide-react';
import { useAuth, type AuthContextValue } from '@/hooks/useAuth';

/** First letters of a display name, or the email's first letter as a fallback. */
function initials(user: AuthContextValue['user']): string {
  if (!user) return '?';
  const source = (user.display_name || user.email).trim();
  const words = source.split(/[\s@._-]+/).filter(Boolean);
  return words
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');
}

function displayName(user: AuthContextValue['user']): string {
  if (!user) return '';
  return user.display_name?.trim() || user.email;
}

/**
 * The account affordance in the sidebar footer: avatar + name + a small menu
 * (Settings, Sign out) when signed in, a single "Sign in" button when auth is
 * optional and nobody is signed in. Renders nothing while auth is required —
 * the AuthGate is already sending that visitor to /login.
 */
export function AccountMenu() {
  const { user, status, authRequired, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Escape closes and returns focus to the trigger; outside clicks close.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
        containerRef.current?.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')?.focus();
      }
    }
    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  if (status === 'anonymous' && !authRequired) {
    return (
      <Link
        href="/login"
        className="inline-flex items-center justify-center rounded-[8px] border border-[var(--color-border)] px-3 py-1.5 text-sm font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/40"
      >
        Sign in
      </Link>
    );
  }

  if (!user) return null;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex max-w-[220px] items-center gap-2 rounded-[8px] px-2 py-1.5 text-left transition-colors hover:bg-[var(--color-surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/40"
      >
        <span
          aria-hidden="true"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent)] text-xs font-semibold text-white"
        >
          {initials(user)}
        </span>
        <span className="truncate text-sm font-medium text-[var(--color-text)]">
          {displayName(user)}
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-muted)]" aria-hidden="true" />
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="Account"
          className="absolute bottom-full right-0 z-40 mb-1 w-52 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] p-1 shadow-sm"
        >
          <Link
            href="/settings"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex w-full items-center gap-2 rounded-[6px] px-2.5 py-2 text-sm text-[var(--color-text)] transition-colors hover:bg-[var(--color-surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/40"
          >
            <Settings className="h-4 w-4 text-[var(--color-text-muted)]" aria-hidden="true" />
            Settings
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              void logout();
            }}
            className="flex w-full items-center gap-2 rounded-[6px] px-2.5 py-2 text-sm text-[var(--color-text)] transition-colors hover:bg-[var(--color-surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/40"
          >
            <LogOut className="h-4 w-4 text-[var(--color-text-muted)]" aria-hidden="true" />
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
