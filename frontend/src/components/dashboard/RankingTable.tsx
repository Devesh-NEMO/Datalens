"use client";

import { useState, useMemo, useCallback } from "react";
import { Chapter, ClassBadge } from "@/components/ui";
import { DownloadButton } from "@/components/ui/DownloadButton";
import type { AnalysisResponse, ProductGrowthItemResponse } from "@/lib/api";
import { formatNumber, formatPercent, formatChangePercent } from "@/lib/format";
import { CHAPTER_IDS, CHAPTER_TITLES, DOWNLOAD_COPY } from "@/lib/constants";
import { exportTabularCsv, exportTabularPdf } from "@/lib/tabularExport";
import type { TablePdfColumn } from "@/lib/exportPdf";
import { cn } from "@/lib/cn";
import { FileText, Search, ChevronUp, ChevronDown } from "lucide-react";

interface RankingTableProps {
  data: AnalysisResponse;
  /** Original upload name, used to build download filenames. */
  sourceFileName?: string;
}

type SortKey = "rank" | "product" | "value" | "share_pct" | "cumulative_pct" | "abc_class";
type SortDir = "asc" | "desc";

/**
 * Column widths in PDF points. A4 portrait leaves 483pt between the margins,
 * and the product column takes whatever the fixed columns do not.
 */
const PDF_COLUMNS: readonly TablePdfColumn[] = [
  { header: "Rank", width: 34, align: "right" },
  // No width: the product column absorbs whatever the fixed columns leave over.
  { header: "Product" },
  { header: "Value", width: 78, align: "right" },
  { header: "Share %", width: 56, align: "right" },
  { header: "Cumulative %", width: 68, align: "right" },
  { header: "Class", width: 38, align: "center" },
  { header: "Growth %", width: 62, align: "right" },
];

