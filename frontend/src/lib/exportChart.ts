/**
 * Chart export pipeline: offscreen React render -> inlined SVG -> PNG.
 *
 * The live chart is never captured. It is a `ResponsiveContainer` sized to the
 * viewport, so a screenshot of it would be a phone-width chart blown up. Instead
 * the same component is rendered a second time into a detached, fixed-size box
 * with a chosen theme class, and that second render is what gets serialised.
 *
 * Everything happens in the browser. No network calls, no server round trip.
 */

import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { createElement, type ReactNode } from 'react';
import { ChartExportProvider } from '@/components/charts/ChartExportContext';
import { THEME_COLORS, type ThemeName } from '@/lib/constants';

/** Default export size: 16:9, large enough to stay crisp at 2x. */
export const EXPORT_WIDTH = 1200;
export const EXPORT_HEIGHT = 675;

/** Vertical bands reserved above and below the plot for title and caption. */
const TITLE_BAND = 64;
const CAPTION_BAND = 46;

/** PNG is drawn at this multiple of the layout size for retina sharpness. */
export const PNG_SCALE = 2;

/** How long to wait for a paint before assuming the frame will never arrive. */
const FRAME_FALLBACK_MS = 100;

const TITLE_FONT_SIZE = 22;
const CAPTION_FONT_SIZE = 14;

/** Plot area size, excluding the title and caption bands. */
export interface ChartRenderSize {
  width: number;
  height: number;
}

export interface ChartExportOptions {
  /**
   * Renders the chart exactly as it appears on screen, minus the download UI.
   * Receives the plot size to render at, because Recharts draws nothing without
   * explicit dimensions when there is no ResponsiveContainer to measure.
   */
  render: (size: ChartRenderSize) => ReactNode;
  title: string;
  caption?: string;
  /** Theme applied to the offscreen copy. Defaults to the light print theme. */
  theme?: ThemeName;
  width?: number;
  height?: number;
}

