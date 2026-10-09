'use client';

import type { ElementType, ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface CardProps {
  children: ReactNode;
  /** Interactive cards shift toward indigo on hover with a 1px lift. */
  interactive?: boolean;
  /** Render the small indigo→purple gradient bar along the top edge. */
  accent?: boolean;
  /** Fade/rise entrance once. */
  enter?: boolean;
  className?: string;
  /** Render as another element when it needs to be a button/link. */
  as?: ElementType;
}

/**
 * The shared app card: surface slightly lifted from the page, 1px border at
 * ~10% white (dark) or `--color-border` (light), radius 14px, soft layered
 * shadow. This is the one card primitive — auth and chart surfaces live
 * elsewhere, nothing else should re-implement a card look.
 */
export function Card({
  children,
  interactive = false,
  accent = false,
  enter = true,
  className,
  as: Tag = 'div',
}: CardProps) {
  return (
    <Tag
      className={cn(
        'app-card',
        interactive && 'app-card-interactive',
        enter && 'app-card-enter',
        className
      )}
    >
      {accent ? <span aria-hidden="true" className="app-card-accent-bar" /> : null}
      {children}
    </Tag>
  );
}