export function RankingTable({ data, sourceFileName = "data.csv" }: RankingTableProps) {
  const { ranking, growth } = data;
  const [sortKey, setSortKey] = useState<SortKey>("rank");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [search, setSearch] = useState("");
  const [classFilter, setClassFilter] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);

  const growthMap = useMemo(() => {
    const map = new Map<string, ProductGrowthItemResponse>();
    if (growth.items) {
      for (const g of growth.items) {
        map.set(g.product, g);
      }
    }
    return map;
  }, [growth]);

  const filtered = useMemo(() => {
    let items = [...ranking.items];

    // Search filter
    if (search) {
      const q = search.toLowerCase();
      items = items.filter((i) => i.product.toLowerCase().includes(q));
    }

    // Class filter
    if (classFilter) {
      items = items.filter((i) => i.abc_class === classFilter);
    }

    // Sort
    items.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "rank") cmp = a.rank - b.rank;
      else if (sortKey === "product") cmp = a.product.localeCompare(b.product);
      else if (sortKey === "value") cmp = a.value - b.value;
      else if (sortKey === "share_pct") cmp = a.share_pct - b.share_pct;
      else if (sortKey === "cumulative_pct") cmp = a.cumulative_pct - b.cumulative_pct;
      else if (sortKey === "abc_class") cmp = a.abc_class.localeCompare(b.abc_class);
      return sortDir === "asc" ? cmp : -cmp;
    });

    return items;
  }, [ranking.items, search, classFilter, sortKey, sortDir]);

  const totalPages = Math.ceil(filtered.length / pageSize);
  const pageItems = filtered.slice(page * pageSize, (page + 1) * pageSize);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  /**
   * What a download contains: the rows currently visible after filtering and
   * sorting, not just the current page. Someone who searched for a product
   * expects the export to match what they are looking at.
   */
  const exportRows = useMemo(
    () =>
      filtered.map((item) => {
        const g = growthMap.get(item.product);
        return [
          item.rank,
          item.product,
          formatNumber(item.value),
          formatPercent(item.share_pct),
          formatPercent(item.cumulative_pct),
          item.abc_class,
          g ? formatChangePercent(g.change_pct) : "",
        ];
      }),
    [filtered, growthMap]
  );

  const exportDescriptor = useCallback(
    () => ({
      item: "rankingTable" as const,
      title: DOWNLOAD_COPY.rankingTableLabel,
      caption: DOWNLOAD_COPY.rankingTableCaption,
      sourceFileName,
      columns: PDF_COLUMNS,
      rows: exportRows,
    }),
    [exportRows, sourceFileName]
  );

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return null;
    return sortDir === "asc" ? (
      <ChevronUp className="h-3 w-3" aria-hidden="true" />
    ) : (
      <ChevronDown className="h-3 w-3" aria-hidden="true" />
    );
  };

  return (
    <Chapter number={8} id={CHAPTER_IDS.ranking} title={CHAPTER_TITLES[CHAPTER_IDS.ranking]}>
      <div className="space-y-4">
        {/* Controls */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--color-muted-text)]" aria-hidden="true" />
            <input
              type="text"
              placeholder="Search products..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
              className="w-full pl-9 pr-3 py-2 text-sm rounded-[6px] border border-[var(--color-rule)] bg-transparent text-[var(--color-text)] placeholder:text-[var(--color-muted-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
              aria-label="Search products"
            />
          </div>
          <div className="flex gap-2">
            {(["A", "B", "C"] as const).map((cls) => (
              <button
                key={cls}
                onClick={() => {
                  setClassFilter(classFilter === cls ? null : cls);
                  setPage(0);
                }}
                className={cn(
                  "px-3 py-2 text-sm rounded-[6px] border transition-colors",
                  classFilter === cls
                    ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]"
                    : "border-[var(--color-rule)] text-[var(--color-muted-text)] hover:text-[var(--color-text)]"
                )}
                aria-pressed={classFilter === cls}
              >
                {cls}
              </button>
            ))}
          </div>
          <div className="flex items-start gap-2">
            <DownloadButton
              label={DOWNLOAD_COPY.downloadCsv}
              format="CSV"
              run={() => exportTabularCsv(exportDescriptor())}
            />
            <DownloadButton
              label={DOWNLOAD_COPY.downloadPdf}
              format="PDF"
              icon={FileText}
              run={() => exportTabularPdf(exportDescriptor())}
            />
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto border border-[var(--color-rule)] rounded-[6px]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-[var(--color-page)]">
              <tr className="border-b border-[var(--color-rule)]">
                {(
                  [
                    ["rank", "Rank"],
                    ["product", "Product"],
                    ["value", "Value"],
                    ["share_pct", "Share %"],
                    ["cumulative_pct", "Cumulative %"],
                    ["abc_class", "Class"],
                  ] as [SortKey, string][]
                ).map(([key, label]) => (
                  <th
                    key={key}
                    className="px-3 py-2 text-left text-xs uppercase tracking-widest text-[var(--color-muted-text)] font-medium cursor-pointer hover:text-[var(--color-text)] transition-colors select-none"
                    onClick={() => handleSort(key)}
                    aria-sort={sortKey === key ? (sortDir === "asc" ? "ascending" : "descending") : undefined}
                  >
                    <span className="inline-flex items-center gap-1">
                      {label}
                      <SortIcon col={key} />
                    </span>
                  </th>
                ))}
                <th className="px-3 py-2 text-left text-xs uppercase tracking-widest text-[var(--color-muted-text)] font-medium">
                  Growth
                </th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((item) => {
                const g = growthMap.get(item.product);
                return (
                  <tr
                    key={item.rank}
                    className="border-b border-[var(--color-rule)] last:border-0 hover:bg-[var(--color-rule)]/30 transition-colors"
                  >
                    <td className="px-3 py-2 text-[var(--color-muted-text)]">{item.rank}</td>
                    <td className="px-3 py-2 text-[var(--color-text)]">{item.product}</td>
                    <td className="px-3 py-2 text-[var(--color-text)] text-right">
                      {formatNumber(item.value)}
                    </td>
                    <td className="px-3 py-2 text-[var(--color-muted-text)] text-right">
                      {formatPercent(item.share_pct)}
                    </td>
                    <td className="px-3 py-2 text-[var(--color-muted-text)] text-right">
                      {formatPercent(item.cumulative_pct)}
                    </td>
                    <td className="px-3 py-2">
                      <ClassBadge class={item.abc_class as "A" | "B" | "C"} size="sm" />
                    </td>
                    <td className="px-3 py-2 text-right">
                      {g ? (
                        <span
                          className={cn(
                            "text-sm",
                            g.direction === "rising"
                              ? "text-[var(--color-class-a)]"
                              : g.direction === "falling"
                                ? "text-[var(--color-class-c)]"
                                : "text-[var(--color-muted-text)]"
                          )}
                        >
                          {g.change_pct > 0 ? "+" : ""}
                          {g.change_pct.toFixed(1)}%
                        </span>
                      ) : (
                        <span className="text-[var(--color-muted-text)]">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between text-sm text-[var(--color-muted-text)]">
          <span>
            {filtered.length} products · Page {page + 1} of {totalPages}
          </span>
          <div className="flex items-center gap-2">
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(0);
              }}
              className="px-2 py-1 text-sm rounded-[6px] border border-[var(--color-rule)] bg-transparent text-[var(--color-text)]"
              aria-label="Page size"
            >
              {[10, 25, 50].map((n) => (
                <option key={n} value={n}>
                  {n} / page
                </option>
              ))}
            </select>
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-3 py-1 rounded-[6px] border border-[var(--color-rule)] disabled:opacity-50 hover:bg-[var(--color-rule)] transition-colors"
              aria-label="Previous page"
            >
              Prev
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="px-3 py-1 rounded-[6px] border border-[var(--color-rule)] disabled:opacity-50 hover:bg-[var(--color-rule)] transition-colors"
              aria-label="Next page"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </Chapter>
  );
}