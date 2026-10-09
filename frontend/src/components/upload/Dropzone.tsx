'use client';

import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, FileUp, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/cn';
import { ACCEPTED_FORMATS_SUMMARY, DROPZONE_ACCEPT, MAX_FILE_SIZE_MB } from '@/lib/constants';
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
 * Drag-and-drop with a click-to-browse fallback, styled as a real card: a
 * visible dashed border with decent contrast, a tinted surface, an upload icon
 * in a soft indigo circle, and file-type chips plus the size limit. Keyboard
 * operable because react-dropzone wires the Enter/Space handlers onto the root
 * element and exposes it as a labelled button.
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
          'dropzone flex flex-col items-center justify-center gap-4 px-8 py-10 text-center',
          isLoading && 'opacity-60 cursor-not-allowed',
          isDragReject ? 'reject' : isDragActive ? 'active' : undefined
        )}
      >
        <input {...getInputProps()} disabled={isLoading} className="sr-only" />

        {isDragActive ? (
          <>
            <span className="app-icon-circle h-14 w-14">
              <FileUp className="h-6 w-6" aria-hidden="true" />
            </span>
            <p className="text-[var(--color-text)]">Drop it here</p>
          </>
        ) : (
          <>
            <span className="app-icon-circle h-14 w-14">
              <Upload className="h-6 w-6" aria-hidden="true" />
            </span>
            <div className="space-y-1">
              <p className="text-[15px] font-medium text-[var(--color-text)]">
                {isLoading ? 'Analyzing…' : 'Drag & drop, or click to browse'}
              </p>
              <p className="label-xs">{DROPZONE_HELPER_TEXT}</p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-1.5">
              <span className="app-file-chip">{ACCEPTED_FORMATS_SUMMARY}</span>
              <span className="text-xs text-[var(--color-text-muted)]">
                up to {MAX_FILE_SIZE_MB} MB
              </span>
            </div>
          </>
        )}
      </div>

      {/* Rejections are announced so screen reader users learn why nothing happened. */}
      <div role="alert" aria-live="assertive">
        {rejection && (
          <div className="mt-3 flex items-start gap-2 text-sm">
            <AlertCircle
              className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--color-critical)]"
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