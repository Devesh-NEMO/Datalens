'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { RefreshCw, Sparkles } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { PageContainer, PageHeader } from '@/components/app';
import { Button, Card, ErrorBanner, Spinner } from '@/components/ui';
import { AiStatusChip, ChatPanel, ProvenanceBadge } from '@/components/ai';
import { useAiInsights, useAiStatus } from '@/hooks/useAi';
import { useDataset } from '@/hooks/useDataset';
import { getAnalysisFingerprint } from '@/lib/analysisFingerprint';
import type { AnalysisResponse } from '@/lib/api';

export default function AIPage() {
  const { dataset } = useDataset();

  if (!dataset) {
    return (
      <PageContainer>
        <PageHeader
          title="AI Insights"
          description="Written explanations and questions about your data."
          actions={<AiStatusChip className="inline-flex sm:inline-flex" />}
        />
        <div className="mt-6">
          <Card className="p-8 text-center">
            <Sparkles
              className="mx-auto mb-3 h-8 w-8 text-[var(--color-purple)]"
              aria-hidden="true"
            />
            <h2 className="mb-2 text-lg font-semibold text-[var(--color-text)]">
              No dataset loaded
            </h2>
            <p className="mb-4 text-sm text-[var(--color-text-muted)]">
              Analyse a file on Overview, then come back here for written insights and questions.
            </p>
            <Link href="/" className="app-btn app-btn-primary inline-flex">
              Go to Overview
            </Link>
          </Card>
        </div>
      </PageContainer>
    );
  }

  return <AiWorkspace data={dataset.data} fileName={dataset.fileName} />;
}

function AiWorkspace({ data, fileName }: { data: AnalysisResponse; fileName: string }) {
  const fingerprint = useMemo(
    () =>
      getAnalysisFingerprint({
        fileName,
        productColumn: data.selection?.product_column,
        valueColumn: data.selection?.value_column,
        dateColumn: data.selection?.date_column,
        analysisTimestamp: `${data.meta?.rows ?? 0}x${data.meta?.columns ?? 0}`,
      }),
    [data, fileName]
  );

  const status = useAiStatus();
  const insights = useAiInsights(data, fingerprint);
  const queryClient = useQueryClient();

  const regenerate = () => {
    queryClient.invalidateQueries({ queryKey: ['ai', 'insights', fingerprint] });
  };

  const configured = status.data?.enabled && status.data?.configured;
  const sections = insights.data?.sections ?? [];
  const grounding = insights.data?.grounding;

  return (
    <PageContainer>
      <PageHeader
        title="AI Insights"
        description={`Written explanations of ${fileName}, every figure checked against the analysis.`}
        actions={
          <>
            <AiStatusChip className="inline-flex sm:inline-flex" />
            <Button variant="ghost" size="sm" onClick={regenerate} disabled={insights.isFetching}>
              <RefreshCw
                className={`h-4 w-4 ${insights.isFetching ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              Regenerate
            </Button>
          </>
        }
      />

      {!configured && status.data ? (
        <Card className="mt-6 border-l-4 border-l-[var(--color-accent)] p-5">
          <p className="text-sm text-[var(--color-text)]">{status.data.message}</p>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            Everything below still works — it is written from the deterministic analysis, and no
            text is invented.{' '}
            <Link href="/settings" className="text-[var(--color-accent)] underline">
              AI settings
            </Link>
          </p>
        </Card>
      ) : null}

      <section className="mt-8">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
          Written insights
        </h2>

        {insights.isPending ? (
          <Spinner message="Writing insights…" />
        ) : insights.isError ? (
          <ErrorBanner
            code={insights.error?.code ?? 'ai_error'}
            message={insights.error?.message ?? 'The insights could not be generated.'}
            hint={insights.error?.hint}
          />
        ) : (
          <>
            <div className="grid gap-4 lg:grid-cols-2">
              {sections.map((section) => (
                <Card key={section.key} className="p-5">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold text-[var(--color-text)]">
                      {section.title}
                    </h3>
                    {section.available ? (
                      <ProvenanceBadge
                        provenance={{
                          source: section.source,
                          is_ai: section.source === 'ai',
                          fell_back: section.fell_back,
                          fallback_reason: section.fallback_reason,
                        }}
                      />
                    ) : null}
                  </div>
                  {section.available ? (
                    <>
                      <p className="whitespace-pre-line text-sm leading-relaxed text-[var(--color-text)]">
                        {section.body}
                      </p>
                      {section.bullets?.length ? (
                        <ul className="mt-3 space-y-1.5">
                          {section.bullets.map((bullet, index) => (
                            <li
                              key={index}
                              className="flex gap-2 text-sm text-[var(--color-text-muted)]"
                            >
                              <span
                                aria-hidden="true"
                                className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-accent)]"
                              />
                              {bullet}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </>
                  ) : (
                    <p className="text-sm text-[var(--color-text-muted)]">
                      This dataset does not support this section.
                    </p>
                  )}
                </Card>
              ))}
            </div>

            {grounding ? (
              <p className="mt-4 text-xs text-[var(--color-text-muted)]">
                {grounding.rule} ({grounding.figure_count} figures checked.)
              </p>
            ) : null}
          </>
        )}
      </section>

      <section className="mt-10">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
          Ask Datalens
        </h2>
        <ChatPanel data={data} />
      </section>
    </PageContainer>
  );
}
