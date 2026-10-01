'use client';

import { FileText, Check } from 'lucide-react';
import { Button } from '@/components/ui';

interface SampleButtonsProps {
  onSampleSelect: (type: 'clean' | 'messy') => void;
  isLoading?: boolean;
  activeSample?: 'clean' | 'messy' | null;
}

export function SampleButtons({ onSampleSelect, isLoading, activeSample }: SampleButtonsProps) {
  return (
    <div className="flex flex-col sm:flex-row gap-3 justify-center w-full max-w-md">
      <Button
        variant={activeSample === 'clean' ? 'primary' : 'outline'}
        size="sm"
        onClick={() => onSampleSelect('clean')}
        disabled={isLoading}
        className="w-full sm:w-auto flex-1"
      >
        <FileText className="h-4 w-4" aria-hidden="true" />
        <span>Try sales_clean.csv</span>
        {activeSample === 'clean' && <Check className="h-4 w-4" aria-hidden="true" />}
      </Button>
      <Button
        variant={activeSample === 'messy' ? 'primary' : 'outline'}
        size="sm"
        onClick={() => onSampleSelect('messy')}
        disabled={isLoading}
        className="w-full sm:w-auto flex-1"
      >
        <FileText className="h-4 w-4" aria-hidden="true" />
        <span>Try sales_messy.csv</span>
        {activeSample === 'messy' && <Check className="h-4 w-4" aria-hidden="true" />}
      </Button>
    </div>
  );
}