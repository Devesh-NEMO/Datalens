/**
 * Filename building and browser download plumbing.
 *
 * Every filename the user can save is produced by `buildFilename`, so the naming
 * rule lives in exactly one place. User-controlled text (the source file name,
 * product names) is treated as untrusted: it is reduced to a safe slug before it
 * is allowed anywhere near a path or a Content-Disposition header.
 *
 * Nothing here touches the network. Blobs are built in memory and handed to the
 * browser directly.
 */

import { DOWNLOAD_MIME_TYPES } from '@/lib/constants';

export type DownloadExtension = 'csv' | 'svg' | 'png' | 'pdf' | 'zip';

/** Prefixed to every filename, per the naming rule. */
const FILENAME_PREFIX = 'datalens';

/** Fallbacks so a file name that slugs to nothing never yields "datalens--". */
const SOURCE_FALLBACK = 'file';
const ITEM_FALLBACK = 'item';

/** Longest slug kept per filename part, before joining. */
const MAX_PART_LENGTH = 48;

/** Hard ceiling on the assembled filename, minus the date and extension. */
const MAX_FILENAME_LENGTH = 120;

/**
 * Delay before revoking the object URL. Revoking in the same tick as
 * `click()` cancels the download in some browsers; a short delay lets the
 * browser take ownership first. The URL is not a secret and holds one Blob.
 */
const OBJECT_URL_REVOKE_DELAY_MS = 1000;

/**
 * C0 and C1 control characters, plus C1, plus every format character. The
 * format range matters for security: it contains the bidi overrides
 * (U+202E and friends) that can visually reverse an extension in a file listing
 * while the real bytes say otherwise.
 */
const UNSAFE_CONTROL_CHARS = /[\p{Cc}\p{Cf}]/gu;

/**
 * Characters that are illegal in a filename on Windows, or that break shells and
 * URL paths. Mapped to a space (not deleted) so "a/b" becomes "a-b" rather than
 * running together into "ab".
 */
/**
 * Characters that are illegal in a filename on Windows, or that break shells and
 * URL paths. Mapped to a space (not deleted) so "a/b" becomes "a-b" rather than
 * running together into "ab".
 *
 * Underscore is included: the documented naming rule turns `sales_messy.csv` into
 * `datalens-sales-messy-pareto-curve-2026-10-01.png`, so word separators of every
 * kind collapse to the same dash.
 */
const UNSAFE_SEPARATORS = /[/\\:*?"<>|_]/g;

const WHITESPACE = /\s+/g;

/** Anything that is not a Unicode letter, number, or dash. */
const NON_SLUG_CHARS = /[^\p{L}\p{N}-]/gu;

const REPEATED_DASHES = /-{2,}/g;

const EDGE_DASHES = /^-+|-+$/g;

/** `YYYY-MM-DD` in local time, which is what a person means by "today". */
export function isoDate(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Reduce arbitrary text to a filesystem-safe slug: lower case, ASCII-safe,
 * spaces become dashes, unsafe characters removed.
 *
 * Unicode letters and numbers are kept on purpose. A dataset of Japanese product
 * names should still produce a recognisable file name, and by this point the only
 * remaining characters are letters, numbers, and dashes, so keeping them cannot
 * reintroduce a path traversal or a reserved character.
 */
export function slugifyPart(input: string): string {
  return input
    .normalize('NFC')
    // Strip control and bidirectional-format characters before anything else,
    // so they cannot be used to disguise the extension that follows.
    .replace(UNSAFE_CONTROL_CHARS, '')
    .replace(UNSAFE_SEPARATORS, ' ')
    .replace(WHITESPACE, '-')
    .replace(NON_SLUG_CHARS, '')
    .replace(REPEATED_DASHES, '-')
    .replace(EDGE_DASHES, '')
    .toLowerCase()
    .slice(0, MAX_PART_LENGTH)
    .replace(EDGE_DASHES, '');
}

/** Drop the extension from a file name. `archive.tar.gz` -> `archive.tar`. */
export function stripExtension(fileName: string): string {
  const lastDot = fileName.lastIndexOf('.');
  // A leading dot is a hidden file, not an extension: ".env" stays ".env".
  if (lastDot <= 0) return fileName;
  return fileName.slice(0, lastDot);
}

export interface BuildFilenameOptions {
  /** The uploaded file's name, e.g. `sales_messy.csv`. Untrusted. */
  sourceFileName: string;
  /** Which item is being downloaded, e.g. `pareto-curve`. */
  itemName: string;
  extension: DownloadExtension;
  /** Defaults to today; injectable so tests are deterministic. */
  date?: Date;
}

/**
 * `datalens-{source-file-name-without-extension}-{item-name}-{YYYY-MM-DD}.{ext}`
 *
 * Example: `datalens-sales-messy-pareto-curve-2026-10-01.png`
 */
export function buildFilename({
  sourceFileName,
  itemName,
  extension,
  date = new Date(),
}: BuildFilenameOptions): string {
  const source = slugifyPart(stripExtension(sourceFileName)) || SOURCE_FALLBACK;
  const item = slugifyPart(itemName) || ITEM_FALLBACK;
  const stamp = isoDate(date);

  // Trim the source part first, since the suffix is fixed length and must survive.
  const room = Math.max(1, MAX_FILENAME_LENGTH - `${FILENAME_PREFIX}-${item}-${stamp}.${extension}`.length);
  const trimmedSource = source.length > room ? source.slice(0, room).replace(EDGE_DASHES, '') : source;

  return `${FILENAME_PREFIX}-${trimmedSource}-${item}-${stamp}.${extension}`;
}

export function mimeTypeFor(extension: DownloadExtension): string {
  return DOWNLOAD_MIME_TYPES[extension] ?? 'application/octet-stream';
}

export interface TriggerDownloadResult {
  /** Revoke early if you know the browser has taken ownership of the URL. */
  revoke: () => void;
}

/**
 * Hand a Blob to the browser as a file download.
 *
 * The anchor is appended to the document before clicking because Firefox ignores
 * clicks on detached elements, and removed afterwards so repeated downloads do
 * not accumulate hidden nodes in the DOM.
 */
export function triggerDownload(blob: Blob, filename: string): TriggerDownloadResult {
  const url = URL.createObjectURL(blob);
  let revoked = false;

  const revoke = () => {
    if (revoked) return;
    revoked = true;
    URL.revokeObjectURL(url);
  };

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  const timer = setTimeout(revoke, OBJECT_URL_REVOKE_DELAY_MS);
  // Do not hold a Node process open in tests for the revoke delay.
  if (typeof timer === 'object' && timer !== null && 'unref' in timer) {
    (timer as { unref: () => void }).unref();
  }

  return { revoke };
}

/** Convenience for text exports; always UTF-8 with a BOM-free CSV-friendly type. */
export function downloadText(
  text: string,
  { filename, extension = 'csv' }: { filename: string; extension?: DownloadExtension }
): TriggerDownloadResult {
  return triggerDownload(new Blob([text], { type: mimeTypeFor(extension) }), filename);
}