'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, Database } from 'lucide-react';
import { cn } from '@/lib/cn';
import { DATABASE_HELP } from '@/lib/constants';

/**
 * Collapsible export instructions. Copy lives in constants.ts.
 */
export function DatabaseHelp() {
  const [open, setOpen] = useState(false);

  return (
    <div className="w-full">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="database-help-panel"
        className={cn(
          'inline-flex items-center gap-2 text-sm text-[var(--color-muted-text)]',
          'hover:text-[var(--color-text)] transition-colors'
        )}
      >
        {open ? (
          <ChevronDown className="h-4 w-4" aria-hidden="true" />
        ) : (
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        )}
        <Database className="h-4 w-4" aria-hidden="true" />
        {DATABASE_HELP.title}
      </button>

      {open && (
        <div
          id="database-help-panel"
          className="mt-3 space-y-4 border-l border-[var(--color-rule)] pl-4"
        >
          <p className="text-sm text-[var(--color-muted-text)]">{DATABASE_HELP.intro}</p>

          <dl className="space-y-3">
            {DATABASE_HELP.steps.map((group) => (
              <div key={group.tool}>
                <dt className="text-sm text-[var(--color-text)]">{group.tool}</dt>
                <dd>
                  <ol className="mt-1 list-decimal list-inside space-y-0.5">
                    {group.steps.map((step) => (
                      <li key={step} className="text-sm text-[var(--color-muted-text)]">
                        {step}
                      </li>
                    ))}
                  </ol>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}
