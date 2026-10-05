'use client';
import { createContext, useContext, useState, useCallback } from 'react';

// ---- Analysis context ----
const AnalysisContext = createContext(null);

export function AnalysisProvider({ children }) {
  const [analysis, setAnalysis] = useState(null);
  const [fileName, setFileName] = useState('');
  const [page, setPage] = useState('upload'); // upload | overview | explorer | products | analytics | quality | profile | columns | insights | ask | reports | library | compare | settings

  const reset = useCallback(() => {
    setAnalysis(null);
    setFileName('');
    setPage('upload');
  }, []);

  return (
    <AnalysisContext.Provider value={{ analysis, setAnalysis, fileName, setFileName, page, setPage, reset }}>
      {children}
    </AnalysisContext.Provider>
  );
}

export function useAppState() {
  const ctx = useContext(AnalysisContext);
  if (!ctx) return { analysis: null, setAnalysis: () => {}, fileName: '', setFileName: () => {}, page: 'upload', setPage: () => {}, reset: () => {} };
  return ctx;
}
