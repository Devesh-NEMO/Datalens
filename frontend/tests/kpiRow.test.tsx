/**
 * Tests for the KPI row and its customize dialog.
 *
 * Covers the three rules the row has to keep: the compact number carries the
 * exact value with it, the quality tile names its level rather than relying on
 * colour, and the selection is held between 3 and 6.
 *
 * Both sample files are used so the duplicate tile is proved on a file that has
 * duplicates and on one that does not.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import cleanResponse from '../__fixtures__/analyze_sales_clean.json';
import messyResponse from '../__fixtures__/analyze_sales_messy.json';
import type { AnalysisResponse } from '@/lib/api';
import { KpiRow } from '@/components/dashboard/KpiRow';
import { ExecutiveSummary } from '@/components/dashboard/ExecutiveSummary';
import { DEFAULT_METRIC_IDS, MAX_METRICS, METRIC_DEFINITIONS, MIN_METRICS, type MetricId } from '@/lib/metrics';

const clean = cleanResponse as unknown as AnalysisResponse;
const messy = messyResponse as unknown as AnalysisResponse;

/**
 * The page owns the selection in the real app, so the row is driven the same way
 * here: a controlled wrapper that actually holds state.
 */
function ControlledKpiRow({
  data,
  initial = DEFAULT_METRIC_IDS as readonly MetricId[],
}: {
  data: AnalysisResponse;
  initial?: readonly MetricId[];
}) {
  const [selected, setSelected] = useState<MetricId[]>([...initial]);
  return <KpiRow data={data} selected={selected} onSelectedChange={setSelected} />;
}

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * Find the checkbox for a metric by its accessible name.
 *
 * The name is the metric label alone; the hint is attached with
 * aria-describedby so a screen reader announces the label first and the
 * explanation second. Anchoring the match with ^ also keeps /Total value/ from
 * swallowing "Average per product".
 */
function checkboxFor(label: string): HTMLElement {
  if (!METRIC_DEFINITIONS.some((candidate) => candidate.label === label)) {
    throw new Error(`No metric is labelled "${label}"`);
  }
  return screen.getByRole('checkbox', { name: new RegExp(`^${label}`) });
}

