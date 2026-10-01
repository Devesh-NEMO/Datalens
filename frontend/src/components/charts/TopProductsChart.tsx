"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { useCallback, useMemo } from "react";
import type { AnalysisResponse } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { DownloadMenu } from "@/components/ui/DownloadMenu";
import { useChartDownloads, type ChartRenderSize } from "@/lib/chartExport";
import { useIsExporting } from "./ChartExportContext";

interface TopProductsChartProps {
  data: AnalysisResponse;
  sourceFileName?: string;
}

const CAPTION = "Bars are coloured by ABC class. Each bar shows one product's value.";

const ABC_COLORS: Record<string, string> = {
  A: "var(--color-class-a)",
  B: "var(--color-class-b)",
  C: "var(--color-class-c)",
};

export function TopProductsChart({ data, sourceFileName = "data.csv" }: TopProductsChartProps) {
  const { charts, ranking } = data;
  const chartData = charts.top_products_bar;
  const isExporting = useIsExporting();

  // Build a map from product name to ABC class
  const classMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of ranking.items) {
      map.set(item.product, item.abc_class);
    }
    return map;
  }, [ranking.items]);

  const renderChart = useCallback(
    ({ width, height }: ChartRenderSize) => (
      <TopProductsPlot chartData={chartData} classMap={classMap} width={width} height={height} />
    ),
    [chartData, classMap]
  );

  const { items, lightBackground, setLightBackground } = useChartDownloads({
    render: renderChart,
    item: "topProducts",
    title: "Top products by value",
    caption: CAPTION,
    sourceFileName,
    csvRows: () =>
      chartData.map((row) => ({
        Product: row.product,
        Value: row.value,
        Class: classMap.get(row.product) ?? "",
      })),
  });

  return (
    <div className="space-y-4">
      {!isExporting && (
        <div className="flex justify-end">
          <DownloadMenu
            items={items}
            itemLabel="Top products"
            lightBackground={lightBackground}
            onLightBackgroundChange={setLightBackground}
          />
        </div>
      )}
      <div className="h-[300px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <TopProductsPlot chartData={chartData} classMap={classMap} />
        </ResponsiveContainer>
      </div>
      <p className="sr-only">
        Horizontal bar chart showing top {chartData.length} products by value. Bars are colored by
        ABC class: A (green), B (yellow), C (red).
      </p>
    </div>
  );
}

function TopProductsPlot({
  chartData,
  classMap,
  width = 760,
  height = 300,
}: {
  chartData: AnalysisResponse["charts"]["top_products_bar"];
  classMap: Map<string, string>;
  width?: number;
  height?: number;
}) {
  return (
    <BarChart
      data={chartData}
      layout="vertical"
      width={width}
      height={height}
      margin={{ top: 10, right: 20, bottom: 10, left: 80 }}
    >
      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-rule)" horizontal={false} />
      <XAxis
        type="number"
        tick={{ fontSize: 11, fill: "var(--color-muted-text)" }}
        tickFormatter={(v) => formatNumber(v)}
      />
      <YAxis
        type="category"
        dataKey="product"
        tick={{ fontSize: 11, fill: "var(--color-text)" }}
        width={80}
      />
      <Tooltip
        contentStyle={{
          backgroundColor: "var(--color-page)",
          border: "1px solid var(--color-rule)",
          borderRadius: "6px",
        }}
        labelStyle={{ color: "var(--color-text)" }}
      />
      <Bar dataKey="value" name="Value" radius={[0, 3, 3, 0]} isAnimationActive={false}>
        {chartData.map((entry, index) => (
          <Cell key={`cell-${index}`} fill={ABC_COLORS[classMap.get(entry.product) || "C"]} />
        ))}
      </Bar>
    </BarChart>
  );
}