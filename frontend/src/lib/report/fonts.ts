/**
 * Lazy-loaded Unicode font for jsPDF.
 *
 * jsPDF's built-in PDF fonts are WinAnsi only: they cover Latin-1 and cannot
 * encode a product name in Japanese, Cyrillic, Greek, or Devanagari. A report
 * full of tofu boxes is worse than one in a slightly less pretty font, so we try
 * to register a TrueType font that covers the range.
 *
 * Nothing is fetched until a report is actually requested, and a missing or
 * corrupt font file is not an error: the caller falls back to Helvetica and
 * reports `failed` so the options panel can warn before the user downloads.
 */

/** Name the font is registered under, used by every draw call in the report. */
export const PDF_FONT_FAMILY = 'NotoSans';

/** The standard font used when the Unicode font is unavailable. */
export const PDF_FONT_FALLBACK = 'helvetica';

const REGULAR_URL = '/fonts/NotoSans-Regular.ttf';
const BOLD_URL = '/fonts/NotoSans-Bold.ttf';

/**
 * The result of the availability preflight, cached for the session.
 *
 * `null` means "not asked yet".
 */
let availability: Promise<boolean> | null = null;

/**
 * Check whether the Unicode font files are reachable, without downloading them.
 *
 * The options panel calls this so it can warn *before* the user commits to a
 * download. Discovering the font is missing only after the report has already
 * been assembled would leave nowhere to put the warning.
 */
export function arePdfFontsAvailable(): Promise<boolean> {
  availability ??= (async () => {
    try {
      const responses = await Promise.all(
        [REGULAR_URL, BOLD_URL].map((url) =>
          fetch(url, { method: 'HEAD' }).catch(() => null)
        )
      );
      return responses.every((response) => response?.ok === true);
    } catch {
      return false;
    }
  })();
  return availability;
}

/** Test seam: forget the cached preflight. */
export function resetPdfFontAvailabilityForTests(): void {
  availability = null;
}

/** Base64, in chunks, because `String.fromCharCode(...bytes)` blows the stack. */
function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

async function fetchFont(url: string): Promise<ArrayBuffer | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const buffer = await response.arrayBuffer();
    // A zero-length body is a sign of a broken deploy, not a valid font.
    return buffer.byteLength > 0 ? buffer : null;
  } catch {
    // Offline, blocked by CSP, or the static asset is missing. All the same here.
    return null;
  }
}

export interface PdfFontResult {
  /** True when Noto Sans is registered and set as the current font. */
  ok: boolean;
  /** True when we fell back to Helvetica. */
  failed: boolean;
}

/**
 * Register Noto Sans regular and bold on `doc`, and set it as the current font.
 *
 * Bold is not optional: headings and table headers are drawn in bold, and
 * jsPDF's font fallback for an unregistered style is not guaranteed to be
 * legible. If either file is missing, nothing is registered and Helvetica is
 * used, which keeps a partially-registered font family from producing
 * inconsistent weight.
 */
export async function loadPdfFonts(doc: {
  addFont: (data: string, name: string, style: string, format: string) => unknown;
  setFont: (name: string, style: string) => unknown;
}): Promise<PdfFontResult> {
  const [regular, bold] = await Promise.all([fetchFont(REGULAR_URL), fetchFont(BOLD_URL)]);

  if (!regular || !bold) {
    doc.setFont(PDF_FONT_FALLBACK, 'normal');
    return { ok: false, failed: true };
  }

  try {
    doc.addFont(toBase64(regular), PDF_FONT_FAMILY, 'normal', 'ttf');
    doc.addFont(toBase64(bold), PDF_FONT_FAMILY, 'bold', 'ttf');
    doc.setFont(PDF_FONT_FAMILY, 'normal');
    return { ok: true, failed: false };
  } catch {
    // A truncated or unsupported TTF makes addFont throw. Do not leave the
    // document pointing at a family that has no usable data.
    doc.setFont(PDF_FONT_FALLBACK, 'normal');
    return { ok: false, failed: true };
  }
}
