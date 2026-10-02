'use client';

import { useId, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { cn } from '@/lib/cn';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/Dialog';
import { DASHBOARD_COPY, MAX_METRICS, MIN_METRICS } from '@/lib/constants';
import {
  DEFAULT_METRIC_IDS,
  METRIC_DEFINITIONS,
  type MetricId,
  type MetricSet,
} from '@/lib/metrics';

interface KpiCustomizeProps {
  selected: readonly MetricId[];
  onSelectedChange: (next: MetricId[]) => void;
  /** Metrics this file can actually produce; the rest are shown as unavailable. */
  available: MetricSet;
}

/**
 * The "Customize" control that decides which figures the KPI row shows.
 *
 * A checkbox group rather than a multi-select listbox: the only real constraint
 * is the count, so plain checkboxes with a live count read better than a widget
 * that needs modifier keys explained.
 *
 * The dialog handles its own open state so the row above it stays uncluttered.
 */
export function KpiCustomize({ selected, onSelectedChange, available }: KpiCustomizeProps) {
  const [open, setOpen] = useState(false);
  const baseId = useId();
  const atMax = selected.length >= MAX_METRICS;
  const atMin = selected.length <= MIN_METRICS;

  const toggle = (id: MetricId) => {
    const isSelected = selected.includes(id);
    // Belt and braces: the inputs below are already disabled at each bound, but
    // a click can still arrive from a stale render, so the guard lives here too.
    if (isSelected && atMin) return;
    if (!isSelected && atMax) return;
    onSelectedChange(
      isSelected ? selected.filter((current) => current !== id) : [...selected, id]
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        className={cn(
          'inline-flex items-center gap-1.5 rounded-[6px] border border-[var(--color-rule)] px-2.5 py-1',
          'text-xs text-[var(--color-muted-text)] transition-colors hover:text-[var(--color-text)]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]'
        )}
      >
        <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
        {DASHBOARD_COPY.customizeTrigger}
      </DialogTrigger>

      <DialogContent titleId="kpi-customize-title" className="max-w-lg">
        <DialogHeader>
          <DialogTitle id="kpi-customize-title">{DASHBOARD_COPY.customizeTitle}</DialogTitle>
          <DialogClose />
        </DialogHeader>

        <p className="text-sm text-[var(--color-muted-text)]">
          {DASHBOARD_COPY.customizeHint(MIN_METRICS, MAX_METRICS)}
        </p>

        <fieldset className="mt-4">
          <legend className="sr-only">{DASHBOARD_COPY.customizeTitle}</legend>
          <ul className="space-y-1">
            {METRIC_DEFINITIONS.map((definition) => {
              const unavailable = available[definition.id] === undefined;
              const isSelected = selected.includes(definition.id);
              // Both bounds disable the boxes that would cross them rather than
              // hiding them, so the whole set stays visible and the reason is
              // discoverable. Leaving a box enabled and quietly ignoring the
              // click is worse than either: it looks broken.
              const atBound = isSelected ? atMin : atMax;

              return (
                <li key={definition.id}>
                  <label
                    htmlFor={`${baseId}-${definition.id}-input`}
                    className={cn(
                      'flex items-start gap-2.5 rounded-[6px] px-2 py-1.5',
                      unavailable
                        ? 'opacity-50'
                        : 'cursor-pointer hover:bg-[var(--color-rule)]'
                    )}
                  >
                    {/* The label span is the accessible name and the hint is the
                        description, so a screen reader says "Total value" and
                        then "Summed value across every product."
                        aria-labelledby is explicit because a <label> that wraps
                        both spans would announce them as one run-together
                        string, "Total valueSummed value across every product". */}
                    <input
                      id={`${baseId}-${definition.id}-input`}
                      type="checkbox"
                      className="mt-1"
                      aria-labelledby={`${baseId}-${definition.id}-label`}
                      aria-describedby={`${baseId}-${definition.id}-hint`}
                      checked={isSelected}
                      disabled={unavailable || atBound}
                      onChange={() => toggle(definition.id)}
                    />
                    <span>
                      <span
                        id={`${baseId}-${definition.id}-label`}
                        className="block text-sm text-[var(--color-text)]"
                      >
                        {definition.label}
                      </span>
                      <span
                        id={`${baseId}-${definition.id}-hint`}
                        className="block text-xs text-[var(--color-muted-text)]"
                      >
                        {unavailable
                          ? DASHBOARD_COPY.customizeUnavailable
                          : definition.hint}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>

        {/* Announced as it changes, since the effect is only visible off-screen
            in the row above once the dialog closes. */}
        <p className="mt-3 text-xs text-[var(--color-muted-text)]" role="status">
          {atMin
            ? DASHBOARD_COPY.customizeMinReached(MIN_METRICS)
            : atMax
              ? DASHBOARD_COPY.customizeMaxReached(MAX_METRICS)
              : DASHBOARD_COPY.customizeSelectionCount(
                  selected.length,
                  MIN_METRICS,
                  MAX_METRICS
                )}
        </p>

        <DialogFooter>
          <button
            type="button"
            onClick={() => onSelectedChange([...DEFAULT_METRIC_IDS])}
            className={cn(
              'mr-auto rounded-[6px] px-2 py-1 text-xs text-[var(--color-muted-text)]',
              'hover:text-[var(--color-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]'
            )}
          >
            {DASHBOARD_COPY.customizeReset}
          </button>
          <DialogClose />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}