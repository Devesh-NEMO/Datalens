import type { ReactNode } from 'react';

/** Shared field chrome: thin border, 8px radius, indigo focus ring. */
export const INPUT_CLASS =
  'w-full rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] transition-colors focus:border-[var(--color-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/40 disabled:opacity-60';

export const FIELD_LABEL_CLASS =
  'block text-sm font-medium text-[var(--color-text)] mb-1.5';

export const FIELD_HINT_CLASS = 'mt-1.5 text-xs text-[var(--color-text-muted)]';

export const FIELD_ERROR_CLASS = 'mt-1.5 text-xs text-[var(--color-critical)]';

export interface AuthCardProps {
  /** The single heading for the page — an `<h1>`. */
  title: string;
  /** One calm sentence under the title. */
  description?: ReactNode;
  /** Everything under the description, typically a `<form>`. */
  children: ReactNode;
  /** Footer row: cross-links such as "New here? Create an account". */
  footer?: ReactNode;
}

/**
 * The card the login and register forms share: 420px max width, 12px radius,
 * thin border, subtle shadow. Sits on the `(auth)` layout's calm background.
 */
export function AuthCard({ title, description, children, footer }: AuthCardProps) {
  return (
    <section className="w-full rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-sm sm:p-8">
      <header className="mb-6">
        <h1 className="text-lg font-semibold tracking-tight text-[var(--color-text)]">{title}</h1>
        {description ? (
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">{description}</p>
        ) : null}
      </header>
      {children}
      {footer ? <div className="mt-6 text-center text-sm text-[var(--color-text-muted)]">{footer}</div> : null}
    </section>
  );
}
