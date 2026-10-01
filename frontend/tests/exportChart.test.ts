import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  buildStandaloneSvg,
  inlineComputedStyles,
  EXPORT_WIDTH,
  EXPORT_HEIGHT,
  PNG_SCALE,
} from '@/lib/exportChart';

function makeSvg(markup: string): SVGSVGElement {
  const host = document.createElement('div');
  host.innerHTML = markup;
  return host.querySelector('svg') as SVGSVGElement;
}

/**
 * jsdom does not implement layout, so getComputedStyle returns empty strings for
 * most properties. `inlineComputedStyles` is tested here through the values jsdom
 * can answer for; the browser check covers the real rendering path.
 */
describe('inlineComputedStyles', () => {
  it('copies computed presentation onto the clone', () => {
    const source = makeSvg('<svg><path d="M0 0" /></svg>');
    const target = source.cloneNode(true) as SVGSVGElement;

    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      getPropertyValue: (prop: string) =>
        prop === 'fill' ? 'rgb(126, 224, 176)' : prop === 'stroke' ? 'none' : '',
    } as unknown as CSSStyleDeclaration);

    inlineComputedStyles(source, target);

    const path = target.querySelector('path');
    expect(path?.getAttribute('fill')).toBe('rgb(126, 224, 176)');
  });

  it('overwrites an existing attribute, which is where unresolved var() lives', () => {
    // Recharts writes fill="var(--color-class-a)". If existing attributes were
    // skipped, that reference would survive into the exported file.
    const source = makeSvg('<svg><path fill="var(--color-class-a)" d="M0 0" /></svg>');
    const target = source.cloneNode(true) as SVGSVGElement;

    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      getPropertyValue: (prop: string) => (prop === 'fill' ? 'rgb(126, 224, 176)' : ''),
    } as unknown as CSSStyleDeclaration);

    inlineComputedStyles(source, target);

    const fill = target.querySelector('path')?.getAttribute('fill');
    expect(fill).toBe('rgb(126, 224, 176)');
    expect(fill).not.toContain('var(--');
  });

  it('never sets fill on the root svg, so unpainted children do not inherit black', () => {
    const source = makeSvg('<svg><g><path d="M0 0" /></g></svg>');
    const target = source.cloneNode(true) as SVGSVGElement;

    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      getPropertyValue: (prop: string) => (prop === 'fill' ? 'rgb(0, 0, 0)' : ''),
    } as unknown as CSSStyleDeclaration);

    inlineComputedStyles(source, target);

    expect(target.getAttribute('fill')).toBeNull();
    expect(target.querySelector('path')?.getAttribute('fill')).toBe('rgb(0, 0, 0)');
  });

  it('skips title and desc, which are metadata rather than painted content', () => {
    const source = makeSvg('<svg><title>t</title><desc>d</desc><path d="M0 0" /></svg>');
    const target = source.cloneNode(true) as SVGSVGElement;

    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      getPropertyValue: () => 'rgb(0, 0, 0)',
    } as unknown as CSSStyleDeclaration);

    inlineComputedStyles(source, target);

    expect(target.querySelector('title')?.getAttribute('fill')).toBeNull();
    expect(target.querySelector('desc')?.getAttribute('fill')).toBeNull();
  });
});

describe('buildStandaloneSvg', () => {
  let clone: SVGSVGElement;

  beforeEach(() => {
    clone = makeSvg('<svg><rect x="0" y="0" width="10" height="10" /></svg>');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const build = (overrides: Partial<Parameters<typeof buildStandaloneSvg>[1]> = {}) =>
    buildStandaloneSvg(clone, {
      title: 'Pareto curve',
      caption: 'Bars show value.',
      width: EXPORT_WIDTH,
      height: EXPORT_HEIGHT,
      background: '#F7F4EC',
      fontFamily: 'Georgia, serif',
      theme: 'light',
      ...overrides,
    });

  it('sets explicit size, viewBox and xmlns so the file stands alone', () => {
    const svg = build();
    expect(svg).toContain(`width="${EXPORT_WIDTH}"`);
    expect(svg).toContain(`height="${EXPORT_HEIGHT}"`);
    expect(svg).toContain(`viewBox="0 0 ${EXPORT_WIDTH} ${EXPORT_HEIGHT}"`);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  it('embeds the font stack', () => {
    expect(build()).toContain('font-family="Georgia, serif"');
  });

  it('paints a solid background rather than leaving transparency', () => {
    const svg = build({ background: '#0E0E10' });
    expect(svg).toContain('fill="#0E0E10"');
    // Background must be first so nothing draws over it.
    expect(svg.indexOf('#0E0E10')).toBeLessThan(svg.indexOf('<rect x="0" y="0" width="10"'));
  });

  it('includes the title and caption as real SVG text', () => {
    const svg = build();
    expect(svg).toContain('Pareto curve');
    expect(svg).toContain('Bars show value.');
  });

  it('omits the caption when there is none', () => {
    expect(build({ caption: undefined })).not.toContain('Bars show value.');
  });

  it('uses the light palette text colours when the theme is light', () => {
    const svg = build({ theme: 'light' });
    expect(svg).toContain('fill="#1A1916"');
    expect(svg).toContain('fill="#6B675E"');
  });

  it('uses the dark palette text colours when the theme is dark', () => {
    // Regression: the theme used to be inferred from the background by comparing
    // an rgb() string against a hex value, which never matched, so a dark export
    // got light text on a dark background.
    const svg = build({ theme: 'dark', background: '#0E0E10' });
    expect(svg).toContain('fill="#ECE9E2"');
    expect(svg).toContain('fill="#8B877E"');
    expect(svg).not.toContain('fill="#1A1916"');
  });

  it('strips class and style from the root, which would re-introduce theming', () => {
    clone.setAttribute('class', 'recharts-surface');
    clone.setAttribute('style', 'overflow:visible');
    const svg = build();
    expect(svg).not.toContain('class="recharts-surface"');
    expect(svg).not.toContain('overflow:visible');
  });

  it('does not use foreignObject, which would not rasterise to PNG', () => {
    expect(build()).not.toContain('foreignObject');
  });
});

describe('export size constants', () => {
  it('renders PNGs at 2x for retina output', () => {
    expect(PNG_SCALE).toBe(2);
  });

  it('uses a 16:9 export canvas', () => {
    expect(EXPORT_WIDTH / EXPORT_HEIGHT).toBeCloseTo(16 / 9, 2);
  });
});