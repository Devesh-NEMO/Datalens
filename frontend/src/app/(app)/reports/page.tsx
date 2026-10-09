'use client';

import { useCallback, useMemo } from 'react';
import Link from 'next/link';
import { FileSpreadsheet, FileText, Image as ImageIcon, Upload } from 'lucide-react';
import { Button, Card } from '@/components/ui';
import { PageContainer, PageHeader } from '@/components/app';
import { useDataset } from '@/hooks/useDataset';
import { useDownload, type DownloadFailure } from '@/hooks/useDownload';
import { useTheme } from '@/hooks/useTheme';
import { buildFilename, triggerDownload } from '@/lib/download';
import { buildReport } from '@/lib/report/buildReport';
import type { ReportSettings } from '@/lib/report/reportSections';
import { DOWNLOAD_COPY, TOP_N_OPTIONS } from '@/lib/constants';
import { exportTabularCsv } from '@/lib/tabularExport';
import { rankingTableDescriptor } from '@/lib/rankingExport';
import { canvasToPngBlob, renderChartToCanvas, type ChartRenderSize } from '@/lib/exportChart';
import { PARETO_CAPTION, ParetoPlot } from '@/components/charts/ParetoChart';
import { ReportOptions } from '@/components/dashboard';
import type { AnalysisResponse } from '@/lib/api';

/** Inline failure note used by every export card. */
function ExportFailure({
  failure,
  dismiss,
}: {
  failure: DownloadFailure | null;
  dismiss: () => void;
}) {
  if (!failure) return null;
  return (
    <div
      role="alert"
      className="mt-4 w-full rounded-[8px] border border-[var(--color-class-c)] bg-[var(--color-page)] px-3 py-2.5 text-sm"
    >
      <p className="font-medium text-[var(--color-text)]">{failure.title}</p>
      <p className="text-[var(--color-muted-text)]">{failure.hint}</p>
      <button
        type="button"
        onClick={dismiss}
        className="mt-2 rounded-[6px] border border-[var(--color-rule)] px-2 py-1 text-xs text-[var(--color-text)]"
      >
        Dismiss
      </button>
    </div>
  );
}

