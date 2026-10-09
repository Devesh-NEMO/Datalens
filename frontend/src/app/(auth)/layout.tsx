import type { ReactNode } from 'react';
import { BarChart3, ChartPie, Sparkles, Zap } from 'lucide-react';
import AuthBackground from '@/components/auth/AuthBackground';

/**
 * Route group `(auth)`: no sidebar, no topbar. The card itself lives in
 * `AuthCard` (each page owns its heading); this layout owns the backdrop,
 * the brand lockup, the split brand panel (desktop ≥1024px) and the footer.
 *
 * Layers, bottom → top: CSS-only gradient + grid (instant, no JS), the 3D
 * canvas (code-split, fades in), a vignette that keeps the scene quiet, then
 * the content at `z-10`. The canvas is `pointer-events: none` so it never
 * intercepts clicks or focus.
 */

const BENEFITS = [
  {
    icon: Zap,
    title: 'Instant dataset analysis',
    text: 'Upload a CSV and see its shape, quality and outliers in seconds.',
  },
  {
    icon: ChartPie,
    title: 'ABC & Pareto insights',
    text: 'Focus effort where it matters with built-in ABC and Pareto views.',
  },
  {
    icon: Sparkles,
    title: 'AI-assisted explanations',
    text: 'Plain-language summaries of what your data is telling you.',
  },
] as const;

function BrandLockup() {
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden="true"
          className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-[#6366F1] shadow-[0_6px_16px_-6px_rgba(99,102,241,0.7)]"
        >
          <BarChart3 className="h-4.5 w-4.5 text-white" />
        </span>
        <span className="text-base font-semibold uppercase tracking-[0.18em] text-[var(--color-text)]">
          Datalens
        </span>
      </div>
      <p className="text-sm text-[var(--color-text-muted)]">Turn raw data into decisions</p>
    </div>
  );
}

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-screen flex-col bg-[var(--color-page)]">
      {/* CSS-only backdrop: renders before any JS, then the 3D canvas fades over it. */}
      <div aria-hidden="true" className="auth-backdrop pointer-events-none fixed inset-0 z-0" />
      <div aria-hidden="true" className="auth-backdrop-grid pointer-events-none fixed inset-0 z-0" />
      <AuthBackground />
      {/* Vignette so the scene never fights the card or the brand panel. */}
      <div aria-hidden="true" className="auth-vignette pointer-events-none fixed inset-0 z-[1]" />

      <main className="relative z-10 mx-auto flex w-full max-w-6xl flex-1 flex-col items-center justify-center gap-8 px-4 py-12 sm:px-6 lg:grid lg:grid-cols-[minmax(0,1fr)_440px] lg:items-center lg:gap-16 lg:px-8">
        {/* Split-mode brand panel — desktop only. */}
        <div className="hidden lg:block">
          <div className="max-w-md space-y-10">
            <BrandLockup />
            <div>
              <h2 className="text-3xl font-semibold tracking-tight text-[var(--color-text)]">
                Turn raw data into decisions.
              </h2>
              <ul className="mt-8 space-y-5">
                {BENEFITS.map(({ icon: Icon, title, text }) => (
                  <li key={title} className="flex gap-3.5">
                    <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm">
                      <Icon aria-hidden="true" className="h-4 w-4 text-[var(--color-accent)]" />
                    </span>
                    <span>
                      <span className="block text-sm font-semibold text-[var(--color-text)]">
                        {title}
                      </span>
                      <span className="mt-0.5 block text-sm leading-relaxed text-[var(--color-text-muted)]">
                        {text}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        {/* Brand lockup — centred above the card below 1024px. */}
        <div className="lg:hidden">
          <BrandLockup />
        </div>

        {/* The card, with a soft indigo glow behind it. */}
        <div className="relative w-full max-w-[440px]">
          <div
            aria-hidden="true"
            className="auth-card-glow pointer-events-none absolute -inset-8 -top-12 -bottom-12 rounded-[40px]"
          />
          {children}
        </div>
      </main>

      <footer className="relative z-10 pb-8 text-center text-xs text-[var(--color-text-muted)]">
        © {new Date().getFullYear()} Datalens
      </footer>
    </div>
  );
}