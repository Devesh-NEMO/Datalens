'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BarChart3, FileText, LayoutDashboard, Plus, Settings } from 'lucide-react';
import { cn } from '@/lib/cn';
import { AccountMenu } from './AccountMenu';

/**
 * Only routes that actually resolve live here — a nav item that 404s is worse
 * than no nav item. Overview is `/` (the dashboard; `/overview` exists as the
 * auth-flow landing and redirects there).
 */
const NAV_ITEMS = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/reports', label: 'Reports', icon: FileText },
  { href: '/settings', label: 'Settings', icon: Settings },
];

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export interface SidebarProps {
  /** Mobile drawer state; the media query owns everything wider. */
  open?: boolean;
  /** Close the drawer after a click, so a tap navigates and gets out of the way. */
  onNavigate?: () => void;
}

/**
 * Fixed sidebar on desktop, icon-less drawer on mobile. Uses the shared
 * `.app-sidebar` layout class (globals.css) for position, sizing and the
 * ≤768px off-canvas transform; tokens come in as utilities, which win over the
 * components layer. The `.open` class is what the media query looks for.
 */
export function Sidebar({ open, onNavigate }: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside
      id="app-sidebar"
      className={cn(
        'app-sidebar transition-transform duration-200',
        // Theme the shell: light surface in light mode, dark in dark mode.
        'bg-[var(--color-surface)] border-[var(--color-border)]',
        open && 'open'
      )}
    >
      <div className="flex h-full flex-col p-4">
        <div className="flex items-center gap-2 px-2 pb-4 pt-1">
          <span
            aria-hidden="true"
            className="flex h-7 w-7 items-center justify-center rounded-[8px] bg-[var(--color-accent)]"
          >
            <BarChart3 className="h-3.5 w-3.5 text-white" />
          </span>
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-text)]">
            Datalens
          </span>
        </div>

        <nav aria-label="Main" className="flex flex-col gap-1">
          {NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-3 rounded-[8px] px-2 py-2 text-sm font-medium transition-colors',
                  'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/40',
                  active && 'bg-[var(--color-surface-2)] text-[var(--color-accent)]'
                )}
              >
                <item.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto space-y-3 pt-4">
          <div className="border-t border-[var(--color-border)] pt-3">
            <Link
              href="/"
              onClick={onNavigate}
              className="flex items-center gap-2 rounded-[8px] px-2 py-2 text-sm font-medium text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/40"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              New dataset
            </Link>
          </div>
          <AccountMenu />
        </div>
      </div>
    </aside>
  );
}
