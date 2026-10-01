/**
 * Dialog accessibility tests.
 *
 * The behaviour that matters here is keyboard-only: a dialog a keyboard user
 * can open but cannot escape is worse than no dialog at all, so focus trap,
 * Escape, and focus restoration are the things worth pinning down.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/Dialog';

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button">before</button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger>Open options</DialogTrigger>
        <DialogContent titleId="harness-title">
          <DialogHeader>
            <DialogTitle id="harness-title">Report options</DialogTitle>
          </DialogHeader>
          <label>
            <input type="checkbox" aria-label="Include charts" />
            Include charts
          </label>
          <DialogFooter>
            <button type="button">Confirm</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <button type="button">after</button>
    </>
  );
}

describe('Dialog', () => {
  it('renders nothing until it is opened', () => {
    render(<Harness />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('exposes a modal dialog with an accessible name', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'Open options' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    // Named by the title, not by nothing.
    expect(dialog).toHaveAccessibleName('Report options');
  });

  it('marks the trigger as a dialog trigger and reports its state', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const trigger = screen.getByRole('button', { name: 'Open options' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await user.click(trigger);
    await screen.findByRole('dialog');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });

  it('moves focus into the dialog when it opens', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'Open options' }));
    await screen.findByRole('dialog');

    await waitFor(() => {
      expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
    });
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const trigger = screen.getByRole('button', { name: 'Open options' });
    await user.click(trigger);
    await screen.findByRole('dialog');

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // Focus going nowhere after a dismiss is the classic keyboard trap.
    expect(document.activeElement).toBe(trigger);
  });

  it('keeps Tab inside the dialog', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'Open options' }));
    await screen.findByRole('dialog');

    // Walk forward past every control; focus must never land outside the panel.
    for (let step = 0; step < 8; step += 1) {
      await user.tab();
      const dialog = screen.getByRole('dialog');
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it('keeps Shift+Tab inside the dialog', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'Open options' }));
    await screen.findByRole('dialog');

    for (let step = 0; step < 6; step += 1) {
      await user.tab({ shift: true });
      expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
    }
  });

  it('closes when a click lands outside the panel', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'Open options' }));
    await screen.findByRole('dialog');

    await user.click(screen.getByRole('button', { name: 'after' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('stays open when a click lands inside the panel', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'Open options' }));
    await screen.findByRole('dialog');

    await user.click(screen.getByLabelText('Include charts'));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('restores the page scroll position when it closes', async () => {
    const user = userEvent.setup();
    document.body.style.overflow = 'auto';
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'Open options' }));
    await screen.findByRole('dialog');
    // A dialog that lets the page scroll behind it is disorienting.
    expect(document.body.style.overflow).toBe('hidden');

    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(document.body.style.overflow).toBe('auto');
    });
  });

  it('calls onOpenChange when a close control is used', async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();

    function Controlled() {
      const [open, setOpen] = useState(false);
      return (
        <Dialog
          open={open}
          onOpenChange={(next) => {
            onOpenChange(next);
            setOpen(next);
          }}
        >
          <DialogTrigger onClick={() => setOpen(true)}>open</DialogTrigger>
          <DialogContent titleId="t">
            <DialogTitle id="t">Titled</DialogTitle>
          </DialogContent>
        </Dialog>
      );
    }

    render(<Controlled />);
    await user.click(screen.getByRole('button', { name: 'open' }));
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
