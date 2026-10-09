'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { FileText, Menu, Moon, Sun, X } from 'lucide-react';
import { useTheme } from '@/hooks/useTheme';
import { useDataset } from '@/hooks/useDataset';
import type { AnalysisResponse } from '@/lib/api';
import { formatNumber } from '@/lib/format';
import { AppBackground } from '@/components/app';
import { Sidebar } from './Sidebar';

const TITLES: Record<string, string> = {
  '/': 'Overview',
  '/reports': 'Reports',
  '/settings': 'Settings',
};

function pageTitle(pathname: string): string {
  if (pathname in TITLES) return TITLES[pathname];
  if (pathname.startsWith('/reports')) return 'Reports';
  if (pathname.startsWith('/settings')) return 'Settings';
  return 'Overview';
}

/** Row count of the loaded dataset, for the topbar chip. */
function rowCount(data: AnalysisResponse): number {
  return data.meta?.rows ?? data.ranking?.items?.length ?? 0;
}

/**
 * The dashboard chrome: ambient background + sidebar + one topbar + main, per
 * the `.app-*` classes in globals.css (one layout system — nothing here
 * re-implements positioning).
 *
 * The single topbar carries the current page title (or breadcrumb), a chip
 * with the loaded dataset's name and row count, and the theme toggle on the
 * right. The account block lives at the bottom of the sidebar.
 *
 * Mobile (≤768px) the sidebar becomes a drawer: the hamburger opens it, a
 * backdrop or Escape closes it, and the body stops scrolling while it is open.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { theme, toggleTheme } = useTheme();
  const { dataset } = useDataset();
  const pathname = usePathname();
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

  const rows = dataset ? rowCount(dataset.data) : 0;

  return (
    <>
      <AppBackground />

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
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            aria-label={drawerOpen ? 'Close navigation' : 'Open navigation'}
            aria-expanded={drawerOpen}
            aria-controls="app-sidebar"
            onClick={() => setDrawerOpen((current) => !current)}
            className="rounded-[8px] p-1.5 text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] max-[768px]:inline-flex hidden"
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
          <span className="text-[15px] font-semibold text-[var(--color-text)]">
            {pageTitle(pathname)}
          </span>
        </div>

        <div className="ml-auto flex min-w-0 items-center gap-2">
          {dataset ? (
            <Link
              href="/"
              title={`${dataset.fileName} · ${formatNumber(rows)} rows`}
              className="app-chip"
            >
              <FileText className="h-3.5 w-3.5 shrink-0 text-[var(--color-accent)]" aria-hidden="true" />
              <span className="app-chip-name">{dataset.fileName}</span>
              <span className="app-chip-count">{formatNumber(rows)} rows</span>
            </Link>
          ) : null}

          <button
            type="button"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            className="rounded-[8px] border border-transparent p-2 text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-border)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
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