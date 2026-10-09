"use client";

import { useState } from "react";
import { Chapter } from "@/components/ui";
import type { AnalysisResponse, ColumnCandidateResponse } from "@/lib/api";
import { CHAPTER_IDS, CHAPTER_TITLES, TOP_N_OPTIONS } from "@/lib/constants";

interface ColumnSelectorProps {
  data: AnalysisResponse;
  onReanalyze: (options: {
    product_column?: string;
    value_column?: string;
    date_column?: string;
    top_n?: number;
  }) => void;
  isLoading?: boolean;
}

function CandidateSelect({
  label,
  candidates,
  value,
  onChange,
}: {
  label: string;
  candidates: ColumnCandidateResponse[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs uppercase tracking-widest text-[var(--color-muted-text)]">
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="app-select w-full"
      >
        {candidates.map((c) => (
          <option key={c.name} value={c.name}>
            {c.name} ({(c.confidence * 100).toFixed(0)}%)
          </option>
        ))}
      </select>
    </div>
  );
}

export function ColumnSelector({ data, onReanalyze, isLoading }: ColumnSelectorProps) {
  const { selection } = data;
  const [productCol, setProductCol] = useState(selection.product_column);
  const [valueCol, setValueCol] = useState(selection.value_column);
  const [dateCol, setDateCol] = useState(selection.date_column || "");
  const [topN, setTopN] = useState(10);

  const handleApply = () => {
    onReanalyze({
      product_column: productCol,
      value_column: valueCol,
      date_column: dateCol || undefined,
      top_n: topN,
    });
  };

  return (
    <Chapter number={2} id={CHAPTER_IDS.settings} title={CHAPTER_TITLES[CHAPTER_IDS.settings]}>
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <CandidateSelect
            label="Product column"
            candidates={selection.product_candidates}
            value={productCol}
            onChange={setProductCol}
          />
          <CandidateSelect
            label="Value column"
            candidates={selection.value_candidates}
            value={valueCol}
            onChange={setValueCol}
          />
          <CandidateSelect
            label="Date column"
            candidates={selection.date_candidates || []}
            value={dateCol}
            onChange={setDateCol}
          />
        </div>

        <div className="flex items-end gap-4">
          <div className="space-y-1">
            <label className="text-xs uppercase tracking-widest text-[var(--color-muted-text)]">
              Top N
            </label>
            <select
              value={topN}
              onChange={(e) => setTopN(Number(e.target.value))}
              className="app-select w-full"
            >
              {TOP_N_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={handleApply}
            disabled={isLoading}
            className="px-4 py-2 text-sm font-medium rounded-[6px] bg-[var(--color-text)] text-[var(--color-page)] hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {isLoading ? "Analyzing..." : "Apply"}
          </button>
        </div>

        {selection.derived_revenue_created && (
          <p className="text-sm text-[var(--color-muted-text)]">
            Revenue was derived from quantity × price
          </p>
        )}
      </div>
    </Chapter>
  );
}