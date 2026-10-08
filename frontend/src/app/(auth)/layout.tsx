import type { ReactNode } from 'react';
import { BarChart3 } from 'lucide-react';

/**
 * Route group `(auth)`: no sidebar, no topbar — just a calm centred column.
 * The card itself lives in `AuthCard` (each page owns its heading); this layout
 * owns the background, the mark, and the breathing room. Works in both themes
 * via tokens; nothing here is light- or dark-specific.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[var(--color-page)] px-4 py-10">
      <div className="w-full max-w-[420px]">
        <div className="mb-6 flex items-center justify-center gap-2">
          <span
            aria-hidden="true"
            className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-[var(--color-accent)]"
          >
            <BarChart3 className="h-4.5 w-4.5 text-white" />
          </span>
          <span className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--color-text)]">
            Datalens
          </span>
        </div>
        {children}
      </div>
    </div>
  );
}
