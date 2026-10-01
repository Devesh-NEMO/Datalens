'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  type ButtonHTMLAttributes,
  type ReactNode,
  type RefObject,
} from 'react';
import { cn } from '@/lib/cn';

interface DialogContextValue {
  open: boolean;
  /** Request that the dialog open. */
  openDialog: () => void;
  /** Request that the dialog close, without moving focus. */
  close: () => void;
  /** The element focus returns to when the dialog closes. */
  triggerRef: RefObject<HTMLButtonElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
}

const DialogContext = createContext<DialogContextValue | null>(null);

function useDialogContext(): DialogContextValue {
  const context = useContext(DialogContext);
  if (!context) throw new Error('Dialog components must be rendered inside <Dialog>');
  return context;
}

/** Everything focusable inside the dialog, in document order. */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}

/**
 * An accessible modal dialog: `role="dialog"`, `aria-modal`, a focus trap,
 * Escape to dismiss, and focus returned to the trigger on close.
 *
 * The panel is positioned with `fixed`, so it needs no portal. It is also only
 * mounted while `open` is true, which means it never renders on the server and
 * needs no "am I mounted yet" state.
 *
 * Open state is owned by the caller rather than kept here, so a trigger and the
 * dialog it opens cannot disagree.
 */
export function Dialog({ open, onOpenChange, children }: DialogProps) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  const openDialog = useCallback(() => {
    onOpenChange(true);
  }, [onOpenChange]);

  const close = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  // Returning focus is the trigger's job on every close path, so it lives in
  // one place rather than being repeated in the Escape and outside-click
  // handlers.
  const closeAndRestoreFocus = useCallback(() => {
    close();
    triggerRef.current?.focus();
  }, [close]);

  // Lock background scrolling while the dialog is up, restoring whatever the
  // page had before.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  // Move focus into the dialog and keep Tab inside it.
  useEffect(() => {
    if (!open) return;
    const content = contentRef.current;
    if (!content) return;

    // Query on each Tab rather than caching: a list built once goes stale the
    // moment a checkbox is ticked and the disabled one becomes focusable.
    const focusable = () =>
      Array.from(content.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (element) => element.offsetParent !== null || element === document.activeElement
      );

    (focusable()[0] ?? content).focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeAndRestoreFocus();
        return;
      }
      if (event.key !== 'Tab') return;

      const items = focusable();
      if (items.length === 0) {
        // Nothing to move to, so keep focus on the panel itself.
        event.preventDefault();
        content.focus();
        return;
      }

      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && (active === first || active === content)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, closeAndRestoreFocus]);

  // Dismiss on a click outside the panel. Uses mousedown, not click, so a drag
  // that starts inside the dialog and ends outside does not close it.
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (event: MouseEvent) => {
      const content = contentRef.current;
      if (content && !content.contains(event.target as Node)) {
        closeAndRestoreFocus();
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open, closeAndRestoreFocus]);

  const value: DialogContextValue = { open, openDialog, close, triggerRef, contentRef };

  return <DialogContext.Provider value={value}>{children}</DialogContext.Provider>;
}

/**
 * The button that opens the dialog.
 *
 * It renders wherever the page wants it and only registers itself, so focus can
 * come back here on close. Keeping it a real button rather than a wrapper means
 * the caller's own `onClick`, `className`, and children pass through untouched.
 */
export function DialogTrigger({
  children,
  onClick,
  ...buttonProps
}: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
  const { open, openDialog, triggerRef } = useDialogContext();

  const capture = useCallback((element: HTMLButtonElement | null) => {
    triggerRef.current = element;
  }, [triggerRef]);

  // The trigger opens the dialog itself, and the caller's own handler still runs
  // first so it can veto. Making every caller remember to wire this up is how a
  // trigger ends up as a dead button sitting next to a working dialog.
  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      onClick?.(event);
      if (!event.defaultPrevented) openDialog();
    },
    [onClick, openDialog]
  );

  return (
    <button
      {...buttonProps}
      ref={capture}
      type={buttonProps.type ?? 'button'}
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={handleClick}
    >
      {children}
    </button>
  );
}

interface DialogContentProps {
  children: ReactNode;
  className?: string;
  /** Id of the element naming this dialog, for `aria-labelledby`. */
  titleId?: string;
}

/**
 * The modal panel: backdrop, focusable container, and a labelled dialog role.
 */
export function DialogContent({ children, className, titleId }: DialogContentProps) {
  const { open, contentRef } = useDialogContext();

  // Gated here rather than by the caller, so a dialog cannot be left on screen
  // by a caller that forgets the condition.
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        ref={contentRef}
        // Focusable with -1 so the focus trap has somewhere to fall back to
        // when the dialog contains no controls.
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          'w-full max-w-lg rounded-[8px] border border-[var(--color-rule)] bg-[var(--color-page)] p-6',
          className
        )}
      >
        {children}
      </div>
    </div>
  );
}

export function DialogHeader({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('mb-5 flex items-start justify-between gap-4', className)}>{children}</div>;
}

export function DialogTitle({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h2 id={id} className="text-lg font-semibold text-[var(--color-text)]">
      {children}
    </h2>
  );
}

export function DialogClose({ className }: { className?: string }) {
  const { close } = useDialogContext();
  return (
    <button
      type="button"
      onClick={close}
      className={cn(
        'rounded-[6px] border border-[var(--color-rule)] px-2 py-1 text-sm text-[var(--color-muted-text)]',
        'hover:text-[var(--color-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]',
        className
      )}
    >
      Close
    </button>
  );
}

export function DialogFooter({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('mt-6 flex flex-wrap justify-end gap-2', className)}>{children}</div>;
}