export interface ChartExportResult {
  /** Standalone SVG: explicit size, resolved colours, inlined fonts. */
  svg: string;
  width: number;
  height: number;
  /** Resolved background colour, so callers never emit transparency. */
  background: string;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgElement<K extends keyof SVGElementTagNameMap>(
  document: Document,
  name: K,
  attrs: Record<string, string | number>
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  return el;
}

/**
 * Copy computed presentation from the live offscreen tree onto the SVG clone.
 *
 * Charts are coloured with `var(--color-*)` custom properties. Those resolve
 * only against a DOM carrying the right theme class; once serialised, `var(...)`
 * means nothing to a canvas or an image viewer. Reading `getComputedStyle`
 * while the element is still in the themed offscreen tree bakes in real colours.
 *
 * Values are written unconditionally, overwriting what Recharts set. That is the
 * point: the attribute Recharts already wrote is usually the unresolved
 * `var(--color-class-a)`, so skipping existing attributes would leave exactly the
 * values we came here to replace.
 */
export function inlineComputedStyles(source: SVGElement, target: SVGElement): void {
  const sourceNodes = [source, ...Array.from(source.querySelectorAll('*'))];
  const targetNodes = [target, ...Array.from(target.querySelectorAll('*'))];

  const shapeProps = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-dasharray', 'opacity'] as const;
  const textProps = ['font-family', 'font-size', 'font-weight', 'letter-spacing'] as const;

  sourceNodes.forEach((node, index) => {
    const copy = targetNodes[index];
    if (!copy) return;

    // Metadata and defs are not painted, and writing presentation attributes on
    // them only adds noise. The root <svg> is skipped for `fill` too: its
    // computed fill is the SVG default of black, and setting it would make every
    // unpainted descendant inherit black.
    const tag = node.tagName.toLowerCase();
    if (tag === 'title' || tag === 'desc' || tag === 'defs') return;

    const computed = window.getComputedStyle(node);
    const props = tag === 'text' ? [...shapeProps, ...textProps] : shapeProps;
    const isRoot = copy === target;

    for (const prop of props) {
      // Never force a fill onto the root SVG; the background rect already covers it.
      if (isRoot && prop === 'fill') continue;
      const value = computed.getPropertyValue(prop);
      if (value) copy.setAttribute(prop, value);
    }
  });
}

/**
 * Build the standalone SVG: solid background, title band, plot, caption band.
 *
 * Title and caption are drawn as real SVG text rather than HTML around the
 * chart. `foreignObject` would be simpler but does not rasterise in a canvas,
 * so PNG and PDF would silently lose them.
 */
export function buildStandaloneSvg(
  clone: SVGSVGElement,
  {
    title,
    caption,
    width,
    height,
    background,
    fontFamily,
    theme,
  }: {
    title: string;
    caption?: string;
    width: number;
    height: number;
    background: string;
    fontFamily: string;
    /** Used for the title and caption colours. Passed in, never inferred. */
    theme: ThemeName;
  }
): string {
  clone.setAttribute('xmlns', SVG_NS);
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  clone.setAttribute('viewBox', `0 0 ${width} ${height}`);
  clone.setAttribute('font-family', fontFamily);
  clone.removeAttribute('style');
  clone.removeAttribute('class');

  const document_ = clone.ownerDocument;

  // Solid background first, so nothing shows through as transparency.
  const backgroundRect = svgElement(document_, 'rect', {
    x: 0,
    y: 0,
    width,
    height,
    fill: background,
  });
  clone.insertBefore(backgroundRect, clone.firstChild);

  const palette = THEME_COLORS[theme];

  const titleText = svgElement(document_, 'text', {
    x: 24,
    y: TITLE_BAND - 26,
    'font-size': TITLE_FONT_SIZE,
    'font-weight': 600,
    fill: palette.text,
  });
  titleText.textContent = title;
  clone.appendChild(titleText);

  if (caption) {
    const captionText = svgElement(document_, 'text', {
      x: 24,
      y: height - 18,
      'font-size': CAPTION_FONT_SIZE,
      fill: palette.mutedText,
    });
    captionText.textContent = caption;
    clone.appendChild(captionText);
  }

  return new XMLSerializer().serializeToString(clone);
}

/**
 * Wait for layout and a paint so Recharts has measured its box.
 *
 * `requestAnimationFrame` alone is not safe here: it does not fire in a
 * background tab, so a user who switches tabs mid-export would sit on a spinner
 * that never resolves. Racing each frame against a timer guarantees progress.
 */
function nextFrames(count = 2): Promise<void> {
  return new Promise((resolve) => {
    let remaining = count;
    const tick = () => {
      remaining -= 1;
      if (remaining <= 0) resolve();
      else waitForFrame().then(tick);
    };
    waitForFrame().then(tick);
  });
}

/** Resolve on the next animation frame, or shortly after if there is none. */
function waitForFrame(): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    requestAnimationFrame(done);
    // Fallback for hidden or throttled tabs where rAF never fires.
    setTimeout(done, FRAME_FALLBACK_MS);
  });
}

/**
 * Render a chart offscreen and return a standalone SVG.
 *
 * The container is positioned off-canvas rather than hidden: `display:none`
 * would leave Recharts with a zero-sized box, and `visibility:hidden` still
 * participates in layout, which is exactly what is needed here.
 */
