import type { components } from '@/types/api';

/**
 * Types for the AI surface.
 *
 * Where a backend route declares a `response_model`, the generated OpenAPI type
 * is reused directly. The status, health, summary and conversation routes return
 * loose dicts (no `response_model`), so they are described here once instead of
 * being re-guessed at each call site. Nothing here invents a field the API does
 * not send.
 */

export type InsightsResponse = components['schemas']['InsightsResponse'];
export type InsightSectionResponse = components['schemas']['InsightSectionResponse'];
export type FindingResponse = components['schemas']['FindingResponse'];
export type AskResponse = components['schemas']['AskResponse'];
export type SuggestionResponse = components['schemas']['SuggestionResponse'];

/** `GET /ai/status` — what the UI needs to explain the AI state, never a key. */
export interface AiStatus {
  enabled: boolean;
  configured: boolean;
  provider: string;
  model: string;
  base_url: string;
  has_api_key: boolean;
  local_fallback_enabled: boolean;
  message: string;
}

/** `GET /ai/test-connection` — the status plus a probe result. */
export interface AiHealth extends AiStatus {
  status: 'disabled' | 'not_configured' | 'ok' | 'error';
  message: string;
  latency_ms: number | null;
  hint?: string | null;
  code?: string;
}

/** `POST /ai/summary` and `POST /ai/summary/payload`. */
export interface DatasetSummary {
  text: string;
  source: string;
  provider: string;
  model: string;
  is_ai: boolean;
  fell_back: boolean;
  fallback_reason: string | null;
  disclaimer: string;
  figure_count: number;
}

export interface ConversationSummary {
  id: string;
  dataset_id: string;
  title: string;
  message_count: number;
  created_at: string;
  updated_at: string;
}

export interface ConversationMessage {
  id: string;
  role: string;
  content: string;
  /** Provenance for assistant messages: intent, source, fell_back. */
  meta: Partial<{
    intent: string;
    intent_matched: boolean;
    source: string;
    provider: string;
    model: string;
    is_ai: boolean;
    fell_back: boolean;
    fallback_reason: string | null;
  }>;
  created_at: string;
}

export interface ConversationList {
  conversations: ConversationSummary[];
  total: number;
  persistence_available?: boolean;
  reason?: string;
}

export interface ConversationDetail {
  conversation: ConversationSummary;
  messages: ConversationMessage[];
}

/** `POST /conversations/{id}/messages` — the saved exchange plus the raw answer. */
export interface PostMessageResult {
  conversation: ConversationSummary;
  user_message: ConversationMessage;
  assistant_message: ConversationMessage;
  ask: AskResponse;
}

/** The historical exchange shape the ask endpoint accepts for follow-ups. */
export interface AskHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}
