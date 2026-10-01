/**
 * Integration smoke test: renders the full Dashboard with a real /analyze
 * response captured from the backend, verifying the results story renders
 * instead of a blank screen.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import realResponse from '../__fixtures__/analyze_sales_clean.json';
import type { AnalysisResponse } from '@/lib/api';

// Recharts needs these in jsdom
vi.mock('recharts', async () => {
  const Actual = await vi.importActual<typeof import('recharts')>('recharts');
  return {
    ...Actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  };
});

import { Hero } from '@/components/dashboard/Hero';
import { QualityPanel } from '@/components/dashboard/QualityPanel';
import { TopList, BottomList } from '@/components/dashboard/TopBottomLists';
import { RankingTable } from '@/components/dashboard/RankingTable';
import { ParetoChart } from '@/components/charts/ParetoChart';
import { AbcPieChart } from '@/components/charts/AbcPieChart';
import { TrendChart } from '@/components/charts/TrendChart';

const data = realResponse as unknown as AnalysisResponse;

describe('Dashboard story renders from a real /analyze response', () => {
  it('renders the hero with the backend Pareto summary as the h1', () => {
    const { container } = render(<Hero data={data} />);
    const heading = container.querySelector('h1');
    expect(heading).toBeInTheDocument();
    // The summary text is preserved verbatim even though percentages are
    // wrapped in their own spans for the Class A highlight.
    expect(heading?.textContent).toBe(data.ranking.pareto_summary);
  });

  it('highlights the percentages in the Pareto summary', () => {
    const { container } = render(<Hero data={data} />);
    const highlighted = Array.from(
      container.querySelectorAll('h1 span')
    ).filter((s) => s.className.includes('color-class-a'));
    expect(highlighted.length).toBeGreaterThan(0);
    for (const span of highlighted) {
      expect(span.textContent).toMatch(/^\d+(\.\d+)?%$/);
    }
  });

  it('renders the quality chapter with cleaning + warnings', () => {
    const { container } = render(<QualityPanel data={data} />);
    expect(screen.getByRole('heading', { name: 'Your data' })).toBeInTheDocument();
    // Missing cells + duplicate rows stats are present
    expect(container.textContent).toContain('Missing cells');
    expect(container.textContent).toContain('Duplicate rows');
    // Every conversion the backend reported is surfaced
    for (const conversion of data.cleaning.conversions_performed ?? []) {
      expect(container.textContent).toContain(conversion);
    }
  });

  it('renders the top and bottom product lists with ABC + growth', () => {
    const { container: top } = render(<TopList data={data} />);
    expect(top.querySelectorAll('li')).toHaveLength(data.ranking.top_n.length);
    expect(top.textContent).toContain(data.ranking.top_n[0].product);

    const { container: bottom } = render(<BottomList data={data} />);
    expect(bottom.querySelectorAll('li')).toHaveLength(data.ranking.bottom_n.length);
    expect(bottom.textContent).toContain(data.ranking.bottom_n[0].product);
  });

  it('renders the full ranking table with all products', () => {
    render(<RankingTable data={data} />);
    expect(screen.getByRole('heading', { name: 'The data' })).toBeInTheDocument();
    // First page shows pageSize (10) rows
    expect(screen.getByText(data.ranking.items[0].product)).toBeInTheDocument();
  });

  it('renders the pareto chart, pie chart and trend chart without crashing', () => {
    const { container: p1 } = render(<ParetoChart data={data} />);
    expect(p1).toBeInTheDocument();
    const { container: p2 } = render(<AbcPieChart data={data} />);
    expect(p2).toBeInTheDocument();
    const { container: p3 } = render(<TrendChart data={data} />);
    expect(p3).toBeInTheDocument();
  });

  it('exposes a text alternative for the pie chart', () => {
    render(<AbcPieChart data={data} />);
    const summary = screen.getByText(/Pie chart showing value share by ABC class/);
    expect(summary).toBeInTheDocument();
    for (const d of data.charts.abc_distribution) {
      expect(summary.textContent).toContain(d.value_share_pct.toFixed(1) + '%');
    }
  });
});
