import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  chapterHeadingId,
  prefersReducedMotion,
  scrollToChapter,
} from '@/lib/scroll';
import { CHAPTER_IDS } from '@/lib/constants';

/** Install a matchMedia stub, since jsdom has none. */
function stubMatchMedia(matches: boolean) {
  const stub = vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: stub,
  });
  return stub;
}

/**
 * A chapter as Chapter renders it: a section owning the anchor id, with a
 * focusable heading inside it.
 */
function mountChapter(chapterId: string): { section: HTMLElement; heading: HTMLElement } {
  const section = document.createElement('section');
  section.id = chapterId;
  const heading = document.createElement('h2');
  heading.id = chapterHeadingId(chapterId);
  heading.tabIndex = -1;
  section.appendChild(heading);
  document.body.appendChild(section);
  return { section, heading };
}

describe('prefersReducedMotion', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'matchMedia');
  });

  it('reads the reduced-motion query', () => {
    const stub = stubMatchMedia(true);
    expect(prefersReducedMotion()).toBe(true);
    expect(stub).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
  });

  it('reports false when motion is allowed', () => {
    stubMatchMedia(false);
    expect(prefersReducedMotion()).toBe(false);
  });

  it('defaults to false when matchMedia is unavailable', () => {
    Reflect.deleteProperty(window, 'matchMedia');
    expect(prefersReducedMotion()).toBe(false);
  });
});

describe('scrollToChapter', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    stubMatchMedia(false);
    // jsdom has no layout, so scrollIntoView is not implemented.
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    Reflect.deleteProperty(window, 'matchMedia');
    vi.restoreAllMocks();
  });

  it('scrolls to the chapter heading, not the section', () => {
    const { heading } = mountChapter(CHAPTER_IDS.tail);
    scrollToChapter(CHAPTER_IDS.tail);
    expect(heading.scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'start',
    });
  });

  it('moves focus to the heading so a keyboard reader continues from there', () => {
    const { heading } = mountChapter(CHAPTER_IDS.tail);
    scrollToChapter(CHAPTER_IDS.tail);
    expect(document.activeElement).toBe(heading);
  });

  it('jumps instead of animating when the reader asked for reduced motion', () => {
    stubMatchMedia(true);
    const { heading } = mountChapter(CHAPTER_IDS.split);
    scrollToChapter(CHAPTER_IDS.split);
    expect(heading.scrollIntoView).toHaveBeenCalledWith({
      behavior: 'auto',
      block: 'start',
    });
    // Focus still moves; reduced motion is about animation, not about the reader
    // knowing where they landed.
    expect(document.activeElement).toBe(heading);
  });

  it('lets an explicit behaviour override the preference', () => {
    const { heading } = mountChapter(CHAPTER_IDS.split);
    scrollToChapter(CHAPTER_IDS.split, { behavior: 'auto' });
    expect(heading.scrollIntoView).toHaveBeenCalledWith({
      behavior: 'auto',
      block: 'start',
    });
  });

  it('does not steal focus when asked only to scroll', () => {
    const { heading } = mountChapter(CHAPTER_IDS.leaders);
    scrollToChapter(CHAPTER_IDS.leaders, { focus: false });
    expect(heading.scrollIntoView).toHaveBeenCalled();
    expect(document.activeElement).not.toBe(heading);
  });

  it('forwards preventScroll so the focus move cannot fight the animation', () => {
    const { heading } = mountChapter(CHAPTER_IDS.leaders);
    const focusSpy = vi.spyOn(heading, 'focus');
    scrollToChapter(CHAPTER_IDS.leaders);
    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('falls back to the section when the heading is not rendered', () => {
    const section = document.createElement('section');
    section.id = CHAPTER_IDS.ranking;
    document.body.appendChild(section);

    expect(scrollToChapter(CHAPTER_IDS.ranking)).toBe(true);
    expect(section.scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'start',
    });
    // No focus assertion here: a bare <section> has no tabindex, so focus on it is
    // a no-op in a real browser too. Every chapter Chapter renders does have a
    // tabIndex={-1} heading, so the fallback only has to keep the scroll working.
  });

  it('reports false for a chapter that is not on the page', () => {
    expect(scrollToChapter('chapter-does-not-exist')).toBe(false);
  });

  it('still moves focus when scrollIntoView is unavailable', () => {
    // jsdom has no layout engine; the focus move is the part keyboard users need
    // most, so it must not depend on scrolling being possible.
    Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
    const { heading } = mountChapter(CHAPTER_IDS.quality);
    expect(() => scrollToChapter(CHAPTER_IDS.quality)).not.toThrow();
    expect(document.activeElement).toBe(heading);
  });
});

describe('chapterHeadingId', () => {
  it('derives a stable heading id from the chapter id', () => {
    expect(chapterHeadingId(CHAPTER_IDS.tail)).toBe('chapter-tail-heading');
  });

  it('never collides with the section anchor it is derived from', () => {
    for (const id of Object.values(CHAPTER_IDS)) {
      expect(chapterHeadingId(id)).not.toBe(id);
    }
  });
});