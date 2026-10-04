'use client';

import { cn } from '@/lib/cn';
import { chapterHeadingId } from '@/lib/scroll';

interface ChapterProps {
  number: number;
  title: string;
  /**
   * Stable anchor id from `CHAPTER_IDS`.
   *
   * This is the name the insight list, the sticky chapter nav and the skip
   * links jump to, so it must stay put when a chapter is renumbered or reworded.
   * Optional so a chapter can be rendered outside the main story.
   */
  id?: string;
  children: React.ReactNode;
  className?: string;
}

export function Chapter({ number, title, id, children, className }: ChapterProps) {
  return (
    <section id={id} className={cn('space-y-6', className)}>
      <hr className="h-px bg-[var(--color-rule)] border-0" />
      <div className="space-y-3">
        <span className="label-xs">Chapter {number}</span>
        {/* tabIndex -1 makes the heading focusable by script without adding it to
            the tab order, so `scrollToChapter` can put a keyboard reader's focus
            where the scroll just took them. The scroll offset keeps a future
            sticky bar from covering it. The focus ring is deliberately left on:
            it is the only cue for a screen reader user that the jump happened. */}
        <h2
          id={id ? chapterHeadingId(id) : undefined}
          tabIndex={-1}
          className="scroll-mt-[var(--scroll-offset)] font-serif text-chapter leading-[1.15] text-[var(--color-text)]"
        >
          {title}
        </h2>
        <div className="space-y-4">{children}</div>
      </div>
    </section>
  );
}
