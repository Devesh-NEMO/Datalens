export function getAnalysisFingerprint(opts: {
  datasetId?: string | null;
  fileName?: string | null;
  size?: number | null;
  lastModified?: number | null;
  productColumn?: string | null;
  valueColumn?: string | null;
  dateColumn?: string | null;
  analysisTimestamp?: string | number | null;
}): string {
  if (opts.datasetId) return `ds:${opts.datasetId}`;
  const parts = [
    opts.fileName || 'file',
    String(opts.size ?? ''),
    String(opts.lastModified ?? ''),
    opts.productColumn || '',
    opts.valueColumn || '',
    opts.dateColumn || '',
    String(opts.analysisTimestamp ?? ''),
  ];
  return parts.join('|');
}
