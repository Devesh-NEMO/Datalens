/**
 * Print palette and page geometry for every PDF Datalens produces.
 *
 * PDFs always use this light palette, whatever theme is on screen. A PDF is
 * usually printed, put in a deck, or pasted into another document, and ink on a
 * dark background costs a reader a toner cartridge and prints as a grey smear.
 * The on-screen "Use light background" checkbox exists for the same reason;
 * here it is not a choice.
 */

import { THEME_COLORS } from '@/lib/constants';

/** A4 in PostScript points, which is jsPDF's working unit. */
export const A4_WIDTH = 595.28;
export const A4_HEIGHT = 841.89;

/** Page margin. Wide enough that a printed page can be written on. */
export const PAGE_MARGIN = 56;

/** Space reserved at the bottom of every page for the footer rule and text. */
export const FOOTER_HEIGHT = 40;

export type Rgb = readonly [number, number, number];

/**
 * Convert a `#rrggbb` token to the 0-255 triplet jsPDF and jspdf-autotable want.
 *
 * Throws rather than returning black on bad input: a silently black PDF would
 * be a contrast bug nobody notices until someone tries to read it.
 */
export function hexToRgb(hex: string): Rgb {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!match) throw new Error(`Expected a #rrggbb colour, got: ${hex}`);
  const value = Number.parseInt(match[1], 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

const light = THEME_COLORS.light;

export const PDF_COLORS = {
  /** Page and table background. Pure white, not the warm screen colour. */
  page: [255, 255, 255] as Rgb,
  text: hexToRgb(light.text),
  mutedText: hexToRgb(light.mutedText),
  rule: hexToRgb(light.rule),
  accent: hexToRgb(light.accent),
  classA: hexToRgb(light.classA),
  classB: hexToRgb(light.classB),
  classC: hexToRgb(light.classC),
  /** Table header fill; a tint of the screen's light page colour. */
  headerFill: hexToRgb(light.page),
  /** Alternating row fill, subtle enough to read black text over. */
  stripeFill: [250, 248, 243] as Rgb,
} satisfies Record<string, Rgb>;

/**
 * Type scale in points. 1pt ≈ 1/72 inch, so 11pt body text matches roughly 15px
 * on screen.
 */
export const PDF_TYPE = {
  display: 26,
  heading: 16,
  subheading: 12,
  body: 10,
  caption: 9,
  tableCell: 8.5,
  footer: 8,
} as const;

/** Row cap for a PDF table. Beyond this the file stops being useful to read. */
export const PDF_ROW_CAP = 5000;