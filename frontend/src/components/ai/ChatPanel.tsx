'use client';

import { useMemo, useState } from 'react';
import { Plus, Send, Trash2 } from 'lucide-react';
import { Button, ErrorBanner, Spinner } from '@/components/ui';
import { ProvenanceBadge, type Provenance } from './ProvenanceBadge';
import { useAiSuggestions, useAskQuestion } from '@/hooks/useAi';
import {
  useConversation,
  useConversations,
  useCreateConversation,
  useDeleteConversation,
  usePostMessage,
} from '@/hooks/useConversations';
import type { AnalysisResponse, AnalyzeError } from '@/lib/api';
import type { AskHistoryMessage, ConversationMessage } from '@/lib/aiTypes';

const MAX_QUESTION = 1000;

interface RenderedMessage {
  key: string;
  role: string;
  content: string;
  provenance?: Provenance;
  intentMatched?: boolean;
}

function toRendered(messages: ConversationMessage[]): RenderedMessage[] {
  return messages.map((m) => ({
    key: m.id,
    role: m.role,
    content: m.content,
    provenance: m.role === 'assistant' ? m.meta : undefined,
    intentMatched: m.meta?.intent_matched,
  }));
}

/**
 * Ask Datalens: one question at a time about the current analysis.
 *
 * Two modes, same behaviour:
 *  - **payload** — the analysis already in the browser (no saved dataset). The
 *    question and a short history go to `/ai/ask/payload`.
 *  - **conversation** — a saved dataset id is present, so threads are stored
 *    server-side and reopened later.
 *
 * Both render the same honest provenance, the same "question not recognised"
 * notice, the same 429 handling, and the same privacy note. Nothing here writes
 * an answer; it only displays what the engine returned.
 */
export function ChatPanel({
  data,
  datasetId = null,
}: {
  data: AnalysisResponse;
  datasetId?: string | null;
}) {
  if (datasetId) return <ConversationChat datasetId={datasetId} />;
  return <PayloadChat data={data} />;
}

// --- payload mode ---------------------------------------------------------------

function PayloadChat({ data }: { data: AnalysisResponse }) {
  const [messages, setMessages] = useState<RenderedMessage[]>([]);
  const ask = useAskQuestion();
  const suggestions = useAiSuggestions();

  const history = useMemo<AskHistoryMessage[]>(
    () =>
      messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .slice(-6)
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content.slice(0, 400) })),
    [messages]
  );

  const handleAsk = (question: string) => {
    if (ask.isPending) return;
    setMessages((current) => [
      ...current,
      { key: `u-${current.length}`, role: 'user', content: question },
    ]);
    ask.mutate(
      { payload: data, question, history },
      {
        onSuccess: (answer) =>
          setMessages((current) => [
            ...current,
            {
              key: `a-${current.length}`,
              role: 'assistant',
              content: answer.answer,
              provenance: answer,
              intentMatched: answer.intent_matched,
            },
          ]),
      }
    );
  };

  return (
    <ChatShell
      messages={messages}
      pending={ask.isPending}
      error={ask.error}
      suggestions={suggestions.data?.map((s) => s.question) ?? []}
      onAsk={handleAsk}
      onDismissError={() => ask.reset()}
    />
  );
}

// --- conversation mode ----------------------------------------------------------

