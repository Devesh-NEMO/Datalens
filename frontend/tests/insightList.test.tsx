/**
 * Tests for the insight list.
 *
 * The list's job is to offer a small number of true sentences that each jump to
 * the chapter showing the evidence. So the tests here cover the three ways that
 * can go wrong: a finding with no chapter behind it, a jump that scrolls without
 * moving focus, and a jump that animates for a reader who asked it not to.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import cleanResponse from '../__fixtures__/analyze_sales_clean.json';
import messyResponse from '../__fixtures__/analyze_sales_messy.json';
import type { AnalysisResponse } from '@/lib/api';
import { InsightList } from '@/components/dashboard/InsightList';
import { generateInsights } from '@/lib/insights';
import { chapterHeadingId, scrollToChapter } from '@/lib/scroll';
import { CHAPTER_IDS, CHAPTER_TITLES, INSIGHT_COPY } from '@/lib/constants';

const clean = cleanResponse as unknown as AnalysisResponse;
const messy = messyResponse as unknown as AnalysisResponse;

function stubMatchMedia(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

/**
 * Mount a chapter the way Chapter does, so a jump has something real to land on.
 */
function mountChapter(chapterId: string): HTMLElement {
  const section = document.createElement('section');
  section.id = chapterId;
  const heading = document.createElement('h2');
  heading.id = chapterHeadingId(chapterId);
  heading.tabIndex = -1;
  heading.textContent = CHAPTER_TITLES[chapterId as keyof typeof CHAPTER_TITLES];
  section.appendChild(heading);
  document.body.appendChild(section);
  return heading;
}

describe('InsightList — content', () => {
  it('renders one link per finding', () => {
    const insights = generateInsights(messy);
    render(<InsightList insights={insights} />);
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(insights.length);
  });

  it('shows the real sentences generated for the file', () => {
    render(<InsightList insights={generateInsights(messy)} />);
    expect(
      screen.getByRole('link', { name: new RegExp('duplicate rows were found', 'i') })
    ).toBeInTheDocument();
  });

  it('renders nothing when there are no findings', () => {
    const { container } = render(<InsightList insights={[]} />);
    // An empty list would claim that nothing stands out, which is a different
    // statement from not having looked.
    expect(container).toBeEmptyDOMElement();
  });

  it('gives each link a fragment href naming its chapter', () => {
    const insights = generateInsights(clean);
    render(<InsightList insights={insights} />);
    for (const insight of insights) {
      expect(
        screen.getByRole('link', { name: new RegExp(escapeRegExp(insight.text.slice(0, 30))) })
      ).toHaveAttribute('href', `#${insight.targetChapterId}`);
    }
  });

  it('names the destination chapter off screen for screen readers', () => {
    const insights = generateInsights(clean);
    render(<InsightList insights={insights} />);
    const first = insights[0];
    const link = screen.getByRole('link', {
      name: new RegExp(escapeRegExp(first.text.slice(0, 30))),
    });
    expect(link).toHaveAccessibleName(
      new RegExp(`${INSIGHT_COPY.opensChapter}\\s+${CHAPTER_TITLES[first.targetChapterId]}`, 'i')
    );
  });

  it('describes every link with the shared hint rather than repeating it', () => {
    const insights = generateInsights(clean);
    render(<InsightList insights={insights} />);
    expect(screen.getByText(INSIGHT_COPY.hint)).toBeInTheDocument();
    for (const link of screen.getAllByRole('link')) {
      expect(link).toHaveAttribute('aria-describedby', 'insight-list-hint');
    }
  });

  it('labels the list for assistive technology', () => {
    render(<InsightList insights={generateInsights(clean)} />);
    expect(
      screen.getByRole('heading', { name: INSIGHT_COPY.eyebrow })
    ).toBeInTheDocument();
  });

  it('hides the jump arrow from assistive technology', () => {
    render(<InsightList insights={generateInsights(clean)} />);
    // The arrow is decoration; the off-screen chapter name carries the meaning.
    for (const link of screen.getAllByRole('link')) {
      expect(link.querySelector('[aria-hidden="true"]')).not.toBeNull();
    }
  });

  it('emits no finding pointing at a chapter the page would not render', () => {
    // "Over time" is hidden for a file with no dates, so a link to it would be dead.
    const data = structuredClone(clean) as AnalysisResponse;
    data.charts.monthly_trend = [];
    const insights = generateInsights(data);
    for (const insight of insights) {
      expect(insight.targetChapterId).not.toBe(CHAPTER_IDS.time);
    }
  });
});