describe('KpiRow', () => {
  it('shows the six default figures', () => {
    render(<ControlledKpiRow data={messy} />);
    for (const label of [
      'Total value',
      'Products',
      'Class A share',
      'Average per product',
      'Quality score',
      'Duplicate rows found',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('shows a compact number and keeps the exact value in the title', () => {
    render(<ControlledKpiRow data={messy} />);
    // Compact, because 1,571,822.3 is unreadable at display size.
    expect(screen.getByText('1.6M')).toBeInTheDocument();
    // The exact figure is still available to a reader who asks for it.
    expect(screen.getByTitle(/Exact value: 1,571,822\.3/)).toBeInTheDocument();
  });

  it('never says duplicates were removed, on a file that has them', () => {
    render(<ControlledKpiRow data={messy} />);
    expect(messy.quality.duplicate_row_count).toBe(14);
    expect(messy.cleaning.rows_dropped).toBe(5);
    expect(screen.getByText('Duplicate rows found')).toBeInTheDocument();
    expect(screen.queryByText(/removed/i)).not.toBeInTheDocument();
  });

  it('shows a zero duplicate count rather than hiding the tile', () => {
    render(<ControlledKpiRow data={clean} />);
    expect(clean.quality.duplicate_row_count).toBe(0);
    expect(screen.getByTitle(/Duplicate rows found\. Exact value: 0/)).toBeInTheDocument();
  });

  it('names the quality level in text, not only in colour', () => {
    render(<ControlledKpiRow data={messy} />);
    const tile = screen.getByTitle(/Quality score/);
    expect(tile.textContent).toContain('96');
    expect(tile.textContent).toContain('Excellent');
  });

  it('renders in METRIC_DEFINITIONS order, not the order requested', () => {
    render(<ControlledKpiRow data={messy} initial={['rows', 'productCount', 'totalValue']} />);
    const labels = screen
      .getAllByText(
        /Total value|Products|Rows|Average per product|Class A share|Quality score|Duplicate rows found/
      )
      .map((node) => node.textContent);
    expect(labels).toEqual(['Total value', 'Products', 'Rows']);
  });
});

describe('KpiRow customize dialog', () => {
  it('opens from the Customize control and lists every figure', async () => {
    const user = userEvent.setup();
    render(<ControlledKpiRow data={messy} />);

    await user.click(screen.getByRole('button', { name: /customize/i }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('checkbox', { name: /^Total value/ })).toBeChecked();
    // A selected figure is a normal control, not one greyed out for being
    // unavailable: every default is producible from this file.
    expect(checkboxFor('Total value')).toBeEnabled();
    // The hint is a description, not part of the name, so the two are not read
    // out as one run-together string.
    expect(checkboxFor('Total value')).toHaveAccessibleDescription(
      'Summed value across every product.'
    );
  });

  it('adds a figure when a checkbox is ticked', async () => {
    const user = userEvent.setup();
    render(<ControlledKpiRow data={messy} initial={['totalValue', 'productCount', 'rows']} />);

    await user.click(screen.getByRole('button', { name: /customize/i }));
    await user.click(checkboxFor('Class A share'));

    await user.keyboard('{Escape}');
    expect(screen.getByText('Class A share')).toBeInTheDocument();
  });

  it('refuses to go below the minimum of three', async () => {
    const user = userEvent.setup();
    render(<ControlledKpiRow data={messy} initial={['totalValue', 'productCount', 'rows']} />);

    await user.click(screen.getByRole('button', { name: /customize/i }));
    expect(MIN_METRICS).toBe(3);

    // Sitting on the floor, the boxes that would cross it are disabled rather
    // than left enabled and quietly ignored.
    expect(checkboxFor('Total value')).toBeDisabled();
    expect(checkboxFor('Products')).toBeDisabled();
    expect(checkboxFor('Rows')).toBeDisabled();
    expect(screen.getByText(`At least ${MIN_METRICS} figures are needed.`)).toBeInTheDocument();

    // Adding is still allowed at the floor.
    expect(checkboxFor('Class A share')).toBeEnabled();
    await user.click(checkboxFor('Class A share'));

    // Now above the floor, removal works again.
    expect(checkboxFor('Class A share')).toBeEnabled();
    await user.click(checkboxFor('Class A share'));

    await user.keyboard('{Escape}');
    // Still exactly three tiles.
    expect(screen.getByText('Total value')).toBeInTheDocument();
    expect(screen.getByText('Products')).toBeInTheDocument();
    expect(screen.getByText('Rows')).toBeInTheDocument();
    expect(screen.queryByText('Class A share')).not.toBeInTheDocument();
  });

  it('disables further boxes at the maximum of six', async () => {
    const user = userEvent.setup();
    render(<ControlledKpiRow data={messy} />);
    expect(MAX_METRICS).toBe(6);

    await user.click(screen.getByRole('button', { name: /customize/i }));

    // The defaults already fill the row, so every unselected box is disabled
    // rather than hidden: the full set stays visible and the cap is discoverable.
    expect(checkboxFor('Median product value')).toBeDisabled();
    expect(checkboxFor('Total value')).toBeEnabled();
    expect(screen.getByText(`At most ${MAX_METRICS} figures fit on one row.`)).toBeInTheDocument();
  });

  it('lets the user free a slot and spend it on another figure', async () => {
    const user = userEvent.setup();
    render(<ControlledKpiRow data={messy} />);

    await user.click(screen.getByRole('button', { name: /customize/i }));
    await user.click(checkboxFor('Duplicate rows found'));

    // Now there is room, so a previously capped box becomes selectable.
    const median = checkboxFor('Median product value');
    expect(median).toBeEnabled();
    await user.click(median);

    await user.keyboard('{Escape}');
    expect(screen.getByText('Median product value')).toBeInTheDocument();
    expect(screen.queryByText('Duplicate rows found')).not.toBeInTheDocument();
  });

  it('resets to the default selection', async () => {
    const user = userEvent.setup();
    render(<ControlledKpiRow data={messy} initial={['totalValue', 'productCount', 'rows']} />);

    await user.click(screen.getByRole('button', { name: /customize/i }));
    await user.click(screen.getByRole('button', { name: /reset to default/i }));
    await user.keyboard('{Escape}');

    expect(screen.getByText('Quality score')).toBeInTheDocument();
    expect(screen.getByText('Duplicate rows found')).toBeInTheDocument();
    expect(screen.queryByText('Rows')).not.toBeInTheDocument();
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    render(<ControlledKpiRow data={messy} />);

    const trigger = screen.getByRole('button', { name: /customize/i });
    await user.click(trigger);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('marks a figure unavailable when the file cannot produce it', async () => {
    const user = userEvent.setup();
    // No ranking section, so nothing derived from products exists.
    const noRanking = { ...messy, ranking: undefined } as unknown as AnalysisResponse;
    render(<ControlledKpiRow data={noRanking} />);

    await user.click(screen.getByRole('button', { name: /customize/i }));
    expect(checkboxFor('Median product value')).toBeDisabled();
    expect(screen.getAllByText('Not available for this file').length).toBeGreaterThan(0);
  });
});

describe('ExecutiveSummary', () => {
  it('lists the total value, top product, quality, rows and months covered', () => {
    render(<ExecutiveSummary data={messy} />);

    expect(screen.getByText('Total value')).toBeInTheDocument();
    expect(screen.getByText('1.6M')).toBeInTheDocument();

    expect(screen.getByText('Top product')).toBeInTheDocument();
    expect(screen.getByText('MacBook Pro 16')).toBeInTheDocument();
    expect(screen.getByText('52.4% of total value')).toBeInTheDocument();

    expect(screen.getByText('Quality score')).toBeInTheDocument();
    expect(screen.getByText(/Excellent/)).toBeInTheDocument();

    expect(screen.getByText('Rows processed')).toBeInTheDocument();
    expect(screen.getByText('619')).toBeInTheDocument();

    // Month granularity, and labelled as such rather than as exact dates.
    expect(screen.getByText('Months covered')).toBeInTheDocument();
    expect(screen.getByText('Jan 2025 – Dec 2025')).toBeInTheDocument();
  });

  it('shows the top product class as a dot and a letter', () => {
    const { container } = render(<ExecutiveSummary data={messy} />);
    const badge = container.querySelector('.rounded-full');
    expect(badge).toBeInTheDocument();
    // The letter is present, so the class never depends on the colour alone.
    expect(screen.getAllByText('A').length).toBeGreaterThan(0);
  });

  it('omits the months line when there is no trend, rather than guessing', () => {
    const noTrend = {
      ...messy,
      charts: { ...messy.charts, monthly_trend: [] },
    } as AnalysisResponse;
    render(<ExecutiveSummary data={noTrend} />);

    expect(screen.getByText('Total value')).toBeInTheDocument();
    expect(screen.queryByText('Months covered')).not.toBeInTheDocument();
  });

  it('omits the top product when the file has no ranked products', () => {
    const noProducts = {
      ...messy,
      ranking: { ...messy.ranking, items: [] },
    } as AnalysisResponse;
    render(<ExecutiveSummary data={noProducts} />);

    expect(screen.queryByText('Top product')).not.toBeInTheDocument();
    expect(screen.getByText('Total value')).toBeInTheDocument();
  });

  it('uses a hairline rule rather than a boxed card', () => {
    const { container } = render(<ExecutiveSummary data={messy} />);
    const block = container.firstElementChild;
    expect(block?.className).toContain('border-y');
    expect(block?.className).toContain('--color-rule');
    // The story has no drop shadows.
    expect(block?.className).not.toContain('shadow');
  });
});
