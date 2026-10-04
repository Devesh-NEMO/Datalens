/**
 * Scrolling and focus for chapter navigation.
 *
 * One helper, used by the insight list, the sticky chapter nav and the skip
 * links, so every jump in the story behaves identically: the same target, the
 * same scroll offset, the same focus handling, and the same respect for a
 * reader who has asked for reduced motion.
 *
 * Two things happen on a jump and both matter:
 *
 * - The page scrolls to the chapter heading.
 * - Focus moves to that heading. Scrolling alone leaves a keyboard user's focus
 *   behind in the insight list, so their next Tab continues from the top of the
 *   page instead of from where they just landed.
 *
 * The headings carry `tabindex="-1"` for exactly this: focusable by script,
 * absent from the tab order.
 */

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Whether the reader has asked for reduced motion.
 *
 * Defaults to false when `matchMedia` is missing (jsdom without a polyfill, very
 * old browsers) so a jump still works, just smoothly.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  if (typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/**
 * DOM id of the heading inside a chapter.
 *
 * The chapter section owns the anchor id, because that is the stable name other
 * code refers to; the heading gets a derived one so focus has something to land
 * on without hijacking the section's id.
 */
export function chapterHeadingId(chapterId: string): string {
  return `${chapterId}-heading`;
}

export interface ScrollToChapterOptions {
  /** Move focus to the heading. Defaults to true; a pure scroll passes false. */
  focus?: boolean;
  /**
   * Override the scroll behaviour. Normally left unset so the reduced-motion
   * preference decides.
   */
  behavior?: ScrollBehavior;
}

/**
 * Jump to a chapter. Returns false when the chapter is not on the page, so a
 * caller can tell a real jump from a no-op instead of assuming it worked.
 */
export function scrollToChapter(
  chapterId: string,
  options: ScrollToChapterOptions = {}
): boolean {
  if (typeof document === 'undefined') return false;

  const heading =
    document.getElementById(chapterHeadingId(chapterId)) ??
    document.getElementById(chapterId);
  if (!heading) return false;

  const behavior = options.behavior ?? (prefersReducedMotion() ? 'auto' : 'smooth');

  // Guarded because jsdom has no scrollIntoView. A missing scroll must not stop
  // the focus move, which is the part keyboard users depend on.
  if (typeof heading.scrollIntoView === 'function') {
    heading.scrollIntoView({ behavior, block: 'start' });
  }

  if (options.focus !== false && typeof heading.focus === 'function') {
    // preventScroll keeps this from fighting the animation above: without it the
    // browser jumps to the element instantly and the smooth scroll is wasted.
    heading.focus({ preventScroll: true });
  }

  return true;
}