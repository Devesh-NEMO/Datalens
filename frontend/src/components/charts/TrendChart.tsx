"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useCallback } from "react";
import type { AnalysisResponse } from "@/lib/api";
import { formatNumber, formatDate } from "@/lib/format";
import { DownloadMenu } from "@/components/ui/DownloadMenu";
import { useChartDownloads, type ChartRenderSize } from "@/lib/chartExport";
import { useIsExporting } from "./ChartExportContext";

interface TrendChartProps {
  data: AnalysisResponse;
  sourceFileName?: string;
}

const CAPTION = "Total value by month across the whole period in the file.";

export function TrendChart({ data, sourceFileName = "data.csv" }: TrendChartProps) {
  const { charts } = data;
  const chartData = charts.monthly_trend;
  const isExporting = useIsExporting();

  const renderChart = useCallback(
    ({ width, height }: ChartRenderSize) => (
      <TrendPlot chartData={chartData ?? []} width={width} height={height} />
    ),
    [chartData]
  );

  const { items, lightBackground, setLightBackground } = useChartDownloads({
    render: renderChart,
    item: "trend",
    title: "Monthly value trend",
    caption: CAPTION,
    sourceFileName,
    csvRows: () =>
      (chartData ?? []).map((row) => ({
        Month: row.month,
        Value: row.value,
      })),
  });

  if (!chartData || chartData.length === 0) return null;

  return (
    <div className="space-y-4">
      {!isExporting && (
        <div className="flex justify-end">
          <DownloadMenu
            items={items}
            itemLabel="Monthly trend"
            lightBackground={lightBackground}
            onLightBackgroundChange={setLightBackground}
          />
        </div>
      )}
      <div className="h-[250px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <TrendPlot chartData={chartData} />
        </ResponsiveContainer>
      </div>
      <p className="sr-only">
        Line chart showing monthly value trend from {formatDate(chartData[0].month)} to{" "}
        {formatDate(chartData[chartData.length - 1].month)}.
      </p>
    </div>
  );
}

function TrendPlot({
  chartData,
  width = 760,
  height = 250,
}: {
  chartData: AnalysisResponse["charts"]["monthly_trend"];
  width?: number;
  height?: number;
}) {
  return (
    <LineChart
      data={chartData}
      width={width}
      height={height}
      margin={{ top: 10, right: 20, bottom: 30, left: 20 }}
    >
      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-rule)" />
      <XAxis
        dataKey="month"
        tick={{ fontSize: 11, fill: "var(--color-muted-text)" }}
        tickFormatter={(v) => formatDate(String(v))}
      />
      <YAxis
        tick={{ fontSize: 11, fill: "var(--color-muted-text)" }}
        tickFormatter={(v) => formatNumber(v)}
      />
      <Tooltip
        contentStyle={{
          backgroundColor: "var(--color-page)",
          border: "1px solid var(--color-rule)",
          borderRadius: "6px",
        }}
        labelFormatter={(v) => formatDate(String(v))}
      />
      <Line
        type="monotone"
        dataKey="value"
        stroke="var(--color-accent)"
        strokeWidth={2}
        dot={{ fill: "var(--color-accent)", r: 3 }}
        activeDot={{ r: 5 }}
        isAnimationActive={false}
      />
    </LineChart>
  );
}