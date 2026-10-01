"use client";

import { useCallback } from "react";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  type PieLabelRenderProps,
} from "recharts";
import type { AnalysisResponse } from "@/lib/api";
import { formatPercent } from "@/lib/format";
import { DownloadMenu } from "@/components/ui/DownloadMenu";
import { useChartDownloads, type ChartRenderSize } from "@/lib/chartExport";
import { useIsExporting } from "./ChartExportContext";

interface AbcPieChartProps {
  data: AnalysisResponse;
  sourceFileName?: string;
}

const CAPTION =
  "Share of total value by ABC class. Each slice is labelled with its class letter.";

const ABC_COLORS: Record<string, string> = {
  A: "var(--color-class-a)",
  B: "var(--color-class-b)",
  C: "var(--color-class-c)",
};

export function AbcPieChart({ data, sourceFileName = "data.csv" }: AbcPieChartProps) {
  const { charts } = data;
  const chartData = charts.abc_distribution;
  const isExporting = useIsExporting();

  const renderChart = useCallback(
    ({ width, height }: ChartRenderSize) => (
      <AbcPiePlot chartData={chartData} width={width} height={height} />
    ),
    [chartData]
  );

  const { items, lightBackground, setLightBackground } = useChartDownloads({
    render: renderChart,
    item: "abcPie",
    title: "Value share by ABC class",
    caption: CAPTION,
    sourceFileName,
    csvRows: () =>
      chartData.map((row) => ({
        Class: row.abc_class,
        Products: row.product_count,
        "Value share %": row.value_share_pct,
      })),
  });

  const total = chartData.reduce((sum, row) => sum + row.value_share_pct, 0);

  return (
    <div className="space-y-4">
      {!isExporting && (
        <div className="flex justify-end">
          <DownloadMenu
            items={items}
            itemLabel="ABC share pie"
            lightBackground={lightBackground}
            onLightBackgroundChange={setLightBackground}
          />
        </div>
      )}
      <div className="h-[250px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AbcPiePlot chartData={chartData} />
        </ResponsiveContainer>
      </div>
      <p className="sr-only">
        Pie chart showing value share by ABC class. Class A: {formatPercent(
          chartData.find((d) => d.abc_class === "A")?.value_share_pct ?? 0
        )}
        , Class B: {formatPercent(chartData.find((d) => d.abc_class === "B")?.value_share_pct ?? 0)}, Class
        C: {formatPercent(chartData.find((d) => d.abc_class === "C")?.value_share_pct ?? 0)}. Total
        value share: {formatPercent(total)}.
      </p>
    </div>
  );
}

/**
 * A pie has no intrinsic size, so the radius follows the shorter side.
 *
 * Bounded by the box it is actually drawn in, not by a square of its own:
 * a square canvas would leave the right-hand side of a wide chart empty and
 * push the pie left of centre.
 */
function radiusFor(width: number, height: number): number {
  return Math.max(40, Math.min(width, height) / 2 - 30);
}

function AbcPiePlot({
  chartData,
  width = 480,
  height = 250,
}: {
  chartData: AnalysisResponse["charts"]["abc_distribution"];
  width?: number;
  height?: number;
}) {
  return (
    <PieChart width={width} height={height}>
      <Pie
        data={chartData}
        dataKey="value_share_pct"
        nameKey="abc_class"
        cx="50%"
        cy="50%"
        outerRadius={radiusFor(width, height)}
        innerRadius={0}
        isAnimationActive={false}
        // Never colour alone: the class letter is part of the label.
        label={(props: PieLabelRenderProps) => {
          // The row's own fields live on `payload`; the rest is sector geometry.
          const row = props.payload as { abc_class?: string } | undefined;
          const abcClass = String(row?.abc_class ?? props.name ?? "");
          const share = Number(props.value ?? 0);
          return `${abcClass} ${share.toFixed(1)}%`;
        }}
      >
        {chartData.map((entry) => (
          <Cell key={entry.abc_class} fill={ABC_COLORS[entry.abc_class] ?? "var(--color-muted-text)"} />
        ))}
      </Pie>
      <Tooltip
        formatter={(value) => formatPercent(Number(value))}
        contentStyle={{
          backgroundColor: "var(--color-page)",
          border: "1px solid var(--color-rule)",
          borderRadius: "6px",
        }}
        labelStyle={{ color: "var(--color-text)" }}
      />
    </PieChart>
  );
}