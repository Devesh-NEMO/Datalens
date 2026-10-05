/**
 * Tests for the trend badge.
 *
 * A badge is only trustworthy if the reader can tell three things: which way it
 * points, how big the move was, and what it was measured against. These tests hold
 * it to all three, plus the rule that direction survives without colour.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TrendBadge, TrendBadgeGroup } from '@/components/dashboard/TrendBadge';
import { productTrend, TREND_GLYPH, type Trend } from '@/lib/trends';
import { TREND_COPY } from '@/lib/constants';

const UP: Trend = {
  direction: 'up',
  changePct: 10.29,
  displayPct: '+10.3%',
  comparison: 'Dec 2025',
  srText: 'rose 10.3% versus Dec 2025',
};

const DOWN: Trend = {
  direction: 'down',
  changePct: -47.58,
  displayPct: '-47.6%',
  comparison: 'Dec 2025',
  srText: 'fell 47.6% versus Dec 2025',
};

const FLAT: Trend = {
  direction: 'flat',
  changePct: 0,
  displayPct: 'no change',
  comparison: 'Dec 2025',
  srText: 'was unchanged versus Dec 2025',
};

describe('TrendBadge — what it shows', () => {
  it('shows the arrow and the percentage', () => {
    const { container } = render(<TrendBadge trend={UP} />);
    expect(container.textContent).toContain('▲');
    expect(container.textContent).toContain('+10.3%');
  });

  it('points down for a fall', () => {
    const { container } = render(<TrendBadge trend={DOWN} />);
    expect(container.textContent).toContain('▼');
    expect(container.textContent).toContain('-47.6%');
  });

  it('uses a square for no change rather than an arrow', () => {
    // An up or down arrow next to "no change" would contradict itself.
    const { container } = render(<TrendBadge trend={FLAT} />);
    expect(container.textContent).toContain(TREND_GLYPH.flat);
    expect(container.textContent).not.toContain(TREND_GLYPH.up);
    expect(container.textContent).not.toContain(TREND_GLYPH.down);
  });

  it('names the comparison it is measured against', () => {
    const { container } = render(<TrendBadge trend={UP} comparison="Dec 2025 vs Nov 2025" />);
    expect(container.textContent).toContain('Dec 2025 vs Nov 2025');
  });

  it('renders nothing at all when there is no honest trend', () => {
    const { container } = render(<TrendBadge trend={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('TrendBadge — for a screen reader', () => {
  it('reads the move as a phrase, not as a symbol', () => {
    render(<TrendBadge trend={UP} />);
    expect(screen.getByText('rose 10.3% versus Dec 2025')).toHaveClass('sr-only');
  });

  it('hides the arrow and percentage from assistive technology', () => {
    // Otherwise the reader hears the glyph or nothing at all, depending on how
    // faithfully it is announced.
    const { container } = render(<TrendBadge trend={DOWN} />);
    const hidden = container.querySelectorAll('[aria-hidden="true"]');
    expect(hidden.length).toBeGreaterThanOrEqual(2);
  });

  it('does not rely on an aria-label on a generic span', () => {
    // The previous badge put aria-label on a span, which is inconsistently
    // honoured and would replace the visible text rather than accompany it.
    const { container } = render(<TrendBadge trend={UP} />);
    expect(container.querySelector('[aria-label]')).toBeNull();
  });

  it('repeats the comparison as a phrase when it is shown', () => {
    render(<TrendBadge trend={UP} comparison="Dec 2025 vs Nov 2025" />);
    expect(screen.getByText(TREND_COPY.comparisonPrevious)).toHaveClass('sr-only');
  });

  it('never says the change was quality rather than value', () => {
    const { container } = render(<TrendBadge trend={UP} comparison="Dec 2025 vs Nov 2025" />);
    expect(container.textContent?.toLowerCase()).not.toContain('quality');
  });
});

describe('TrendBadge — direction without colour', () => {
  it('keeps the arrow even where the colour is dropped', () => {
    // The arrow is text, so it survives greyscale printing and a reader who
    // cannot separate the ABC green from the ABC red.
    const { container } = render(<TrendBadge trend={DOWN} />);
    expect(container.textContent).toContain('▼');
  });

  it('distinguishes the three directions by glyph alone', () => {
    expect(new Set(Object.values(TREND_GLYPH)).size).toBe(3);
  });
});

describe('TrendBadgeGroup', () => {
  it('names the pair of periods once', () => {
    render(<TrendBadgeGroup label="Dec 2025 vs Nov 2025" />);
    expect(screen.getByText('Dec 2025 vs Nov 2025')).toBeInTheDocument();
  });

  it('renders nothing without a label to give', () => {
    const { container } = render(<TrendBadgeGroup label={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('repeats the label as a phrase for assistive technology', () => {
    render(<TrendBadgeGroup label="Dec 2025 vs Nov 2025" />);
    expect(screen.getByText(TREND_COPY.comparisonPrevious)).toHaveClass('sr-only');
  });
});

describe('the badge takes its wording from the trend, not from a template', () => {
  it('shows whatever productTrend resolved', () => {
    const trend = productTrend({
      product: 'Widget',
      previous_period: '2025-11',
      latest_period: '2025-12',
      previous_value: 1000,
      latest_value: 1500,
      change_pct: 50,
      direction: 'rising',
    });
    render(<TrendBadge trend={trend} />);
    // +50, not the +10.3 from the fixture above: nothing is hardcoded.
    expect(screen.getByText('rose 50.0% versus Dec 2025')).toBeInTheDocument();
  });
});