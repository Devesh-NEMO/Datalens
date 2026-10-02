'use client';

/**
 * Per-chart download wiring.
 *
 * Charts declare what they are and what their underlying rows look like; this
 * module turns that into `DownloadMenu` items. Adding a chart to the download
 * menu means adding one `useChartDownloads` call, not hand-writing four
 * handlers per chart.
 *
 * Every export renders offscreen in the browser. No network calls.
 */

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import type { DownloadMenuItem } from '@/components/ui/DownloadMenu';
import { DOWNLOAD_COPY, DOWNLOAD_ITEMS, type DownloadItemSlug } from '@/lib/constants';
import { buildFilename, triggerDownload, downloadText, type DownloadExtension } from '@/lib/download';
import { canvasToPngBlob, renderChartToCanvas, renderChartToSvg } from '@/lib/exportChart';
import type { ChartRenderSize } from '@/lib/exportChart';
import { useTheme } from '@/hooks/useTheme';
import type { Theme } from '@/hooks/useTheme';

/** One row of a chart's underlying data. */
export type ChartRow = Record<string, string | number | null | undefined>;

export type { ChartRenderSize };

export interface UseChartDownloadsOptions {
  /**
   * Re-renders the chart at the given export size. Must be stable or the menu
   * re-renders needlessly.
   */
  render: (size: ChartRenderSize) => ReactNode;
  /** Which entry in DOWNLOAD_ITEMS this chart is. */
  item: keyof typeof DOWNLOAD_ITEMS;
  title: string;
  caption?: string;
  /** The uploaded file's name, for the filename. */
  sourceFileName: string;
  /** Rows for the CSV option. Omit to hide CSV from the menu. */
  csvRows?: () => ChartRow[];
}

export interface UseChartDownloadsResult {
  items: DownloadMenuItem[];
  lightBackground: boolean;
  setLightBackground: (value: boolean) => void;
}

export function useChartDownloads({
  render,
  item,
  title,
  caption,
  sourceFileName,
  csvRows,
}: UseChartDownloadsOptions): UseChartDownloadsResult {
  const { theme } = useTheme();
  const [lightBackground, setLightBackground] = useState(false);
  const slug: DownloadItemSlug = DOWNLOAD_ITEMS[item].slug;

  const filename = useCallback(
    (extension: DownloadExtension) => buildFilename({ sourceFileName, itemName: slug, extension }),
    [sourceFileName, slug]
  );

  // The theme every raster format uses. SVG is a file the user may open in a
  // viewer on a white background, but it still follows the screen theme unless
  // the light-background box is ticked, so all formats agree with each other.
  const exportTheme: Theme = lightBackground ? 'light' : theme;

  const exportSvg = useCallback(async () => {
    const result = await renderChartToSvg({
      render: (size: ChartRenderSize) => render(size),
      title,
      caption,
      theme: exportTheme,
    });
    downloadText(result.svg, { filename: filename('svg'), extension: 'svg' });
  }, [render, title, caption, exportTheme, filename]);

  const exportPng = useCallback(async () => {
    const { canvas } = await renderChartToCanvas({
      render: (size: ChartRenderSize) => render(size),
      title,
      caption,
      theme: exportTheme,
    });
    triggerDownload(await canvasToPngBlob(canvas), filename('png'));
  }, [render, title, caption, exportTheme, filename]);

  const exportPdf = useCallback(async () => {
    const { canvas } = await renderChartToCanvas({
      render: (size: ChartRenderSize) => render(size),
      title,
      caption,
      theme: exportTheme,
    });
    // Loaded on demand: jsPDF is large and most sessions never open this menu.
    const { buildChartPdf } = await import('@/lib/exportPdf');
    const pdfName = filename('pdf');
    const blob = await buildChartPdf({
      canvas,
      // The footer and metadata carry the name without its extension.
      fileName: pdfName.replace(/\.pdf$/, ''),
    });
    triggerDownload(blob, pdfName);
  }, [render, title, caption, exportTheme, filename]);

  const items = useMemo<DownloadMenuItem[]>(() => {
    const list: DownloadMenuItem[] = [
      { id: 'png', label: DOWNLOAD_COPY.pngOption, extensions: ['png'], run: exportPng },
      { id: 'svg', label: DOWNLOAD_COPY.svgOption, extensions: ['svg'], run: exportSvg },
      { id: 'pdf', label: DOWNLOAD_COPY.pdfOption, extensions: ['pdf'], run: exportPdf },
    ];

    if (csvRows) {
      list.push({
        id: 'csv',
        label: DOWNLOAD_COPY.csvOption,
        extensions: ['csv'],
        run: async () => {
          // Loaded on demand: most users never open the CSV option.
          const { buildCsv } = await import('@/lib/exportCsv');
          downloadText(buildCsv(csvRows()), { filename: filename('csv'), extension: 'csv' });
        },
      });
    }

    return list;
  }, [exportPng, exportSvg, exportPdf, csvRows, filename]);

  return { items, lightBackground, setLightBackground };
}