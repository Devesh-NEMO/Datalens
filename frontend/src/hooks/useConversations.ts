"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listConversations,
  createConversation,
  getConversation,
  deleteConversation,
  postMessage,
  type AnalyzeError,
} from "@/lib/api";
import type {
  ConversationDetail,
  ConversationList,
  ConversationSummary,
  PostMessageResult,
} from "@/lib/aiTypes";

export function useConversations(datasetId: string | null) {
  return useQuery<ConversationList, AnalyzeError>({
    queryKey: ["conversations", datasetId],
    queryFn: ({ signal }) => listConversations(datasetId as string, signal),
    enabled: !!datasetId,
  });
}

export function useConversation(conversationId: string | null) {
  return useQuery<ConversationDetail, AnalyzeError>({
    queryKey: ["conversation", conversationId],
    queryFn: ({ signal }) => getConversation(conversationId as string, signal),
    enabled: !!conversationId,
  });
}

export function useCreateConversation() {
  const qc = useQueryClient();
  return useMutation<ConversationSummary, AnalyzeError, { datasetId: string; title?: string }>({
    mutationFn: ({ datasetId, title }) => createConversation(datasetId, title),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["conversations", vars.datasetId] });
    },
  });
}

export function useDeleteConversation() {
  const qc = useQueryClient();
  return useMutation<
    { id: string; deleted: boolean },
    AnalyzeError,
    { conversationId: string; datasetId?: string }
  >({
    mutationFn: ({ conversationId }) => deleteConversation(conversationId),
    onSuccess: (_data, vars) => {
      qc.removeQueries({ queryKey: ["conversation", vars.conversationId] });
      if (vars.datasetId) {
        qc.invalidateQueries({ queryKey: ["conversations", vars.datasetId] });
      }
    },
  });
}

export function usePostMessage() {
  const qc = useQueryClient();
  return useMutation<PostMessageResult, AnalyzeError, { conversationId: string; question: string }>({
    mutationFn: ({ conversationId, question }) => postMessage(conversationId, question),
    onSuccess: (data, vars) => {
      // Refresh the thread so the saved exchange (with its provenance) is the
      // single source of truth rather than a local optimistic copy.
      qc.invalidateQueries({ queryKey: ["conversation", vars.conversationId] });
      qc.invalidateQueries({ queryKey: ["conversations", data.conversation.dataset_id] });
    },
  });
}
