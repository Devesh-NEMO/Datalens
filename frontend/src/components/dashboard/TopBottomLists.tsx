"use client";

import { Chapter } from "@/components/ui";
import { DownloadButton } from "@/components/ui/DownloadButton";
import type {
  AnalysisResponse,
  ProductRankItemResponse,
  ProductGrowthItemResponse,
} from "@/lib/api";
import { formatNumber, formatPercent, formatChangePercent } from "@/lib/format";
import { DOWNLOAD_COPY } from "@/lib/constants";
import { exportTabularCsv } from "@/lib/tabularExport";
import type { TablePdfColumn } from "@/lib/exportPdf";
import { cn } from "@/lib/cn";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

interface ListProps {
  data: AnalysisResponse;
  /** Original upload name, used to build download filenames. */
  sourceFileName?: string;
}

function buildGrowthMap(growth: AnalysisResponse["growth"]): Map<string, ProductGrowthItemResponse> {
  const map = new Map<string, ProductGrowthItemResponse>();
  for (const g of growth.items ?? []) {
    map.set(g.product, g);
  }
  return map;
}

/**
 * Column widths in PDF points, shared by both lists so the two CSVs match.
 * Only CSV is offered here; the lists are already printed in full in the PDF
 * report, so a separate per-list PDF would be a worse version of that page.
 */
const LIST_COLUMNS: readonly TablePdfColumn[] = [
  { header: "Rank", width: 40, align: "right" },
  { header: "Product" },
  { header: "Value", width: 90, align: "right" },
  { header: "Share %", width: 64, align: "right" },
  { header: "Change %", width: 74, align: "right" },
  { header: "Class", width: 44, align: "center" },
];

function GrowthBadge({ growth }: { growth: ProductGrowthItemResponse | undefined }) {
  if (!growth) return null;

  const Icon =
    growth.direction === "rising"
      ? TrendingUp
      : growth.direction === "falling"
        ? TrendingDown
        : Minus;

  const color =
    growth.direction === "rising"
      ? "text-[var(--color-class-a)]"
      : growth.direction === "falling"
        ? "text-[var(--color-class-c)]"
        : "text-[var(--color-muted-text)]";

  return (
    <span
      className={cn("inline-flex items-center gap-1 text-xs", color)}
      aria-label={`${growth.direction} ${formatChangePercent(growth.change_pct)}`}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {formatChangePercent(growth.change_pct)}
    </span>
  );
}

function ProductRow({
  item,
  growth,
}: {
  item: ProductRankItemResponse;
  growth: ProductGrowthItemResponse | undefined;
}) {
  return (
    <li className="flex items-center justify-between py-2 border-b border-[var(--color-rule)] last:border-0">
      <div className="flex items-center gap-3 min-w-0">
        <span className="text-sm text-[var(--color-muted-text)] w-6 text-right">
          {item.rank}
        </span>
        <span className="text-sm text-[var(--color-text)] truncate">{item.product}</span>
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        <GrowthBadge growth={growth} />
        <span className="text-sm text-[var(--color-text)] w-20 text-right">
          {formatNumber(item.value)}
        </span>
        <span className="text-sm text-[var(--color-muted-text)] w-14 text-right">
          {formatPercent(item.share_pct)}
        </span>
        <span
          className="inline-flex items-center gap-1 text-xs"
          style={{ color: `var(--color-class-${item.abc_class.toLowerCase()})` }}
        >
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: `var(--color-class-${item.abc_class.toLowerCase()})` }}
            aria-hidden="true"
          />
          {item.abc_class}
        </span>
      </div>
    </li>
  );
}

/**
 * The CSV payload for a list, shared by both lists so the two files have
 * identical columns in an identical order.
 */
function listRows(
  items: readonly ProductRankItemResponse[],
  growthMap: Map<string, ProductGrowthItemResponse>
): (string | number)[][] {
  return items.map((item) => {
    const g = growthMap.get(item.product);
    return [
      item.rank,
      item.product,
      formatNumber(item.value),
      formatPercent(item.share_pct),
      g ? formatChangePercent(g.change_pct) : "",
      item.abc_class,
    ];
  });
}

/** "Most important" list, rendered inside Chapter 04. */
export function TopList({ data, sourceFileName = "data.csv" }: ListProps) {
  const growthMap = buildGrowthMap(data.growth);
  const items = data.ranking.top_n;

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <DownloadButton
          label={DOWNLOAD_COPY.downloadCsv}
          format="CSV"
          run={() =>
            exportTabularCsv({
              item: "mostImportant",
              title: DOWNLOAD_COPY.mostImportantLabel,
              sourceFileName,
              columns: LIST_COLUMNS,
              rows: listRows(items, growthMap),
            })
          }
        />
      </div>
      <ul className="space-y-1">
        {items.map((item) => (
          <ProductRow key={item.rank} item={item} growth={growthMap.get(item.product)} />
        ))}
      </ul>
    </div>
  );
}

/** "Least important" list, rendered inside Chapter 06. */
export function BottomList({ data, sourceFileName = "data.csv" }: ListProps) {
  const growthMap = buildGrowthMap(data.growth);
  const items = data.ranking.bottom_n;

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <DownloadButton
          label={DOWNLOAD_COPY.downloadCsv}
          format="CSV"
          run={() =>
            exportTabularCsv({
              item: "leastImportant",
              title: DOWNLOAD_COPY.leastImportantLabel,
              sourceFileName,
              columns: LIST_COLUMNS,
              rows: listRows(items, growthMap),
            })
          }
        />
      </div>
      <ul className="space-y-1">
        {items.map((item) => (
          <ProductRow key={item.rank} item={item} growth={growthMap.get(item.product)} />
        ))}
      </ul>
    </div>
  );
}

/** Convenience wrapper: both lists with their chapter headings. */
export function TopBottomLists({ data, sourceFileName }: ListProps) {
  return (
    <>
      <Chapter number={4} title="The leaders">
        <TopList data={data} sourceFileName={sourceFileName} />
      </Chapter>
      <Chapter number={6} title="The long tail">
        <BottomList data={data} sourceFileName={sourceFileName} />
      </Chapter>
    </>
  );
}