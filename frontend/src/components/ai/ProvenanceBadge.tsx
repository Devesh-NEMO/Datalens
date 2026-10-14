'use client';

import { Bot, ShieldAlert, Sparkles } from 'lucide-react';
import { cn } from '@/lib/cn';

/** The provenance fields every AI response carries. All are optional so the
 *  badge can be handed a partial object (e.g. one insight section). */
export interface Provenance {
  is_ai?: boolean;
  source?: string;
  provider?: string;
  model?: string;
  fell_back?: boolean;
  fallback_reason?: string | null;
}

type Kind = 'ai' | 'local' | 'fallback';

function classify(p: Provenance): Kind {
  if (p.fell_back) return 'fallback';
  if (p.is_ai || p.source === 'ai') return 'ai';
  return 'local';
}

/**
 * Honest provenance label for any AI-written block.
 *
 * Three states, matching the fields the API returns:
 *  - `is_ai`    — written by a model ("AI-written · gpt-4o-mini").
 *  - local      — composed from the deterministic analysis ("Local analysis").
 *  - `fell_back`— a provider was configured and failed, so the checked local
 *                 text is shown instead ("AI unavailable · local analysis").
 */
export function ProvenanceBadge({
  provenance,
  className,
}: {
  provenance: Provenance;
  className?: string;
}) {
  const kind = classify(provenance);
  const label =
    kind === 'ai'
      ? `AI-written${provenance.model ? ` · ${provenance.model}` : ''}`
      : kind === 'fallback'
        ? 'AI unavailable · local analysis'
        : 'Local analysis';

  const Icon = kind === 'ai' ? Sparkles : kind === 'fallback' ? ShieldAlert : Bot;

  const tone =
    kind === 'ai' ? 'ai-badge-ai' : kind === 'fallback' ? 'ai-badge-fallback' : 'ai-badge-local';

  return (
    <span
      title={
        provenance.fell_back && provenance.fallback_reason ? provenance.fallback_reason : undefined
      }
      className={cn('ai-badge', tone, className)}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {label}
    </span>
  );
}