/** Shared icon tile: file icon in a soft indigo square. */
function IconTile({ children }: { children: React.ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-[color-mix(in_srgb,#6366F1_12%,transparent)] text-[#6366F1]"
    >
      {children}
    </span>
  );
}

/** Report settings for this dataset: every section included. */
function useFullReportSettings(data: AnalysisResponse): ReportSettings {
  return useMemo<ReportSettings>(
    () => ({
      includeSummary: true,
      includeQuality: true,
      includeSettings: true,
      includeCharts: true,
      includeLists: true,
      includeRankingTable: true,
      tableScopeAll: false,
      topN: data.ranking?.top_n?.length ?? TOP_N_OPTIONS[1],
      productColumn: data.selection?.product_column ?? '',
      valueColumn: data.selection?.value_column ?? '',
      dateColumn: data.selection?.date_column ?? null,
    }),
    [data]
  );
}

/** Card 1 — the full report as a PDF, generated all-at-once. */
function PdfReportCard({ data, fileName }: { data: AnalysisResponse; fileName: string }) {
  const { isPreparing, failure, liveMessage, run, dismiss } = useDownload();
  const reportSettings = useFullReportSettings(data);

  const download = useCallback(async () => {
    const result = await buildReport({
      sourceFileName: fileName,
      data,
      settings: reportSettings,
    });
    triggerDownload(result.blob, result.filename);
  }, [data, fileName, reportSettings]);

  return (
    <Card accent className="px-6 py-5">
      <div className="flex items-start gap-4">
        <IconTile>
          <FileText className="h-5 w-5" />
        </IconTile>
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-[var(--color-text)]">Full report (PDF)</h2>
          <p className="mt-1 text-sm text-[var(--color-muted-text)]">
            Every section of the analysis in one document: the Pareto finding, quality and
            cleaning notes, the settings used, all charts, and the ranking table.
          </p>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Button variant="primary" loading={isPreparing} disabled={isPreparing} onClick={() => void run(download)}>
          {isPreparing ? DOWNLOAD_COPY.busyLabel : 'Generate Report'}
        </Button>
        <ReportOptions buildOptions={{ sourceFileName: fileName, data }} baseSettings={reportSettings} />
      </div>

      <ExportFailure failure={failure} dismiss={dismiss} />
      <span className="sr-only" role="status" aria-live="polite">
        {liveMessage}
      </span>
    </Card>
  );
}

/** Card 2 — the ranking table as CSV. */
function CsvExportCard({ data, fileName }: { data: AnalysisResponse; fileName: string }) {
  const { isPreparing, failure, liveMessage, run, dismiss } = useDownload();

  const download = useCallback(() => {
    exportTabularCsv(rankingTableDescriptor(data, fileName));
  }, [data, fileName]);

  return (
    <Card className="px-6 py-5">
      <div className="flex items-start gap-4">
        <IconTile>
          <FileSpreadsheet className="h-5 w-5" />
        </IconTile>
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-[var(--color-text)]">Ranking table (CSV)</h2>
          <p className="mt-1 text-sm text-[var(--color-muted-text)]">
            The full product ranking — rank, value, share, cumulative share, class and growth —
            in a spreadsheet-friendly CSV.
          </p>
        </div>
      </div>

      <div className="mt-5">
        <Button variant="outline" loading={isPreparing} disabled={isPreparing} onClick={() => void run(download)}>
          {isPreparing ? DOWNLOAD_COPY.busyLabel : DOWNLOAD_COPY.downloadCsv}
        </Button>
      </div>

      <ExportFailure failure={failure} dismiss={dismiss} />
      <span className="sr-only" role="status" aria-live="polite">
        {liveMessage}
      </span>
    </Card>
  );
}

/** Card 3 — the Pareto curve as a PNG image. */
function PngExportCard({ data, fileName }: { data: AnalysisResponse; fileName: string }) {
  const { theme } = useTheme();
  const { isPreparing, failure, liveMessage, run, dismiss } = useDownload();

  const download = useCallback(async () => {
    const { canvas } = await renderChartToCanvas({
      render: (size: ChartRenderSize) => (
        <ParetoPlot chartData={data.charts.pareto_curve} width={size.width} height={size.height} />
      ),
      title: 'Pareto curve',
      caption: PARETO_CAPTION,
      theme,
    });
    const filename = buildFilename({
      sourceFileName: fileName,
      itemName: 'pareto-curve',
      extension: 'png',
    });
    triggerDownload(await canvasToPngBlob(canvas), filename);
  }, [data, fileName, theme]);

  return (
    <Card className="px-6 py-5">
      <div className="flex items-start gap-4">
        <IconTile>
          <ImageIcon className="h-5 w-5" />
        </IconTile>
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-[var(--color-text)]">Pareto curve (PNG)</h2>
          <p className="mt-1 text-sm text-[var(--color-muted-text)]">
            The Pareto chart as a standalone image — product values against the cumulative
            share line — for slides and documents.
          </p>
        </div>
      </div>

      <div className="mt-5">
        <Button variant="outline" loading={isPreparing} disabled={isPreparing} onClick={() => void run(download)}>
          {isPreparing ? DOWNLOAD_COPY.busyLabel : 'Download PNG'}
        </Button>
      </div>

      <ExportFailure failure={failure} dismiss={dismiss} />
      <span className="sr-only" role="status" aria-live="polite">
        {liveMessage}
      </span>
    </Card>
  );
}

/** The report lab lives here only when a dataset has been analysed. */
function ReportLab({ data, fileName }: { data: AnalysisResponse; fileName: string }) {
  return (
    <PageContainer>
      <PageHeader title="Reports" description="Build and export a summary of the loaded analysis." />
      <div className="mt-8 space-y-4">
        <PdfReportCard data={data} fileName={fileName} />
        <div className="grid gap-4 sm:grid-cols-2">
          <CsvExportCard data={data} fileName={fileName} />
          <PngExportCard data={data} fileName={fileName} />
        </div>
      </div>
    </PageContainer>
  );
}

/** Nothing analysed yet: one honest empty state pointing back to Overview. */
function EmptyReports() {
  return (
    <PageContainer>
      <div className="flex min-h-[calc(100vh-var(--topbar-h))] items-center justify-center">
        <Card className="app-card-enter max-w-md px-8 py-10 text-center">
          <span className="app-icon-circle mx-auto h-14 w-14">
            <FileText className="h-6 w-6" aria-hidden="true" />
          </span>
          <h1 className="mt-5 text-xl font-semibold text-[var(--color-text)]">No analysis yet</h1>
          <p className="mt-2 text-sm leading-relaxed text-[var(--color-muted-text)]">
            Upload a dataset on the Overview page and this screen becomes the report lab: one
            click to generate the full PDF, plus CSV and image exports.
          </p>
          <Link
            href="/"
            className="app-btn app-btn-primary app-btn-md mt-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6366F1]"
          >
            <Upload className="h-4 w-4" aria-hidden="true" />
            Upload a dataset
          </Link>
        </Card>
      </div>
    </PageContainer>
  );
}

/**
 * Reports: the report lab for the loaded dataset (the same buildReport /
 * exportTabularCsv / chart-export machinery the dashboard uses), or an empty
 * state pointing at Overview when nothing has been analysed. The dataset comes
 * from the shared context, which the Overview page writes to on a successful
 * analysis — it survives route changes, unlike the Overview page's own state.
 */
export default function ReportsPage() {
  const { dataset } = useDataset();

  if (!dataset) return <EmptyReports />;
  return <ReportLab data={dataset.data} fileName={dataset.fileName} />;
}