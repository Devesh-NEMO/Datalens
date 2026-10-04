"use client";

import { useState, useCallback, useMemo } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Sun, Moon, RotateCcw } from "lucide-react";
import { ThemeProvider, useTheme } from "@/hooks/useTheme";
import { useAnalyze } from "@/hooks/useAnalyze";
import { Button, EmptyState, Spinner, ErrorBanner, Chapter } from "@/components/ui";
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

const queryClient = new QueryClient();

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
  const { theme, toggleTheme } = useTheme();
  const { data, error, isLoading, analyze, reset } = useAnalyze();
  const [file, setFile] = useState<File | null>(null);

  // Which figures the KPI row shows. Lives here rather than inside KpiRow so
  // the selection survives the row unmounting during a re-analysis, and so step
  // (h) can mirror it into the URL from one place.
  const [metricSelection, setMetricSelection] = useState<MetricId[]>([
    ...DEFAULT_METRIC_IDS,
  ]);

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
  }, [reset]);

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
      productColumn: data?.selection?.product_column ?? '',
      valueColumn: data?.selection?.value_column ?? '',
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

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-[var(--color-rule)]">
        <div className="max-w-[760px] mx-auto px-4 py-3 flex items-center justify-between">
          <span className="font-serif italic text-lg text-[var(--color-text)]">Datalens</span>
          <div className="flex items-center gap-3">
            {file && (
              <>
                <span className="text-sm text-[var(--color-muted-text)] truncate max-w-[200px]">
                  {file.name}
                </span>
                <Button variant="ghost" size="sm" onClick={handleReset}>
                  <RotateCcw className="h-4 w-4" aria-hidden="true" />
                  Analyze another file
                </Button>
                {data ? (
                  <ReportOptions
                    buildOptions={{ sourceFileName: file.name, data }}
                    baseSettings={reportSettings}
                  />
                ) : null}
              </>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleTheme}
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <div className="max-w-[760px] mx-auto px-4 py-8">
          {error && (
            <div className="mb-6">
              <ErrorBanner
                code={error.code}
                message={error.message}
                hint={error.hint}
                onDismiss={() => reset()}
              />
            </div>
          )}

          {isLoading && (
            <div className="py-20">
              <Spinner size="lg" message="Analyzing your data..." />
            </div>
          )}

          {!isLoading && !data && (
            <EmptyState
              onUpload={handleFileSelect}
              onSampleSelect={handleSampleSelect}
              isLoading={isLoading}
            />
          )}

          {!isLoading && data && (
            <Dashboard
              data={data}
              fileName={file?.name ?? 'data.csv'}
              onReanalyze={handleReanalyze}
              isLoading={isLoading}
              reportSettings={reportSettings}
              metricSelection={metricSelection}
              onMetricSelectionChange={setMetricSelection}
            />
          )}
        </div>
      </main>

    </div>
  );
}

export default function Home() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AppContent />
      </ThemeProvider>
    </QueryClientProvider>
  );
}