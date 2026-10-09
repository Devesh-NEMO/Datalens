"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import { RotateCcw } from "lucide-react";
import { useAnalyze } from "@/hooks/useAnalyze";
import { useDataset } from "@/hooks/useDataset";
import { Button, EmptyState, Spinner, ErrorBanner, Chapter } from "@/components/ui";
import { PageContainer, PageHeader } from "@/components/app";
import { CHAPTER_IDS, CHAPTER_TITLES, TOP_N_OPTIONS } from "@/lib/constants";
import { DEFAULT_METRIC_IDS, type MetricId } from "@/lib/metrics";
import { generateInsights } from "@/lib/insights";
import type { ReportSettings } from "@/lib/report/reportSections";
import {
  Hero,
  InsightList,
  QualityPanel,
  ColumnSelector,
  TopList,
  BottomList,
  RankingTable,
  ReportButton,
  ReportOptions,
} from "@/components/dashboard";
import { ParetoChart, TopProductsChart, AbcPieChart, AbcBarChart, HistogramChart, TrendChart } from "@/components/charts";
import type { AnalysisResponse, AnalyzeOptions } from "@/lib/api";

function Dashboard({
  data,
  fileName,
  onReanalyze,
  isLoading,
  reportSettings,
  metricSelection,
  onMetricSelectionChange,
}: {
  data: AnalysisResponse;
  fileName: string;
  onReanalyze: (options: AnalyzeOptions) => void;
  isLoading: boolean;
  reportSettings: ReportSettings;
  metricSelection: readonly MetricId[];
  onMetricSelectionChange: (next: MetricId[]) => void;
}) {
  const hasTrend = data.charts.monthly_trend && data.charts.monthly_trend.length > 0;

  // Recomputed from the response rather than stored, so it is always consistent
  // with the data on screen. Insights that point at "Over time" are simply absent
  // when there are no dates, since the chapter they name does not exist.
  const insights = useMemo(() => generateInsights(data), [data]);

  return (
    <div className="space-y-12">
      <Hero
        data={data}
        metricSelection={metricSelection}
        onMetricSelectionChange={onMetricSelectionChange}
      />

      {/* Sits between the summary and chapter 1: the reader gets the findings
          before any of the machinery that produced them. */}
      <InsightList insights={insights} />

      <QualityPanel data={data} />
      <ColumnSelector data={data} onReanalyze={onReanalyze} isLoading={isLoading} />

      <Chapter number={3} id={CHAPTER_IDS.shape} title={CHAPTER_TITLES[CHAPTER_IDS.shape]}>
        <ParetoChart data={data} sourceFileName={fileName} />
      </Chapter>

      <Chapter number={4} id={CHAPTER_IDS.leaders} title={CHAPTER_TITLES[CHAPTER_IDS.leaders]}>
        <TopProductsChart data={data} sourceFileName={fileName} />
        <h3 className="mt-8 mb-2 text-xs uppercase tracking-widest text-[var(--color-muted-text)]">
          Most important
        </h3>
        <TopList data={data} sourceFileName={fileName} />
      </Chapter>

      <Chapter number={5} id={CHAPTER_IDS.split} title={CHAPTER_TITLES[CHAPTER_IDS.split]}>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <AbcPieChart data={data} sourceFileName={fileName} />
          <AbcBarChart data={data} sourceFileName={fileName} />
        </div>
      </Chapter>

      <Chapter number={6} id={CHAPTER_IDS.tail} title={CHAPTER_TITLES[CHAPTER_IDS.tail]}>
        <h3 className="mb-2 text-xs uppercase tracking-widest text-[var(--color-muted-text)]">
          Least important
        </h3>
        <BottomList data={data} sourceFileName={fileName} />
        <h3 className="mt-8 mb-2 text-xs uppercase tracking-widest text-[var(--color-muted-text)]">
          Value distribution
        </h3>
        <HistogramChart data={data} sourceFileName={fileName} />
      </Chapter>

      {hasTrend && (
        <Chapter number={7} id={CHAPTER_IDS.time} title={CHAPTER_TITLES[CHAPTER_IDS.time]}>
          <TrendChart data={data} sourceFileName={fileName} />
        </Chapter>
      )}

      <RankingTable data={data} sourceFileName={fileName} />

      <div className="mt-8 flex justify-end">
        <ReportButton
          buildOptions={{ sourceFileName: fileName, data, settings: reportSettings }}
        />
      </div>
    </div>
  );
}

