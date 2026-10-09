'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { AnalysisResponse } from '@/lib/api';

export interface SharedDataset {
  /** The analysis response for the dataset loaded on the Overview page. */
  data: AnalysisResponse;
  /** Original upload name (also used for export filenames). */
  fileName: string;
}

interface DatasetContextValue {
  dataset: SharedDataset | null;
  setDataset: (dataset: SharedDataset) => void;
  clearDataset: () => void;
}

const DatasetContext = createContext<DatasetContextValue | null>(null);

/**
 * The dataset the user loaded on Overview, made available to the rest of the
 * shell (topbar chip) and to Reports so the report lab can run without the
 * analysis state living on the Overview page route. Only the Overview page
 * writes to it; everything else reads.
 */
export function DatasetProvider({ children }: { children: ReactNode }) {
  const [dataset, setDatasetState] = useState<SharedDataset | null>(null);

  const setDataset = useCallback((next: SharedDataset) => {
    setDatasetState(next);
  }, []);

  const clearDataset = useCallback(() => {
    setDatasetState(null);
  }, []);

  const value = useMemo(
    () => ({ dataset, setDataset, clearDataset }),
    [dataset, setDataset, clearDataset]
  );

  return <DatasetContext.Provider value={value}>{children}</DatasetContext.Provider>;
}

/**
 * Safe outside a provider (tests, isolated renders): reads default to "no
 * dataset", writes are no-ops.
 */
export function useDataset(): DatasetContextValue {
  const context = useContext(DatasetContext);
  if (context) return context;
  return {
    dataset: null,
    setDataset: () => {},
    clearDataset: () => {},
  };
}