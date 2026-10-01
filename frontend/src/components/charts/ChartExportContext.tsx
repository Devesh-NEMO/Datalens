'use client';

import { createContext, useContext, type ReactNode } from 'react';

/**
 * Set while a chart is being rendered offscreen for export.
 *
 * Charts read this to switch off entry animations and hide interactive chrome,
 * so the exported image shows the settled state rather than a half-grown bar,
 * and never contains a tooltip or its own download menu.
 *
 * This is a separate React root from the page, so it cannot use page context.
 */
const ChartExportContext = createContext(false);

export function ChartExportProvider({ children }: { children: ReactNode }) {
  return <ChartExportContext.Provider value>{children}</ChartExportContext.Provider>;
}

/** True when this render exists only to be turned into a file. */
export function useIsExporting(): boolean {
  return useContext(ChartExportContext);
}