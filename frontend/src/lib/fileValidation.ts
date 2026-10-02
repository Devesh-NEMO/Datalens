/**
 * Client-side file validation. Every rule lives in constants.ts; this module
 * only applies them, so the dropzone, the browse fallback, and the tests all
 * share one implementation.
 */

import {
  ACCEPTED_FORMATS_SUMMARY,
  MAX_FILE_SIZE_BYTES,
  MAX_FILE_SIZE_MB,
  MULTIPLE_FILES_MESSAGE,
  REJECTION_COPY,
  SIZE_LIMIT_MESSAGE,
  SUPPORTED_EXTENSIONS,
} from '@/lib/constants';

export interface FileRejection {
  readonly message: string;
  readonly hint: string;
}

/** Lower-cased extension including the leading dot, or '' when there is none. */
export function fileExtension(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  // A leading dot means a dotfile (.env), not an extension.
  if (dot <= 0) return '';
  return base.slice(dot).toLowerCase();
}

/** True when the backend can read this extension today. */
export function isSupportedExtension(extension: string): boolean {
  return SUPPORTED_EXTENSIONS.includes(extension.toLowerCase());
}

/** Copy for a rejected extension, chosen by the ordered rules in constants. */
export function rejectionFor(extension: string): FileRejection {
  const ext = extension.toLowerCase();
  const match = REJECTION_COPY.find((rule) => rule.test(ext));
  return { message: match?.message ?? 'Unknown file type.', hint: match?.hint ?? '' };
}

/**
 * Validate a single file against the supported types and the size limit.
 * Returns null when the file is acceptable.
 */
export function validateFile(file: File): FileRejection | null {
  const ext = fileExtension(file.name);

  if (!isSupportedExtension(ext)) {
    return rejectionFor(ext);
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return { message: 'File too large.', hint: SIZE_LIMIT_MESSAGE };
  }

  return null;
}

/** Validate a drop selection: exactly one acceptable file. */
export function validateSelection(files: readonly File[]): FileRejection | null {
  if (files.length === 0) return null;
  if (files.length > 1) {
    return { message: 'Too many files.', hint: MULTIPLE_FILES_MESSAGE };
  }
  return validateFile(files[0]);
}

export const DROPZONE_HELPER_TEXT = `${ACCEPTED_FORMATS_SUMMARY} · Max ${MAX_FILE_SIZE_MB} MB`;