export async function renderChartToSvg(options: ChartExportOptions): Promise<ChartExportResult> {
  const {
    render,
    title,
    caption,
    theme = 'light',
    width = EXPORT_WIDTH,
    height = EXPORT_HEIGHT,
  } = options;

  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  // The theme class is what makes the chart's var(--color-*) resolve.
  host.className = theme;
  Object.assign(host.style, {
    position: 'fixed',
    left: '-20000px',
    top: '0',
    width: `${width}px`,
    // Leave room for the title and caption bands drawn into the SVG.
    height: `${Math.max(1, height - TITLE_BAND - CAPTION_BAND)}px`,
    pointerEvents: 'none',
    background: THEME_COLORS[theme].page,
  } satisfies Partial<CSSStyleDeclaration>);

  document.body.appendChild(host);

  const root = createRoot(host);
  try {
    // The plot gets whatever is left after the title and caption bands.
    const plotHeight = Math.max(1, height - TITLE_BAND - CAPTION_BAND);

    flushSync(() => {
      root.render(
        createElement(
          ChartExportProvider,
          null,
          render({ width, height: plotHeight })
        )
      );
    });
    await nextFrames(3);

    // Recharts puts the drawn surface in a wrapper; the bare <svg> is what we
    // want to serialise, so take the first one inside that wrapper.
    const surface = (host.querySelector('.recharts-wrapper > svg') ??
      host.querySelector('svg')) as SVGSVGElement | null;
    if (!surface) {
      throw new Error('The chart did not render anything to export.');
    }
    const source: SVGElement = surface;

    // Drop interactive chrome: a tooltip only exists while hovering, and the
    // download menu must never appear inside the image it produced.
    source.querySelectorAll('.recharts-tooltip-wrapper').forEach((node) => node.remove());

    const background = window
      .getComputedStyle(host)
      .getPropertyValue('background-color')
      .trim() || THEME_COLORS[theme].page;
    const fontFamily = window.getComputedStyle(host).fontFamily;

    const clone = source.cloneNode(true) as SVGSVGElement;
    // Re-target inlined lookups at the clone, which shares the node order.
    inlineComputedStyles(source, clone);

    return {
      svg: buildStandaloneSvg(clone, {
        title,
        caption,
        width,
        height,
        background,
        fontFamily,
        theme,
      }),
      width,
      height,
      background,
    };
  } finally {
    // Unmount before detaching so React can run cleanup effects.
    flushSync(() => root.unmount());
    host.remove();
  }
}

/**
 * A chart drawn to a canvas, ready to be encoded as PNG or handed to jsPDF.
 *
 * PNG and PDF share this one raster so the two files cannot disagree about what
 * the chart looks like.
 */
export interface ChartCanvasResult extends ChartExportResult {
  canvas: HTMLCanvasElement;
  /** Pixel size of `canvas`, which is `width * scale` by `height * scale`. */
  pixelWidth: number;
  pixelHeight: number;
}

/** Rasterise a standalone SVG onto a canvas at `scale` times its layout size. */
export async function svgToCanvas(
  svg: string,
  { width, height, background }: ChartExportResult,
  scale: number = PNG_SCALE
): Promise<ChartCanvasResult> {
  const blobUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));

  try {
    const image = await loadImage(blobUrl);

    const canvas = document.createElement('canvas');
    const pixelWidth = Math.round(width * scale);
    const pixelHeight = Math.round(height * scale);
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;

    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser cannot generate images (no 2D canvas).');

    // Paint the background explicitly. The SVG already carries one, but a
    // double guarantee is cheap and transparent PNGs are a real failure mode.
    context.fillStyle = background;
    context.fillRect(0, 0, pixelWidth, pixelHeight);
    context.drawImage(image, 0, 0, pixelWidth, pixelHeight);

    return { svg, canvas, width, height, background, pixelWidth, pixelHeight };
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

/** Render a chart offscreen and draw it to a canvas. */
export async function renderChartToCanvas(
  options: ChartExportOptions,
  scale: number = PNG_SCALE
): Promise<ChartCanvasResult> {
  const result = await renderChartToSvg(options);
  return svgToCanvas(result.svg, result, scale);
}

/** Render a chart offscreen and encode it as a PNG Blob at 2x. */
export async function renderChartToPng(
  options: ChartExportOptions,
  scale: number = PNG_SCALE
): Promise<Blob> {
  const { canvas } = await renderChartToCanvas(options, scale);
  return canvasToPngBlob(canvas);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The chart image could not be decoded.'));
    image.src = src;
  });
}

/** Encode a canvas as PNG. */
export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('The chart image could not be saved.'));
    }, 'image/png');
  });
}