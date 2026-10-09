/**
 * Global cursor affordances (the `@layer base` rules in globals.css), exercised
 * over the Overview, Reports and Settings surfaces.
 *
 * jsdom cannot load the Tailwind-generated stylesheet, so this test reads the
 * shipped source (globals.css), extracts the marked cursor block, injects it
 * into a <style> element, and then asserts computed cursors on the real
 * interactive controls those pages render. That keeps the test honest about the
 * actual CSS rather than restating it in test-land.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';

vi.mock('next/link', () => ({
  default: (props: { href: string; children: ReactNode; className?: string }) => (
    <a href={props.href} className={props.className}>
      {props.children}
    </a>
  ),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/',
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: null,
    status: 'anonymous',
    authRequired: false,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
  }),
}));

import { DatasetProvider } from '@/hooks/useDataset';
import { ThemeProvider } from '@/hooks/useTheme';
import { EmptyState } from '@/components/ui';
import ReportsPage from '@/app/(app)/reports/page';
import SettingsPage from '@/app/(app)/settings/page';

const CSS_PATH = resolve(__dirname, '../src/app/globals.css');

/** The cursor block only, stripped of its leading comment marker. */
function cursorRules(): string {
  const css = readFileSync(CSS_PATH, 'utf8');
  const start = css.indexOf('/* ---- Cursor affordances (start) ----');
  const end = css.indexOf('/* ---- Cursor affordances (end) ----');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return css.slice(start, end);
}

beforeAll(() => {
  const style = document.createElement('style');
  style.textContent = cursorRules();
  document.head.appendChild(style);

  // ThemeProvider reads the OS preference; jsdom does not implement matchMedia.
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
});

describe('global cursor affordances', () => {
  it('ships pointer, not-allowed and text rules for every interactive control', () => {
    const css = cursorRules();
    expect(css).toContain('button:not(:disabled)');
    expect(css).toContain('[role="button"]:not([aria-disabled="true"])');
    expect(css).toContain('a[href]');
    expect(css).toContain('summary');
    expect(css).toContain('label[for]');
    expect(css).toContain('select');
    expect(css).toContain('input[type="checkbox"]');
    expect(css).toContain('input[type="radio"]');
    expect(css).toContain('input[type="file"]');
    expect(css).toContain('[role="tab"]');
    expect(css).toContain('[role="menuitem"]');
    expect(css).toContain('[role="switch"]');
    expect(css).toContain('button:disabled');
    expect(css).toContain('cursor: not-allowed');
    expect(css).toContain('cursor: text');
  });

  it('computes pointer / not-allowed / text cursors on representative controls', () => {
    render(
      <div>
        <button type="button">Do it</button>
        <button type="button" disabled>
          Do not
        </button>
        <a href="/reports">Reports</a>
        <div role="button" tabIndex={0}>
          Dropzone
        </div>
        <div role="button" tabIndex={-1} aria-disabled="true">
          Busy
        </div>
        <span role="menuitem">Sign out</span>
        <span role="tab">Overview</span>
        <label htmlFor="field">Name</label>
        <input id="field" type="text" defaultValue="" />
        <input type="checkbox" aria-label="Include" />
        <select aria-label="Top N">
          <option>10</option>
        </select>
        <label htmlFor="file">File</label>
        <input id="file" type="file" />
        <summary>More</summary>
      </div>
    );

    expect(getComputedStyle(screen.getByRole('button', { name: 'Do it' })).cursor).toBe('pointer');
    expect(getComputedStyle(screen.getByRole('button', { name: 'Do not' })).cursor).toBe(
      'not-allowed'
    );
    expect(getComputedStyle(screen.getByRole('link', { name: 'Reports' })).cursor).toBe('pointer');
    expect(getComputedStyle(screen.getByRole('button', { name: 'Dropzone' })).cursor).toBe(
      'pointer'
    );
    expect(getComputedStyle(screen.getByRole('button', { name: 'Busy' })).cursor).toBe(
      'not-allowed'
    );
    expect(getComputedStyle(screen.getByRole('menuitem', { name: 'Sign out' })).cursor).toBe(
      'pointer'
    );
    expect(getComputedStyle(screen.getByRole('tab', { name: 'Overview' })).cursor).toBe('pointer');
    expect(getComputedStyle(screen.getByLabelText('Name')).cursor).toBe('text');
    expect(getComputedStyle(screen.getByRole('checkbox')).cursor).toBe('pointer');
    expect(getComputedStyle(screen.getByRole('combobox')).cursor).toBe('pointer');
    expect(getComputedStyle(screen.getByLabelText('File')).cursor).toBe('pointer');
  });
});

describe('Overview — upload state', () => {
  it('renders the dropzone and sample-file cards as pointer-cursor buttons', () => {
    render(<EmptyState onUpload={() => {}} onSampleSelect={() => {}} />);

    const dropzone = screen.getByRole('button', { name: /upload a data file/i });
    expect(getComputedStyle(dropzone).cursor).toBe('pointer');

    const clean = screen.getByRole('button', { name: /sales_clean\.csv/i });
    const messy = screen.getByRole('button', { name: /sales_messy\.csv/i });
    expect(getComputedStyle(clean).cursor).toBe('pointer');
    expect(getComputedStyle(messy).cursor).toBe('pointer');
    expect(clean.tagName).toBe('BUTTON');
  });

  it('marks the busy dropzone and cards as not-allowed', () => {
    render(<EmptyState onUpload={() => {}} onSampleSelect={() => {}} isLoading />);

    expect(
      getComputedStyle(screen.getByRole('button', { name: /upload a data file/i })).cursor
    ).toBe('not-allowed');
    expect(getComputedStyle(screen.getByRole('button', { name: /sales_clean\.csv/i })).cursor).toBe(
      'not-allowed'
    );
  });
});

describe('Reports — empty state', () => {
  it('links to Overview with a pointer-cursor primary button', () => {
    render(
      <DatasetProvider>
        <ReportsPage />
      </DatasetProvider>
    );

    expect(screen.getByText('No analysis yet')).toBeTruthy();
    const link = screen.getByRole('link', { name: /upload a dataset/i });
    expect(link.getAttribute('href')).toBe('/');
    expect(getComputedStyle(link).cursor).toBe('pointer');
  });
});

describe('Settings', () => {
  it('shows a pointer-cursor theme toggle that switches the real theme', async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <SettingsPage />
      </ThemeProvider>
    );

    expect(screen.getByText(/You're not signed in/)).toBeTruthy();
    expect(getComputedStyle(screen.getByRole('link', { name: 'Sign in' })).cursor).toBe('pointer');

    const dark = screen.getByRole('button', { name: /dark/i });
    const light = screen.getByRole('button', { name: /light/i });
    expect(getComputedStyle(dark).cursor).toBe('pointer');
    expect(getComputedStyle(light).cursor).toBe('pointer');

    await user.click(dark);
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    await user.click(light);
    expect(document.documentElement.classList.contains('light')).toBe(true);
  });
});