function ConversationChat({ datasetId }: { datasetId: string }) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const threads = useConversations(datasetId);
  const thread = useConversation(activeId);
  const createThread = useCreateConversation();
  const deleteThread = useDeleteConversation();
  const post = usePostMessage();
  const suggestions = useAiSuggestions();

  const messages = useMemo<RenderedMessage[]>(
    () => (thread.data ? toRendered(thread.data.messages) : []),
    [thread.data]
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
      <aside className="space-y-2">
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          disabled={createThread.isPending}
          onClick={() =>
            createThread.mutate(
              { datasetId },
              { onSuccess: (created) => setActiveId(created.id) }
            )
          }
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          New conversation
        </Button>
        <ul className="space-y-1">
          {(threads.data?.conversations ?? []).map((c) => (
            <li key={c.id} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setActiveId(c.id)}
                aria-current={activeId === c.id ? 'true' : undefined}
                className={`min-w-0 flex-1 truncate rounded-[8px] px-2.5 py-2 text-left text-sm transition-colors ${
                  activeId === c.id
                    ? 'bg-[var(--color-surface-2)] text-[var(--color-text)]'
                    : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]'
                }`}
              >
                {c.title}
              </button>
              <button
                type="button"
                aria-label={`Delete ${c.title}`}
                onClick={() =>
                  deleteThread.mutate(
                    { conversationId: c.id, datasetId },
                    { onSuccess: () => activeId === c.id && setActiveId(null) }
                  )
                }
                className="rounded-[6px] p-1.5 text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-class-c)]"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <div>
        {activeId ? (
          <ChatShell
            messages={messages}
            pending={post.isPending}
            error={post.error}
            suggestions={suggestions.data?.map((s) => s.question) ?? []}
            onAsk={(question) => post.mutate({ conversationId: activeId, question })}
            onDismissError={() => post.reset()}
          />
        ) : (
          <div className="flex h-full min-h-[240px] items-center justify-center rounded-[8px] border border-dashed border-[var(--color-border)] p-6 text-center text-sm text-[var(--color-text-muted)]">
            Start a new conversation, or pick one on the left.
          </div>
        )}
      </div>
    </div>
  );
}

// --- shared shell ---------------------------------------------------------------

function ChatShell({
  messages,
  pending,
  error,
  suggestions,
  onAsk,
  onDismissError,
}: {
  messages: RenderedMessage[];
  pending: boolean;
  error: AnalyzeError | null;
  suggestions: string[];
  onAsk: (question: string) => void;
  onDismissError: () => void;
}) {
  const [input, setInput] = useState('');
  const remaining = MAX_QUESTION - input.length;

  const submit = () => {
    const trimmed = input.trim();
    if (!trimmed || pending) return;
    onAsk(trimmed);
    setInput('');
  };

  return (
    <div className="flex flex-col gap-3">
      <div
        className="max-h-[420px] min-h-[200px] space-y-3 overflow-y-auto rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
        aria-live="polite"
      >
        {messages.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]">
            Ask about totals, top groups, concentration, trends or what to focus on. Answers are
            computed from your analysis; a model only rewrites them.
          </p>
        ) : (
          messages.map((m) => (
            <div key={m.key} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[92%] rounded-[10px] px-3.5 py-2.5 text-sm ${
                  m.role === 'user'
                    ? 'bg-[var(--color-accent)] text-white'
                    : 'border border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-text)]'
                }`}
              >
                <p className="whitespace-pre-line leading-relaxed">{m.content}</p>
                {m.role === 'assistant' ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {m.intentMatched === false ? (
                      <span className="text-xs text-[var(--color-text-muted)]">
                        Question not recognised — showing a general summary.
                      </span>
                    ) : null}
                    {m.provenance ? <ProvenanceBadge provenance={m.provenance} /> : null}
                  </div>
                ) : null}
              </div>
            </div>
          ))
        )}

        {pending ? <Spinner size="sm" message="Thinking…" /> : null}
      </div>

      {error ? (
        <ErrorBanner
          code={error.code}
          message={error.message}
          hint={error.hint}
          onDismiss={onDismissError}
        />
      ) : null}

      {suggestions.length ? (
        <div className="flex flex-wrap gap-2">
          {suggestions.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => onAsk(q)}
              disabled={pending}
              className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-1.5 text-xs text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-text)] disabled:opacity-50"
            >
              {q}
            </button>
          ))}
        </div>
      ) : null}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className="flex items-end gap-2"
      >
        <div className="flex-1">
          <label htmlFor="ai-question" className="sr-only">
            Your question
          </label>
          <textarea
            id="ai-question"
            rows={2}
            maxLength={MAX_QUESTION}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            placeholder="Ask a question about your data…"
            className="w-full resize-none rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
          />
          {remaining < 100 ? (
            <span className="mt-1 block text-right text-xs text-[var(--color-text-muted)]">
              {remaining} characters left
            </span>
          ) : null}
        </div>
        <Button type="submit" variant="primary" size="md" disabled={pending || !input.trim()}>
          <Send className="h-4 w-4" aria-hidden="true" />
          Ask
        </Button>
      </form>

      <p className="text-xs text-[var(--color-text-muted)]">
        Only aggregate figures from your analysis are sent to a model — never your rows. With no
        model configured, Datalens answers from the analysis itself.
      </p>
    </div>
  );
}
