'use client';

import { cn } from '@/lib/cn';
import { FileText } from 'lucide-react';
import { Dropzone } from '@/components/upload/Dropzone';
import { DatabaseHelp } from '@/components/upload/DatabaseHelp';
import { SampleButtons } from '@/components/upload/SampleButtons';
import { EMPTY_STATE_DESCRIPTION, TAGLINE } from '@/lib/constants';

interface EmptyStateProps {
  onUpload: (file: File) => void;
  onSampleSelect: (type: 'clean' | 'messy') => void;
  isLoading?: boolean;
}

export function EmptyState({ onUpload, onSampleSelect, isLoading = false }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center min-h-[60vh] justify-center gap-10 py-8">
      <div className="max-w-xl space-y-4 text-center">
        <h1 className="font-serif text-hero leading-[1.05] text-balance text-[var(--color-text)]">
          {TAGLINE}
        </h1>
        <p className="text-lg text-[var(--color-muted-text)]">{EMPTY_STATE_DESCRIPTION}</p>
      </div>

      <div className="w-full max-w-md space-y-6">
        <Dropzone onFileSelect={onUpload} isLoading={isLoading} />

        <div className="space-y-3">
          <span className="label-xs">Try with sample data</span>
          <SampleButtons onSampleSelect={onSampleSelect} isLoading={isLoading} />
        </div>

        <hr className="h-px border-0 bg-[var(--color-rule)]" />

        <div className={cn('flex justify-center')}>
          <DatabaseHelp />
        </div>
      </div>
    </div>
  );
}

/** Kept for the header's "Analyze another file" affordance. */
export { FileText };