function AppContent() {
  const { data, error, isLoading, analyze, reset } = useAnalyze();
  const { setDataset, clearDataset } = useDataset();
  const [file, setFile] = useState<File | null>(null);

  // Which figures the KPI row shows. Lives here rather than inside KpiRow so
  // the selection survives the row unmounting during a re-analysis, and so step
  // (h) can mirror it into the URL from one place.
  const [metricSelection, setMetricSelection] = useState<MetricId[]>([
    ...DEFAULT_METRIC_IDS,
  ]);

  // Publish the finished analysis to the shared dataset context so the shell
  // topbar can show the chip and Reports can run its report lab. The context
  // survives route changes; the page's own useAnalyze state does not.
  useEffect(() => {
    if (data) {
      setDataset({ data, fileName: file?.name ?? "data.csv" });
    }
  }, [data, file, setDataset]);

  // A failed re-analysis must not leave the previous dataset looking current.
  useEffect(() => {
    if (error) clearDataset();
  }, [error, clearDataset]);

  // A new file starts from the default figures again: a selection made for one
  // dataset says nothing about the next one, and a metric the new file cannot
  // produce is dropped by resolveMetricSelection anyway.
  const handleFileSelect = useCallback(
    (f: File) => {
      setFile(f);
      setMetricSelection([...DEFAULT_METRIC_IDS]);
      analyze(f);
    },
    [analyze]
  );

  const handleSampleSelect = useCallback(
    async (type: "clean" | "messy") => {
      try {
        const res = await fetch(`/samples/sales_${type}.csv`);
        const blob = await res.blob();
        const f = new File([blob], `sales_${type}.csv`, { type: "text/csv" });
        setFile(f);
        setMetricSelection([...DEFAULT_METRIC_IDS]);
        analyze(f);
      } catch {
        // Handle error
      }
    },
    [analyze]
  );

  const handleReset = useCallback(() => {
    setFile(null);
    setMetricSelection([...DEFAULT_METRIC_IDS]);
    reset();
    clearDataset();
  }, [reset, clearDataset]);

  const handleDismissError = useCallback(() => {
    reset();
    clearDataset();
  }, [reset, clearDataset]);

  // Columns chosen for this analysis, echoed on the report cover. Read from the
  // response so a re-analysis with different columns is reflected.
  const reportSettings = useMemo<ReportSettings>(
    () => ({
      includeSummary: true,
      includeQuality: true,
      includeSettings: true,
      includeCharts: true,
      includeLists: true,
      includeRankingTable: true,
      tableScopeAll: false,
      topN: data?.ranking?.top_n?.length ?? TOP_N_OPTIONS[1],
      productColumn: data?.selection?.product_column ?? "",
      valueColumn: data?.selection?.value_column ?? "",
      dateColumn: data?.selection?.date_column ?? null,
    }),
    [data]
  );

  const handleReanalyze = useCallback(
    (options: AnalyzeOptions) => {
      if (file) {
        analyze(file, options);
      }
    },
    [analyze, file]
  );

  if (isLoading) {
    return (
      <PageContainer>
        <Spinner size="lg" message="Analyzing your data..." />
      </PageContainer>
    );
  }

  if (error) {
    return (
      <PageContainer>
        <ErrorBanner
          code={error.code}
          message={error.message}
          hint={error.hint}
          onDismiss={handleDismissError}
        />
      </PageContainer>
    );
  }

  if (!data) {
    return <EmptyState onUpload={handleFileSelect} onSampleSelect={handleSampleSelect} isLoading={isLoading} />;
  }

  const fileName = file?.name ?? "data.csv";

  return (
    <PageContainer>
      <PageHeader
        title="Overview"
        description={`ABC and Pareto analysis of ${fileName}.`}
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={handleReset}>
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              Analyze another file
            </Button>
            <ReportOptions
              buildOptions={{ sourceFileName: fileName, data }}
              baseSettings={reportSettings}
            />
          </>
        }
      />
      <div className="mt-8">
        <Dashboard
          data={data}
          fileName={fileName}
          onReanalyze={handleReanalyze}
          isLoading={isLoading}
          reportSettings={reportSettings}
          metricSelection={metricSelection}
          onMetricSelectionChange={setMetricSelection}
        />
      </div>
    </PageContainer>
  );
}

/**
 * The dashboard at `/`. Providers (theme, query client, auth) and the shell
 * chrome live in the root and `(app)` layouts — this component is content only.
 */
export default AppContent;