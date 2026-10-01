'use client';

import { cn } from '@/lib/cn';

interface ChapterProps {
  number: number;
  title: string;
  children: React.ReactNode;
  className?: string;
}

export function Chapter({ number, title, children, className }: ChapterProps) {
  return (
    <section className={cn('space-y-6', className)}>
      <hr className="h-px bg-[var(--color-rule)] border-0" />
      <div className="space-y-3">
        <span className="label-xs">Chapter {number}</span>
        <h2 className="font-serif text-chapter leading-[1.15] text-[var(--color-text)]">
          {title}
        </h2>
        <div className="space-y-4">{children}</div>
      </div>
    </section>
  );
}
