"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import {
  aiStatus,
  aiSuggestions,
  aiInsightsFromPayload,
  aiSummaryFromPayload,
  aiAskPayload,
  aiTestConnection,
  type AnalysisResponse,
  type AnalyzeError,
} from "@/lib/api";
import type {
  AiHealth,
  AiStatus,
  AskHistoryMessage,
  AskResponse,
  DatasetSummary,
  InsightsResponse,
  SuggestionResponse,
} from "@/lib/aiTypes";

export function useAiStatus() {
  return useQuery<AiStatus, AnalyzeError>({
    queryKey: ["ai", "status"],
    queryFn: ({ signal }) => aiStatus(signal),
    staleTime: 60 * 1000,
    refetchOnWindowFocus: true,
  });
}

export function useAiSuggestions() {
  return useQuery<SuggestionResponse[], AnalyzeError>({
    queryKey: ["ai", "suggestions"],
    queryFn: ({ signal }) => aiSuggestions(signal),
    staleTime: 10 * 60 * 1000,
  });
}

/**
 * Insights for one analysis, cached forever per fingerprint.
 *
 * The fingerprint changes only when the dataset or its columns change, so
 * remounts and navigation reuse the same billed response until the user asks
 * for a Regenerate.
 */
export function useAiInsights(analysis: AnalysisResponse | null, fingerprint: string) {
  return useQuery<InsightsResponse, AnalyzeError>({
    queryKey: ["ai", "insights", fingerprint],
    queryFn: ({ signal }) => aiInsightsFromPayload(analysis as AnalysisResponse, signal),
    enabled: !!analysis,
    staleTime: Infinity,
  });
}

export function useAiSummary(analysis: AnalysisResponse | null, fingerprint: string) {
  return useQuery<DatasetSummary, AnalyzeError>({
    queryKey: ["ai", "summary", fingerprint],
    queryFn: ({ signal }) => aiSummaryFromPayload(analysis as AnalysisResponse, signal),
    enabled: !!analysis,
    staleTime: Infinity,
  });
}

export interface AskVariables {
  payload: AnalysisResponse;
  question: string;
  history?: AskHistoryMessage[];
}

export function useAskQuestion() {
  return useMutation<AskResponse, AnalyzeError, AskVariables>({
    mutationFn: ({ payload, question, history }) => aiAskPayload(payload, question, history ?? []),
  });
}

export function useTestAiConnection() {
  return useMutation<AiHealth, AnalyzeError, void>({
    mutationFn: () => aiTestConnection(),
  });
}
