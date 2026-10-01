"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  Cell,
} from "recharts";
import { useCallback, useMemo } from "react";
import type { AnalysisResponse } from "@/lib/api";
import { DownloadMenu } from "@/components/ui/DownloadMenu";
import { useChartDownloads, type ChartRenderSize } from "@/lib/chartExport";
import { useIsExporting } from "./ChartExportContext";

interface AbcBarChartProps {
  data: AnalysisResponse;
  sourceFileName?: string;
}

const CAPTION =
  "Value share against product count share for each class. Class A holds most of the value in few products.";

const ABC_COLORS: Record<string, string> = {
  A: "var(--color-class-a)",
  B: "var(--color-class-b)",
  C: "var(--color-class-c)",
};

export function AbcBarChart({ data, sourceFileName = "data.csv" }: AbcBarChartProps) {
  const isExporting = useIsExporting();
  const { charts, ranking } = data;
  const chartData = charts.abc_distribution;

  // Calculate product count share
  const totalProducts = ranking.product_count;
  const barData = useMemo(
    () =>
      chartData.map((d) => ({
        ...d,
        product_count_share_pct: (d.product_count / totalProducts) * 100,
      })),
    [chartData, totalProducts]
  );

  const renderChart = useCallback(
    ({ width, height }: ChartRenderSize) => (
      <AbcBarPlot barData={barData} width={width} height={height} />
    ),
    [barData]
  );

  const { items, lightBackground, setLightBackground } = useChartDownloads({
    render: renderChart,
    item: "abcBar",
    title: "ABC value share vs product count share",
    caption: CAPTION,
    sourceFileName,
    csvRows: () =>
      barData.map((row) => ({
        Class: row.abc_class,
        Products: row.product_count,
        "Value share %": row.value_share_pct,
        "Product count share %": Number(row.product_count_share_pct.toFixed(2)),
      })),
  });

  return (
    <div className="space-y-4">
      {!isExporting && (
        <div className="flex justify-end">
          <DownloadMenu
            items={items}
            itemLabel="ABC value vs count"
            lightBackground={lightBackground}
            onLightBackgroundChange={setLightBackground}
          />
        </div>
      )}
      <div className="h-[200px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AbcBarPlot barData={barData} />
        </ResponsiveContainer>
      </div>
      <p className="sr-only">
        Grouped bar chart comparing value share against product count share for each ABC class.
      </p>
    </div>
  );
}

type AbcBarRow = AnalysisResponse['charts']['abc_distribution'][number] & {
  product_count_share_pct: number;
};

function AbcBarPlot({
  barData,
  width = 760,
  height = 200,
}: {
  barData: AbcBarRow[];
  width?: number;
  height?: number;
}) {
  return (
    <BarChart
      data={barData}
      width={width}
      height={height}
      margin={{ top: 10, right: 20, bottom: 10, left: 20 }}
    >
      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-rule)" />
      <XAxis
        dataKey="abc_class"
        tick={{ fontSize: 12, fill: "var(--color-text)" }}
      />
      <YAxis
        tick={{ fontSize: 11, fill: "var(--color-muted-text)" }}
        tickFormatter={(v) => `${v}%`}
      />
      <Tooltip
        contentStyle={{
          backgroundColor: "var(--color-page)",
          border: "1px solid var(--color-rule)",
          borderRadius: "6px",
        }}
      />
      <Legend />
      <Bar
        dataKey="value_share_pct"
        name="Value share %"
        fill="var(--color-accent)"
        radius={[3, 3, 0, 0]}
        isAnimationActive={false}
      >
        {barData.map((entry, index) => (
          <Cell key={`cell-${index}`} fill={ABC_COLORS[entry.abc_class]} />
        ))}
      </Bar>
      <Bar
        dataKey="product_count_share_pct"
        name="Product count share %"
        fill="var(--color-muted-text)"
        radius={[3, 3, 0, 0]}
        isAnimationActive={false}
      />
    </BarChart>
  );
}