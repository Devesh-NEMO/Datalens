'use client';

import { CHAPTER_TITLES, INSIGHT_COPY } from '@/lib/constants';
import { scrollToChapter } from '@/lib/scroll';
import type { Insight } from '@/lib/insights';
import { cn } from '@/lib/cn';

interface InsightListProps {
  insights: readonly Insight[];
  className?: string;
}

/**
 * The short list of findings that leads into the story.
 *
 * Each finding is a link to the chapter that shows its evidence. Links, not
 * buttons, because jumping to another part of the same document is what a link
 * means: it keeps the destination in the href for right-click, middle-click and
 * for a reader whose JavaScript has not loaded. The click handler only exists to
 * take over the *motion*, choosing smooth or instant per the reader's
 * reduced-motion preference, and to move focus to the chapter heading so a
 * keyboard reader's next Tab continues from where they landed instead of from
 * the top of the page.
 *
 * Rendered as a ruled list — a hairline above, one under each row — rather than
 * as cards, so it reads as part of the written story instead of a widget panel.
 *
 * Renders nothing at all when there are no findings. An empty list of findings
 * would be a claim that nothing stands out, which is a different statement from
 * not having looked.
 */
export function InsightList({ insights, className }: InsightListProps) {
  if (insights.length === 0) return null;

  const handleJump = (chapterId: string) => (event: React.MouseEvent<HTMLAnchorElement>) => {
    // Hand a modified click back to the browser. Ctrl/Cmd-click and Shift-click
    // mean "open somewhere else", and the href is what carries that out, so the
    // handler must not swallow it. A middle click needs no check here: it does
    // not raise `click` at all, which is why `event.button` is never a useful
    // guard on this event.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    scrollToChapter(chapterId);
  };

  return (
    <section aria-labelledby="insight-list-heading" className={cn('space-y-3', className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="insight-list-heading" className="label-xs">
          {INSIGHT_COPY.eyebrow}
        </h2>
        {/* Describes every finding at once, so each link's announcement carries
            the instruction without repeating it in all six names. */}
        <p id="insight-list-hint" className="text-xs text-[var(--color-muted-text)]">
          {INSIGHT_COPY.hint}
        </p>
      </div>

      <ul className="border-t border-[var(--color-rule)]">
        {insights.map((insight) => (
          <li key={insight.id} className="border-b border-[var(--color-rule)]">
            <a
              href={`#${insight.targetChapterId}`}
              onClick={handleJump(insight.targetChapterId)}
              aria-describedby="insight-list-hint"
              className="group flex items-baseline gap-3 py-3 text-[0.9375rem] leading-snug text-[var(--color-text)] no-underline transition-colors hover:text-[var(--color-muted-text)]"
            >
              <span>{insight.text}</span>
              {/* The chapter is named off screen as well, so the destination is
                  available to a screen reader and not only to the eye. */}
              <span className="sr-only">
                {' '}
                {INSIGHT_COPY.opensChapter} {CHAPTER_TITLES[insight.targetChapterId]}
              </span>
              <span
                aria-hidden="true"
                className="ml-auto shrink-0 text-[var(--color-muted-text)] transition-transform group-hover:translate-x-0.5"
              >
                &rarr;
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}