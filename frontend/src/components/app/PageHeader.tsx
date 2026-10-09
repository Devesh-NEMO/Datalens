'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface PageHeaderProps {
  title: string;
  /** Optional one-line muted description under the title. */
  description?: string;
  /** Optional actions row on the right (buttons, links, menus). */
  actions?: ReactNode;
  className?: string;
}

/**
 * Consistent page heading: 24–28px semibold sans title, an optional muted
 * one-line description, and an optional actions slot on the right. Wrapped in
 * a flex row so the title block and the actions align nicely at every width.
 */
export function PageHeader({ title, description, actions, className }: PageHeaderProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between',
        className
      )}
    >
      <div className="min-w-0">
        <h1 className="page-title app-card-enter">{title}</h1>
        {description ? <p className="page-description app-card-enter">{description}</p> : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2 app-card-enter">{actions}</div>
      ) : null}
    </div>
  );
}