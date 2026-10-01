"use client";

import { useCallback } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { AnalysisResponse } from "@/lib/api";
import { DownloadMenu } from "@/components/ui/DownloadMenu";
import { useChartDownloads, type ChartRenderSize } from "@/lib/chartExport";
import { useIsExporting } from "./ChartExportContext";

interface HistogramChartProps {
  data: AnalysisResponse;
  sourceFileName?: string;
}

const CAPTION =
  "How product values are spread out. Bars count the products falling in each value bucket.";

export function HistogramChart({ data, sourceFileName = "data.csv" }: HistogramChartProps) {
  const { charts } = data;
  const chartData = charts.value_histogram;
  const isExporting = useIsExporting();

  const renderChart = useCallback(
    ({ width, height }: ChartRenderSize) => (
      <HistogramPlot chartData={chartData} width={width} height={height} />
    ),
    [chartData]
  );

  const { items, lightBackground, setLightBackground } = useChartDownloads({
    render: renderChart,
    item: "histogram",
    title: "Value distribution",
    caption: CAPTION,
    sourceFileName,
    csvRows: () =>
      chartData.map((row) => ({
        Bucket: row.label,
        Lower: row.bucket_min,
        Upper: row.bucket_max,
        Products: row.count,
      })),
  });

  return (
    <div className="space-y-4">
      {!isExporting && (
        <div className="flex justify-end">
          <DownloadMenu
            items={items}
            itemLabel="Value distribution"
            lightBackground={lightBackground}
            onLightBackgroundChange={setLightBackground}
          />
        </div>
      )}
      <div className="h-[200px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <HistogramPlot chartData={chartData} />
        </ResponsiveContainer>
      </div>
      <p className="sr-only">
        Histogram showing distribution of values across {chartData.length} buckets.
      </p>
    </div>
  );
}

function HistogramPlot({
  chartData,
  width = 760,
  height = 200,
}: {
  chartData: AnalysisResponse["charts"]["value_histogram"];
  width?: number;
  height?: number;
}) {
  return (
    <BarChart
      data={chartData}
      width={width}
      height={height}
      margin={{ top: 10, right: 20, bottom: 30, left: 20 }}
    >
      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-rule)" />
      <XAxis
        dataKey="label"
        tick={{ fontSize: 10, fill: "var(--color-muted-text)" }}
        angle={-45}
        textAnchor="end"
        height={50}
      />
      <YAxis tick={{ fontSize: 11, fill: "var(--color-muted-text)" }} />
      <Tooltip
        contentStyle={{
          backgroundColor: "var(--color-page)",
          border: "1px solid var(--color-rule)",
          borderRadius: "6px",
        }}
      />
      <Bar
        dataKey="count"
        fill="var(--color-muted-text)"
        radius={[3, 3, 0, 0]}
        isAnimationActive={false}
      />
    </BarChart>
  );
}