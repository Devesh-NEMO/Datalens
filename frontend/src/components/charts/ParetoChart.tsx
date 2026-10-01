"use client";

import { useCallback } from "react";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Legend,
} from "recharts";
import type { AnalysisResponse } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { DownloadMenu } from "@/components/ui/DownloadMenu";
import { useChartDownloads, type ChartRenderSize } from "@/lib/chartExport";
import { useIsExporting } from "./ChartExportContext";

interface ParetoChartProps {
  data: AnalysisResponse;
  /** Original upload name, used to build download filenames. */
  sourceFileName?: string;
}

/** One-line description reused as the chart's caption in exports. */
const PARETO_CAPTION =
  "Bars show each product's value. The line is the running cumulative share, with reference lines at 80% and 95%.";

export function ParetoChart({ data, sourceFileName = "data.csv" }: ParetoChartProps) {
  const { charts } = data;
  const chartData = charts.pareto_curve;
  const isExporting = useIsExporting();

  // Stable identity so the menu does not rebuild on every parent render.
  const renderChart = useCallback(
    ({ width, height }: ChartRenderSize) => (
      <ParetoPlot chartData={chartData} width={width} height={height} />
    ),
    [chartData]
  );

  const { items, lightBackground, setLightBackground } = useChartDownloads({
    render: renderChart,
    item: "paretoCurve",
    title: "Pareto curve",
    caption: PARETO_CAPTION,
    sourceFileName,
    csvRows: () =>
      chartData.map((row) => ({
        Product: row.product,
        Value: row.value,
        Cumulative: row.cumulative_pct,
      })),
  });

  return (
    <div className="space-y-4">
      {!isExporting && (
        <div className="flex justify-end">
          <DownloadMenu
            items={items}
            itemLabel="Pareto curve"
            lightBackground={lightBackground}
            onLightBackgroundChange={setLightBackground}
          />
        </div>
      )}
      <div className="h-[300px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ParetoPlot chartData={chartData} />
        </ResponsiveContainer>
      </div>
      <p className="sr-only">
        Pareto chart showing {chartData.length} products. Bars represent individual product values,
        and the line shows cumulative percentage. Reference lines mark 80% and 95% thresholds.
      </p>
    </div>
  );
}

/**
 * The plot on its own, so the offscreen export can render it without the
 * download menu and screen-reader description that only belong on screen.
 */
/**
 * The plot on its own, so the offscreen export can render it without the
 * download menu and screen-reader description that only belong on screen.
 *
 * `width`/`height` are defaults, not requirements: on screen a
 * ResponsiveContainer injects its own measured values, and Recharts renders
 * nothing at all without them. The export path renders this bare, so it has to
 * supply a size.
 */
function ParetoPlot({
  chartData,
  width = 760,
  height = 300,
}: {
  chartData: AnalysisResponse["charts"]["pareto_curve"];
  width?: number;
  height?: number;
}) {
  return (
    <ComposedChart
      data={chartData}
      width={width}
      height={height}
      margin={{ top: 20, right: 20, bottom: 60, left: 20 }}
    >
      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-rule)" />
      <XAxis
        dataKey="product"
        tick={{ fontSize: 10, fill: "var(--color-muted-text)" }}
        angle={-45}
        textAnchor="end"
        height={60}
      />
      <YAxis
        yAxisId="left"
        tick={{ fontSize: 11, fill: "var(--color-muted-text)" }}
        tickFormatter={(v) => formatNumber(v)}
      />
      <YAxis
        yAxisId="right"
        orientation="right"
        tick={{ fontSize: 11, fill: "var(--color-muted-text)" }}
        tickFormatter={(v) => `${v}%`}
        domain={[0, 100]}
      />
      <Tooltip
        contentStyle={{
          backgroundColor: "var(--color-page)",
          border: "1px solid var(--color-rule)",
          borderRadius: "6px",
        }}
        labelStyle={{ color: "var(--color-text)" }}
      />
      <Legend />
      <ReferenceLine
        yAxisId="right"
        y={80}
        stroke="var(--color-class-a)"
        strokeDasharray="4 4"
        label={{ value: "80%", position: "right", fill: "var(--color-class-a)", fontSize: 11 }}
      />
      <ReferenceLine
        yAxisId="right"
        y={95}
        stroke="var(--color-class-b)"
        strokeDasharray="4 4"
        label={{ value: "95%", position: "right", fill: "var(--color-class-b)", fontSize: 11 }}
      />
      <Bar
        yAxisId="left"
        dataKey="value"
        fill="var(--color-muted-text)"
        name="Value"
        isAnimationActive={false}
      />
      <Line
        yAxisId="right"
        type="monotone"
        dataKey="cumulative_pct"
        stroke="var(--color-accent)"
        strokeWidth={2}
        dot={false}
        name="Cumulative %"
        isAnimationActive={false}
      />
    </ComposedChart>
  );
}