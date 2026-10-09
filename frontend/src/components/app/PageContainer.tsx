'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * One shared frame for every app page: max-width ~1200px, centred, 24–32px
 * side padding, and a consistent top padding, so Overview, Reports and
 * Settings all start at the same left edge.
 */
export function PageContainer({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn('page-container w-full', className)}>{children}</div>;
}