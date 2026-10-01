'use client';

import { cn } from '@/lib/cn';
import { ABC_CLASS_VARS, type AbcClass } from '@/lib/constants';

interface ClassBadgeProps {
  class: AbcClass;
  size?: 'sm' | 'md' | 'lg';
  showDot?: boolean;
}

const DOT_SIZE: Record<NonNullable<ClassBadgeProps['size']>, string> = {
  sm: 'h-1.5 w-1.5',
  md: 'h-2 w-2',
  lg: 'h-2.5 w-2.5',
};

const TEXT_SIZE: Record<NonNullable<ClassBadgeProps['size']>, string> = {
  sm: 'text-xs',
  md: 'text-xs',
  lg: 'text-sm',
};

/**
 * An ABC class is always a colored dot PLUS its letter, so the class is legible
 * without relying on color alone.
 */
export function ClassBadge({ class: abcClass, size = 'md', showDot = true }: ClassBadgeProps) {
  const color = ABC_CLASS_VARS[abcClass];

  return (
    <span
      className={cn('inline-flex items-center gap-1.5 font-medium', TEXT_SIZE[size])}
      style={{ color }}
    >
      {showDot && (
        <span
          className={cn('rounded-full flex-shrink-0', DOT_SIZE[size])}
          style={{ backgroundColor: color }}
          aria-hidden="true"
        />
      )}
      <span>{abcClass}</span>
    </span>
  );
}
