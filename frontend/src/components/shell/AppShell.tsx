'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Menu, Moon, Sun, X } from 'lucide-react';
import { useTheme } from '@/hooks/useTheme';
import { Sidebar } from './Sidebar';

/**
 * The dashboard chrome: sidebar + topbar + main, per the `.app-*` classes in
 * globals.css (one layout system — nothing here re-implements positioning).
 *
 * Mobile (≤768px) the sidebar becomes a drawer: the hamburger opens it, a
 * backdrop or Escape closes it, and the body stops scrolling while it is open
 * so the page behind cannot drift. Wider than that the drawer state is inert —
 * the media query keeps the sidebar visible and the backdrop hidden.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { theme, toggleTheme } = useTheme();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Escape closes the drawer.
  useEffect(() => {
    if (!drawerOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setDrawerOpen(false);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen]);

  // Lock body scroll while the drawer is open (only ever happens on mobile).
  useEffect(() => {
    if (!drawerOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [drawerOpen]);

  return (
    <>
      <Sidebar open={drawerOpen} onNavigate={() => setDrawerOpen(false)} />

      {drawerOpen ? (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={() => setDrawerOpen(false)}
          className="fixed inset-0 z-[35] hidden bg-black/40 max-[768px]:block"
        />
      ) : null}

      <header className="app-topbar">
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label={drawerOpen ? 'Close navigation' : 'Open navigation'}
            aria-expanded={drawerOpen}
            aria-controls="app-sidebar"
            onClick={() => setDrawerOpen((current) => !current)}
            className="rounded-[8px] p-1.5 text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/40 max-[768px]:inline-flex hidden"
          >
            {drawerOpen ? (
              <X className="h-5 w-5" aria-hidden="true" />
            ) : (
              <Menu className="h-5 w-5" aria-hidden="true" />
            )}
          </button>
          {/* The sidebar carries the brand on desktop; the topbar on mobile. */}
          <span className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--color-text)] max-[768px]:inline hidden">
            Datalens
          </span>
        </div>

        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            className="rounded-[8px] p-2 text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/40"
          >
            {theme === 'dark' ? (
              <Sun className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Moon className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        </div>
      </header>

      <main className="app-main">{children}</main>
    </>
  );
}
