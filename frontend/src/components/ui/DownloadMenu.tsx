'use client';

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { Check, ChevronDown, Download, Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { DOWNLOAD_COPY } from '@/lib/constants';
import { useDownload } from '@/hooks/useDownload';

export interface DownloadMenuItem {
  id: string;
  label: string;
  /** Formats the download can produce; the first is the default. */
  extensions: readonly string[];
  run: (extension: string) => void | Promise<void>;
  disabled?: boolean;
}

interface DownloadMenuProps {
  items: readonly DownloadMenuItem[];
  /** Used in the trigger's accessible name, e.g. "Download Pareto curve". */
  itemLabel: string;
  /** Trigger text. Defaults to "Download". */
  label?: string;
  /** PDF, PNG, and SVG honour this; CSV always stays plain text. */
  lightBackground?: boolean;
  onLightBackgroundChange?: (value: boolean) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * A real ARIA menu button: a trigger with `aria-haspopup` / `aria-expanded`,
 * and a `role="menu"` popup that roves focus with the arrow keys.
 *
 * Focus returns to the trigger on Escape, which is the behaviour assistive tech
 * users expect from a menu that opened from the trigger.
 */
export function DownloadMenu({
  items,
  itemLabel,
  label = DOWNLOAD_COPY.triggerLabel,
  lightBackground = false,
  onLightBackgroundChange,
  disabled = false,
  className,
}: DownloadMenuProps) {
  const [open, setOpen] = useState(false);
  const { isPreparing, failure, liveMessage, run, dismiss } = useDownload();

  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();

  const close = useCallback((returnFocus = false) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  // Clicking anywhere outside dismisses, matching native menu behaviour.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
    };
  }, [open]);

  // Move focus into the menu as it opens so arrow keys work immediately.
  useEffect(() => {
    if (!open) return;
    const firstEnabled = itemRefs.current.findIndex((el) => el && !el.disabled);
    const target = firstEnabled === -1 ? 0 : firstEnabled;
    itemRefs.current[target]?.focus();
  }, [open]);

  const focusableIndexes = useCallback((): number[] => {
    return itemRefs.current.reduce<number[]>((acc, el, index) => {
      if (el && !el.disabled) acc.push(index);
      return acc;
    }, []);
  }, []);

  const moveFocus = useCallback(
    (from: number, delta: 1 | -1) => {
      const enabled = focusableIndexes();
      if (enabled.length === 0) return;
      const currentPos = enabled.indexOf(from);
      // Wrap around at both ends.
      const nextPos = (currentPos + delta + enabled.length) % enabled.length;
      itemRefs.current[enabled[nextPos]]?.focus();
    },
    [focusableIndexes]
  );

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const index = itemRefs.current.indexOf(document.activeElement as HTMLButtonElement);

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        moveFocus(index === -1 ? 0 : index, 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        moveFocus(index === -1 ? 0 : index, -1);
        break;
      case 'Home':
        event.preventDefault();
        itemRefs.current[focusableIndexes()[0]]?.focus();
        break;
      case 'End': {
        event.preventDefault();
        const enabled = focusableIndexes();
        itemRefs.current[enabled[enabled.length - 1]]?.focus();
        break;
      }
      case 'Escape':
        event.preventDefault();
        close(true);
        break;
      case 'Tab':
        // Let focus move on naturally, but do not leave an orphaned menu open.
        setOpen(false);
        break;
      default:
        break;
    }
  };

  const onTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setOpen(true);
    }
  };

  const choose = (item: DownloadMenuItem, extension: string) => {
    close(true);
    void run(() => item.run(extension));
  };

  const busy = isPreparing || disabled;

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        onKeyDown={onTriggerKeyDown}
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`${DOWNLOAD_COPY.triggerAriaLabel.replace('{item}', itemLabel)}`}
        className={cn(
          'inline-flex items-center gap-2 rounded-[6px] border px-3 py-2 text-sm',
          'border-[var(--color-rule)] text-[var(--color-text)] bg-transparent',
          'hover:bg-[var(--color-rule)] transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]',
          'disabled:opacity-50 disabled:cursor-not-allowed'
        )}
      >
        {isPreparing ? (
          <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        ) : (
          <Download className="h-4 w-4" aria-hidden="true" />
        )}
        <span>{isPreparing ? DOWNLOAD_COPY.busyLabel : label}</span>
        <ChevronDown className="h-3 w-3" aria-hidden="true" />
      </button>

      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={`${DOWNLOAD_COPY.menuLabel}: ${itemLabel}`}
          onKeyDown={onMenuKeyDown}
          className={cn(
            'absolute right-0 z-20 mt-2 w-56 rounded-[6px] border',
            'border-[var(--color-rule)] bg-[var(--color-page)] p-1'
          )}
        >
          {items.map((item, index) => (
            <button
              key={item.id}
              ref={(el) => {
                itemRefs.current[index] = el;
              }}
              type="button"
              role="menuitem"
              tabIndex={-1}
              disabled={item.disabled}
              onClick={() => choose(item, item.extensions[0] ?? 'png')}
              className={cn(
                'flex w-full items-center justify-between gap-2 rounded-[4px] px-3 py-2 text-left text-sm',
                'text-[var(--color-text)] transition-colors',
                'hover:bg-[var(--color-rule)] focus:bg-[var(--color-rule)]',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]',
                'disabled:opacity-50 disabled:cursor-not-allowed'
              )}
            >
              <span>{item.label}</span>
              <span className="text-xs uppercase tracking-wide text-[var(--color-muted-text)]">
                {item.extensions.join(' / ')}
              </span>
            </button>
          ))}

          {onLightBackgroundChange && (
            <div className="mt-1 border-t border-[var(--color-rule)] px-3 py-2">
              <label className="flex items-start gap-2 text-sm text-[var(--color-text)]">
                <input
                  type="checkbox"
                  checked={lightBackground}
                  onChange={(event) => onLightBackgroundChange(event.target.checked)}
                  className="mt-0.5 accent-[var(--color-accent)]"
                />
                <span>
                  {DOWNLOAD_COPY.lightBackground}
                  <span className="block text-xs text-[var(--color-muted-text)]">
                    {DOWNLOAD_COPY.lightBackgroundHint}
                  </span>
                </span>
              </label>
            </div>
          )}
        </div>
      )}

      {failure && (
        <div role="alert" className="mt-2 rounded-[6px] border border-[var(--color-class-c)] p-3 text-sm">
          <p className="font-medium text-[var(--color-text)]">{failure.title}</p>
          <p className="text-[var(--color-muted-text)]">{failure.hint}</p>
          <button
            type="button"
            onClick={dismiss}
            className="mt-2 inline-flex items-center gap-1 rounded-[6px] border border-[var(--color-rule)] px-2 py-1 text-xs"
          >
            <Check className="h-3 w-3" aria-hidden="true" />
            Dismiss
          </button>
        </div>
      )}

      <span className="sr-only" role="status" aria-live="polite">
        {liveMessage}
      </span>
    </div>
  );
}