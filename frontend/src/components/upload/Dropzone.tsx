'use client';

import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, FileUp, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/cn';
import { DROPZONE_ACCEPT } from '@/lib/constants';
import {
  DROPZONE_HELPER_TEXT,
  validateSelection,
  type FileRejection,
} from '@/lib/fileValidation';

interface DropzoneProps {
  onFileSelect: (file: File) => void;
  isLoading?: boolean;
}

/**
 * Drag-and-drop with a click-to-browse fallback. Keyboard operable because
 * react-dropzone wires the Enter/Space handlers onto the root element and
 * exposes it as a labelled button.
 */
export function Dropzone({ onFileSelect, isLoading = false }: DropzoneProps) {
  const [rejection, setRejection] = useState<FileRejection | null>(null);

  // react-dropzone rejects files that fail its own `accept`/`maxFiles` filter
  // before our validator sees them, so we read the rejections here and produce
  // our own case-specific copy rather than its generic message.
  const onDrop = useCallback(
    (acceptedFiles: File[], fileRejections: readonly { file: File }[]) => {
      if (acceptedFiles.length > 0) {
        const problem = validateSelection(acceptedFiles);
        if (problem) {
          setRejection(problem);
          return;
        }
        setRejection(null);
        onFileSelect(acceptedFiles[0]);
        return;
      }

      const rejected = fileRejections.map((r) => r.file);
      if (rejected.length === 0) return;

      setRejection(
        validateSelection(rejected) ?? {
          message: 'That file could not be read.',
          hint: 'Please try a different file.',
        }
      );
    },
    [onFileSelect]
  );

  const { getRootProps, getInputProps, isDragActive, isDragReject } = useDropzone({
    onDrop,
    accept: DROPZONE_ACCEPT,
    maxFiles: 1,
    disabled: isLoading,
  });

  return (
    <div className="w-full">
      <div
        {...getRootProps()}
        role="button"
        tabIndex={isLoading ? -1 : 0}
        aria-disabled={isLoading}
        aria-label="Upload a data file. Drag and drop, or press Enter to browse."
        className={cn(
          'flex flex-col items-center justify-center gap-3 p-8 control',
          'border border-dashed transition-colors cursor-pointer text-center',
          isLoading && 'opacity-60 cursor-not-allowed',
          isDragReject
            ? 'border-[var(--color-class-c)] bg-[var(--color-class-c)]/10'
            : isDragActive
              ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10'
              : 'border-[var(--color-rule)] hover:border-[var(--color-muted-text)]'
        )}
      >
        <input {...getInputProps()} disabled={isLoading} className="sr-only" />

        {isDragActive ? (
          <>
            <FileUp className="h-8 w-8 text-[var(--color-accent)]" aria-hidden="true" />
            <p className="text-[var(--color-text)]">Drop it here</p>
          </>
        ) : (
          <>
            <Upload className="h-8 w-8 text-[var(--color-muted-text)]" aria-hidden="true" />
            <p className="text-[var(--color-text)]">
              {isLoading ? 'Analyzing…' : 'Drag & drop, or click to browse'}
            </p>
            <p className="label-xs">{DROPZONE_HELPER_TEXT}</p>
          </>
        )}
      </div>

      {/* Rejections are announced so screen reader users learn why nothing happened. */}
      <div role="alert" aria-live="assertive">
        {rejection && (
          <div className="mt-3 flex items-start gap-2 text-sm">
            <AlertCircle
              className="h-4 w-4 flex-shrink-0 mt-0.5 text-[var(--color-class-c)]"
              aria-hidden="true"
            />
            <div>
              <p className="text-[var(--color-text)]">{rejection.message}</p>
              <p className="text-[var(--color-muted-text)]">{rejection.hint}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
