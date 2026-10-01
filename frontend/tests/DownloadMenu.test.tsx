import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DownloadMenu } from '@/components/ui/DownloadMenu';

function renderMenu(overrides: Partial<Parameters<typeof DownloadMenu>[0]> = {}) {
  const props = {
    itemLabel: 'Pareto curve',
    items: [
      { id: 'image', label: 'Image', extensions: ['png'], run: vi.fn() },
      { id: 'data', label: 'Data', extensions: ['csv'], run: vi.fn() },
    ],
    ...overrides,
  } as Parameters<typeof DownloadMenu>[0];

  render(<DownloadMenu {...props} />);
  return props;
}

describe('DownloadMenu', () => {
  it('is a real menu button with the correct ARIA attributes', async () => {
    renderMenu();
    const trigger = screen.getByRole('button', { name: 'Download Pareto curve' });

    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    await userEvent.click(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getAllByRole('menuitem')).toHaveLength(2);
  });

  it('moves focus into the menu when it opens', async () => {
    renderMenu();
    await userEvent.click(screen.getByRole('button', { name: 'Download Pareto curve' }));

    expect(screen.getAllByRole('menuitem')[0]).toHaveFocus();
  });

  it('opens with ArrowDown and cycles with the arrow keys', async () => {
    renderMenu();
    const trigger = screen.getByRole('button', { name: 'Download Pareto curve' });

    trigger.focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getAllByRole('menuitem')[0]).toHaveFocus();

    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getAllByRole('menuitem')[1]).toHaveFocus();

    // Wraps from the last item back to the first.
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getAllByRole('menuitem')[0]).toHaveFocus();

    await userEvent.keyboard('{ArrowUp}');
    expect(screen.getAllByRole('menuitem')[1]).toHaveFocus();
  });

  it('jumps to the first and last item with Home and End', async () => {
    renderMenu();
    screen.getByRole('button', { name: 'Download Pareto curve' }).focus();
    await userEvent.keyboard('{ArrowDown}');

    await userEvent.keyboard('{End}');
    expect(screen.getAllByRole('menuitem')[1]).toHaveFocus();

    await userEvent.keyboard('{Home}');
    expect(screen.getAllByRole('menuitem')[0]).toHaveFocus();
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    renderMenu();
    const trigger = screen.getByRole('button', { name: 'Download Pareto curve' });

    await userEvent.click(trigger);
    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('runs the item default format and closes on selection', async () => {
    const run = vi.fn();
    renderMenu({
      items: [{ id: 'image', label: 'Image', extensions: ['png', 'svg'], run }],
    } as Partial<Parameters<typeof DownloadMenu>[0]>);

    await userEvent.click(screen.getByRole('button', { name: 'Download Pareto curve' }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Image/ }));

    expect(run).toHaveBeenCalledWith('png');
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  });

  it('disables the trigger while a download is generating and announces progress', async () => {
    let release: () => void = () => {};
    const run = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );

    renderMenu({ items: [{ id: 'report', label: 'Report', extensions: ['pdf'], run }] } as Partial<
      Parameters<typeof DownloadMenu>[0]
    >);

    const trigger = screen.getByRole('button', { name: 'Download Pareto curve' });
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole('menuitem', { name: /Report/ }));

    // Trigger is disabled while the export runs.
    await waitFor(() => expect(screen.getByRole('button', { name: /Download/ })).toBeDisabled());
    expect(screen.getByRole('status')).toHaveTextContent('Preparing your download...');

    release();
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Download ready'));
  });

  it('shows a friendly error banner with a hint when generation fails', async () => {
    const run = vi.fn().mockRejectedValue(new Error('canvas exploded'));
    renderMenu({ items: [{ id: 'image', label: 'Image', extensions: ['png'], run }] } as Partial<
      Parameters<typeof DownloadMenu>[0]
    >);

    await userEvent.click(screen.getByRole('button', { name: 'Download Pareto curve' }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Image/ }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("We couldn't create that file.");
    expect(alert).toHaveTextContent('Try again, or download the CSV instead.');
  });

  it('never leaks the raw error message to the user', async () => {
    const run = vi.fn().mockRejectedValue(new Error('ENOENT: /secret/path/font.ttf'));
    renderMenu({ items: [{ id: 'image', label: 'Image', extensions: ['png'], run }] } as Partial<
      Parameters<typeof DownloadMenu>[0]
    >);

    await userEvent.click(screen.getByRole('button', { name: 'Download Pareto curve' }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Image/ }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).not.toContain('ENOENT');
    expect(alert.textContent).not.toContain('/secret/path');
  });

  it('closes the menu when clicking outside', async () => {
    renderMenu(
      {},
    );
    await userEvent.click(screen.getByRole('button', { name: 'Download Pareto curve' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    await userEvent.click(document.body);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('only offers the light background checkbox when a handler is supplied', async () => {
    renderMenu();
    await userEvent.click(screen.getByRole('button', { name: 'Download Pareto curve' }));
    expect(screen.queryByRole('checkbox', { name: /Use light background/ })).not.toBeInTheDocument();
  });

  it('reports the light background choice to the caller', async () => {
    const onLightBackgroundChange = vi.fn();
    renderMenu({ onLightBackgroundChange } as Partial<Parameters<typeof DownloadMenu>[0]>);

    await userEvent.click(screen.getByRole('button', { name: 'Download Pareto curve' }));
    await userEvent.click(screen.getByRole('checkbox', { name: /Use light background/ }));

    expect(onLightBackgroundChange).toHaveBeenCalledWith(true);
  });

  it('respects the disabled prop', () => {
    renderMenu({ disabled: true } as Partial<Parameters<typeof DownloadMenu>[0]>);
    expect(screen.getByRole('button', { name: 'Download Pareto curve' })).toBeDisabled();
  });
});