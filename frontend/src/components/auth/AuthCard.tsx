import type { ReactNode } from 'react';

/** Shared field chrome: visible surface, 1px border, 44px height, 10px radius,
 *  indigo focus ring (see `.field-control` in globals.css). */
export const INPUT_CLASS = 'field-control';

/** Left padding for fields that carry a leading icon. */
export const FIELD_WITH_ICON_CLASS = 'field-control field-with-icon';

export const FIELD_LABEL_CLASS = 'block text-sm font-medium text-[var(--color-text)] mb-2';

export const FIELD_HINT_CLASS = 'mt-1.5 text-xs text-[var(--color-text-muted)]';

export const FIELD_ERROR_CLASS =
  'mt-1.5 flex items-start gap-1.5 text-xs leading-relaxed text-[var(--color-critical)]';

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
 * The card the login and register forms share: 440px max width, 16px radius,
 * restrained frosted surface (semi-opaque + blur), layered shadow, and a
 * one-time 300ms fade-and-rise entrance (`auth-card-enter` collapses to a
 * static card under `prefers-reduced-motion`).
 */
export function AuthCard({ title, description, children, footer }: AuthCardProps) {
  return (
    <section className="auth-card auth-card-enter w-full max-w-[440px] rounded-[16px] p-6 sm:p-8">
      <header className="mb-6">
        <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-[var(--color-text)]">
          {title}
        </h1>
        {description ? (
          <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-text-muted)]">
            {description}
          </p>
        ) : null}
      </header>
      {children}
      {footer ? (
        <div className="mt-8 border-t border-[color:color-mix(in_srgb,var(--color-text)_12%,transparent)] pt-5 text-center text-sm text-[var(--color-text-muted)]">
          {footer}
        </div>
      ) : null}
    </section>
  );
}