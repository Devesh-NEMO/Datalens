/**
 * Tests for the before/after cleaning table.
 *
 * The component has to keep one rule above all: every figure it shows must have a
 * real counterpart on the other side. The counts the response has no "before"
 * value for are therefore listed as work done, never placed in the table's left
 * column.
 *
 * Both sample files are used, because sales_clean.csv has nothing to report and
 * sales_messy.csv has five separate things to report.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import cleanResponse from '../__fixtures__/analyze_sales_clean.json';
import messyResponse from '../__fixtures__/analyze_sales_messy.json';
import type { AnalysisResponse } from '@/lib/api';
import { CleaningComparison } from '@/components/dashboard/CleaningComparison';
import { CLEANING_COPY } from '@/lib/constants';

const clean = cleanResponse as unknown as AnalysisResponse;
const messy = messyResponse as unknown as AnalysisResponse;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** The after-value shown for a labelled row of the table. */
function cellFor(label: string): string {
  const row = screen.getByRole('row', { name: new RegExp(`^${label}`) });
  return within(row)
    .getAllByRole('cell')
    .map((cell) => cell.textContent ?? '')
    .join('|');
}

describe('CleaningComparison — a file that needed nothing', () => {
  it('says so instead of showing an empty table', () => {
    render(<CleaningComparison data={clean} />);
    expect(screen.getByText(CLEANING_COPY.noChanges)).toBeInTheDocument();
  });

  it('shows no table at all, since 600 to 600 and 8 to 8 say nothing', () => {
    render(<CleaningComparison data={clean} />);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('still keeps its eyebrow, so the block does not appear and vanish', () => {
    render(<CleaningComparison data={clean} />);
    expect(screen.getByText(CLEANING_COPY.eyebrow)).toBeInTheDocument();
  });
});

describe('CleaningComparison — real before and after figures', () => {
  it('shows rows before and after from the response', () => {
    render(<CleaningComparison data={messy} />);
    expect(cellFor(CLEANING_COPY.rowsLabel)).toContain('614');
    // 619 before, 614 after: the before figure is on screen too.
    expect(screen.getByRole('table')).toHaveTextContent('619');
    expect(screen.getByRole('table')).toHaveTextContent('614');
  });

  it('labels the two columns so the difference is readable', () => {
    render(<CleaningComparison data={messy} />);
    expect(screen.getByText(CLEANING_COPY.before)).toBeInTheDocument();
    expect(screen.getByText(CLEANING_COPY.after)).toBeInTheDocument();
  });

  it('marks an unchanged measure as unchanged for a screen reader', () => {
    render(<CleaningComparison data={messy} />);
    // Columns were 8 before and 8 after, so the number repeats rather than
    // implying a change that did not happen.
    expect(cellFor(CLEANING_COPY.columnsLabel)).toContain(CLEANING_COPY.unchanged);
  });

  it('lists the counts that have no before-value as work done, not as a table row', () => {
    render(<CleaningComparison data={messy} />);
    expect(screen.getByText(CLEANING_COPY.rowsDropped('5'))).toBeInTheDocument();
    expect(screen.getByText(CLEANING_COPY.nullLikeConverted('99'))).toBeInTheDocument();
    expect(screen.getByText(CLEANING_COPY.failedDates('15'))).toBeInTheDocument();

    // 5 dropped rows appears under "While cleaning", not as a table row: there is
    // no before-figure for "cells that failed to parse".
    const table = screen.getByRole('table');
    expect(table).not.toHaveTextContent('could not be parsed');
  });

  it('names the columns that were dropped when there are any', () => {
    const data = clone(messy);
    data.cleaning.columns_dropped = ['notes', 'internal_id'];
    render(<CleaningComparison data={data} />);
    expect(screen.getByText(CLEANING_COPY.columnsDropped('notes, internal_id'))).toBeInTheDocument();
  });

  it('derives the after-column count by subtraction', () => {
    const data = clone(messy);
    data.cleaning.columns_dropped = ['notes', 'internal_id'];
    render(<CleaningComparison data={data} />);
    // 8 in the file, two dropped, so 6 remain.
    expect(cellFor(CLEANING_COPY.columnsLabel)).toContain('6');
  });

  it('never shows an after-count below zero if the response is inconsistent', () => {
    const data = clone(messy);
    data.cleaning.columns_dropped = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
    render(<CleaningComparison data={data} />);
    expect(cellFor(CLEANING_COPY.columnsLabel)).not.toContain('-');
  });

  it('reports a zero-valued count as absent rather than as "0 dropped"', () => {
    const data = clone(messy);
    data.cleaning.failed_numeric_conversions = 0;
    render(<CleaningComparison data={data} />);
    expect(screen.queryByText(CLEANING_COPY.failedNumbers('0'))).not.toBeInTheDocument();
  });

  it('shows the applied section only when there is something to report', () => {
    const data = clone(messy);
    data.cleaning.rows_dropped = 0;
    data.cleaning.null_like_values_converted = 0;
    data.cleaning.failed_date_conversions = 0;
    render(<CleaningComparison data={data} />);
    expect(screen.queryByText(CLEANING_COPY.appliedEyebrow)).not.toBeInTheDocument();
  });
});

describe('CleaningComparison — survival and honesty', () => {
  it('does not crash when cleaning is missing', () => {
    const data = clone(messy);
    (data as unknown as Record<string, unknown>).cleaning = null;
    expect(() => render(<CleaningComparison data={data} />)).not.toThrow();
  });

  it('does not claim a change when nothing happened', () => {
    const data = clone(messy);
    data.cleaning.rows_before = data.cleaning.rows_after;
    data.cleaning.rows_dropped = 0;
    data.cleaning.null_like_values_converted = 0;
    data.cleaning.failed_date_conversions = 0;
    render(<CleaningComparison data={data} />);
    expect(screen.getByText(CLEANING_COPY.noChanges)).toBeInTheDocument();
  });

  it('gives the table an accessible caption naming what it shows', () => {
    render(<CleaningComparison data={messy} />);
    expect(screen.getByRole('table')).toHaveAccessibleName(CLEANING_COPY.caption);
  });

  it('uses a real table, so the figures can be read row by row', () => {
    render(<CleaningComparison data={messy} />);
    expect(screen.getAllByRole('columnheader')).toHaveLength(3);
    expect(screen.getAllByRole('rowheader').map((r) => r.textContent)).toEqual([
      CLEANING_COPY.rowsLabel,
      CLEANING_COPY.columnsLabel,
    ]);
  });
});