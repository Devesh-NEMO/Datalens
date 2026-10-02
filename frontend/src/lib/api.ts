import type { components } from '@/types/api';

export type AnalysisResponse = components['schemas']['AnalysisResponse'];
export type MetaResponse = components['schemas']['MetaResponse'];
export type CleaningReportResponse = components['schemas']['CleaningReportResponse'];
export type DatasetProfileResponse = components['schemas']['DatasetProfileResponse'];
export type QualityScoreResponse = components['schemas']['QualityScoreResponse'];
export type ColumnSelectionResponse = components['schemas']['ColumnSelectionResponse'];
export type RankingResponse = components['schemas']['RankingResponse'];
export type GrowthResponse = components['schemas']['GrowthResponse'];
export type ChartsResponse = components['schemas']['ChartsResponse'];
export type ProductRankItemResponse = components['schemas']['ProductRankItemResponse'];
export type ProductGrowthItemResponse = components['schemas']['ProductGrowthItemResponse'];
export type ABCDistributionItemResponse = components['schemas']['ABCDistributionItemResponse'];
export type ABCSummaryResponse = components['schemas']['ABCSummaryResponse'];
export type ColumnCandidateResponse = components['schemas']['ColumnCandidateResponse'];
export type ColumnProfileResponse = components['schemas']['ColumnProfileResponse'];
export type TopProductBarItemResponse = components['schemas']['TopProductBarItemResponse'];
export type ParetoCurveItemResponse = components['schemas']['ParetoCurveItemResponse'];
export type MonthlyTrendItemResponse = components['schemas']['MonthlyTrendItemResponse'];
export type HistogramBucketResponse = components['schemas']['HistogramBucketResponse'];
export type ValueCountResponse = components['schemas']['ValueCountResponse'];

export interface AnalyzeError {
  code: string;
  message: string;
  hint?: string;
}

export interface AnalyzeOptions {
  product_column?: string;
  value_column?: string;
  date_column?: string;
  top_n?: number;
  sheet_name?: string;
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export async function analyzeFile(
  file: File,
  options?: AnalyzeOptions
): Promise<AnalysisResponse> {
  const formData = new FormData();
  formData.append('file', file);

  if (options?.product_column) {
    formData.append('product_column', options.product_column);
  }
  if (options?.value_column) {
    formData.append('value_column', options.value_column);
  }
  if (options?.date_column) {
    formData.append('date_column', options.date_column);
  }
  if (options?.top_n) {
    formData.append('top_n', String(options.top_n));
  }
  if (options?.sheet_name) {
    formData.append('sheet_name', options.sheet_name);
  }

  const res = await fetch(`${API_BASE_URL}/analyze`, {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const data = (await res.json()) as AnalyzeError;
    throw data;
  }

  return res.json() as Promise<AnalysisResponse>;
}

export async function checkHealth(): Promise<{ status: string; version: string }> {
  const res = await fetch(`${API_BASE_URL}/health`);
  if (!res.ok) {
    throw new Error('Health check failed');
  }
  return res.json();
}