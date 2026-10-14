'use client';

import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import { useAiStatus } from '@/hooks/useAi';
import { cn } from '@/lib/cn';

/**
 * A small, always-honest indicator of how AI answers are produced.
 *
 * It reads `GET /ai/status` and never guesses: "Model on" only when a provider
 * is configured, "Local analysis" when Datalens' deterministic engine answers,
 * "AI off" when the feature is disabled. Links to Settings where the state can
 * be changed. Renders nothing until the status is known, so it never flashes a
 * wrong claim.
 */
export function AiStatusChip({ className }: { className?: string }) {
  const { data, isError, isLoading } = useAiStatus();

  if (isLoading || isError || !data) return null;

  const on = data.enabled && data.configured;
  const label = !data.enabled ? 'AI off' : on ? 'AI on' : 'Local analysis';
  const title = data.message;

  return (
    <Link
      href="/settings"
      title={title}
      aria-label={`AI status: ${label}`}
      className={cn(
        'ai-badge hidden sm:inline-flex',
        on ? 'ai-badge-ai' : 'ai-badge-local',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]',
        className
      )}
    >
      <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {label}
    </Link>
  );
}