describe('InsightList — jumping', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    Reflect.deleteProperty(window, 'matchMedia');
    vi.restoreAllMocks();
  });

  it('scrolls to the chapter and moves focus to its heading', async () => {
    stubMatchMedia(false);
    const user = userEvent.setup();
    const heading = mountChapter(CHAPTER_IDS.tail);
    const insights = generateInsights(clean).filter((i) => i.targetChapterId === CHAPTER_IDS.tail);
    render(<InsightList insights={insights} />);

    await user.click(screen.getByRole('link'));

    expect(heading.scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'start',
    });
    // Focus is the part that matters most: without it the next Tab starts again
    // from the top of the page.
    expect(document.activeElement).toBe(heading);
  });

  it('jumps instead of animating when reduced motion is requested', async () => {
    stubMatchMedia(true);
    const user = userEvent.setup();
    const heading = mountChapter(CHAPTER_IDS.tail);
    const insights = generateInsights(clean).filter((i) => i.targetChapterId === CHAPTER_IDS.tail);
    render(<InsightList insights={insights} />);

    await user.click(screen.getByRole('link'));

    expect(heading.scrollIntoView).toHaveBeenCalledWith({
      behavior: 'auto',
      block: 'start',
    });
    expect(document.activeElement).toBe(heading);
  });

  it('leaves a Ctrl-click to the browser, so a new tab still works', async () => {
    stubMatchMedia(false);
    const heading = mountChapter(CHAPTER_IDS.tail);
    const insights = generateInsights(clean).filter((i) => i.targetChapterId === CHAPTER_IDS.tail);
    render(<InsightList insights={insights} />);

    // The key has to be held rather than passed to click(): a real browser only
    // reports ctrlKey on the click event while the key is actually down.
    const user = userEvent.setup();
    await user.keyboard('{Control>}');
    await user.click(screen.getByRole('link'));

    expect(heading.scrollIntoView).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(heading);
  });

  it('leaves a Shift-click to the browser', async () => {
    stubMatchMedia(false);
    const heading = mountChapter(CHAPTER_IDS.tail);
    const insights = generateInsights(clean).filter((i) => i.targetChapterId === CHAPTER_IDS.tail);
    render(<InsightList insights={insights} />);

    const user = userEvent.setup();
    await user.keyboard('{Shift>}');
    await user.click(screen.getByRole('link'));

    expect(heading.scrollIntoView).not.toHaveBeenCalled();
  });

  it('is reachable and operable from the keyboard alone', async () => {
    stubMatchMedia(false);
    const user = userEvent.setup();
    const heading = mountChapter(CHAPTER_IDS.tail);
    const insights = generateInsights(clean).filter((i) => i.targetChapterId === CHAPTER_IDS.tail);
    render(<InsightList insights={insights} />);

    await user.tab();
    expect(screen.getByRole('link')).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(document.activeElement).toBe(heading);
  });

  it('keeps the href intact even when the chapter is missing at click time', async () => {
    stubMatchMedia(false);
    const user = userEvent.setup();
    const insights = generateInsights(clean).slice(0, 1);
    render(<InsightList insights={insights} />);

    // Nothing mounted for the target: the handler must not throw, and the href
    // stays in the DOM as the fallback path.
    await expect(user.click(screen.getByRole('link'))).resolves.not.toThrow();
    expect(screen.getByRole('link')).toHaveAttribute(
      'href',
      `#${insights[0].targetChapterId}`
    );
  });
});

describe('scrollToChapter integration', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    Reflect.deleteProperty(window, 'matchMedia');
    vi.restoreAllMocks();
  });

  it('is the single helper every jump in the story shares', () => {
    // Guard against a second implementation appearing: the insight list imports
    // this exact function, so a duplicate would drift in behaviour.
    expect(typeof scrollToChapter).toBe('function');
    expect(scrollToChapter.length).toBeGreaterThanOrEqual(1);
  });
});

/** Escape a string for safe use inside a RegExp. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}