"use client";

import { useState, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { analyzeFile, type AnalysisResponse, type AnalyzeOptions, type AnalyzeError } from "@/lib/api";

interface UseAnalyzeReturn {
  data: AnalysisResponse | null;
  error: AnalyzeError | null;
  isLoading: boolean;
  analyze: (file: File, options?: AnalyzeOptions) => void;
  reset: () => void;
}
 

export function useAnalyze(): UseAnalyzeReturn {
  const [data, setData] = useState<AnalysisResponse | null>(null);
  const [error, setError] = useState<AnalyzeError | null>(null);

  const mutation = useMutation({
    mutationFn: ({ file, options }: { file: File; options?: AnalyzeOptions }) =>
      analyzeFile(file, options),
    onSuccess: (result) => {
      setData(result);
      setError(null);
    },
    onError: (err: AnalyzeError) => {
      setError(err);
      setData(null);
    },
  });

  const analyze = useCallback(
    (file: File, options?: AnalyzeOptions) => {
      mutation.mutate({ file, options });
    },
    [mutation]
  );

  const reset = useCallback(() => {
    mutation.reset();
    setData(null);
    setError(null);
  }, [mutation]);

  return {
    data,
    error,
    isLoading: mutation.isPending,
    analyze,
    reset,
  };
}