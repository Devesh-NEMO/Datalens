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
  /** HTTP status of the failed request; 0 when the server could not be reached. */
  status?: number;
}

export interface AnalyzeOptions {
  product_column?: string;
  value_column?: string;
  date_column?: string;
  top_n?: number;
  sheet_name?: string;
}

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

/**
 * Auth hooks, registered once by `src/lib/auth.ts`.
 *
 * The dependency runs one way on purpose: `auth.ts` imports this module, never
 * the other way round, so the API client stays usable with no auth module
 * loaded at all (tests, tooling, a future auth-off build). Until the hooks are
 * registered, requests are anonymous and a 401 is just a failed request.
 */
export interface AuthHooks {
  /** Current bearer token, or null when signed out. */
  getToken: () => string | null;
  /** Called when a request that carried a token came back 401. */
  onUnauthorized: () => void;
}

let authHooks: AuthHooks | null = null;

export function registerAuthHooks(hooks: AuthHooks | null): void {
  authHooks = hooks;
}

/** The message shown whenever the server cannot be reached at all. */
export const NETWORK_ERROR: AnalyzeError = {
  code: 'network_error',
  message: "Can't reach the server",
  hint: 'Check your connection and try again.',
  status: 0,
};

/**
 * The one place that talks to the backend.
 *
 * Attaches `Authorization: Bearer <token>` when a session exists and runs the
 * central 401 handler when a token-carrying request is rejected. Callers still
 * decide what a failed response *means* — this only owns identity and session
 * expiry.
 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = authHooks?.getToken() ?? null;
  if (token) headers.set('Authorization', `Bearer ${token}`);

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });
  } catch {
    // fetch only rejects for network-level failures (DNS, CORS, offline).
    throw { ...NETWORK_ERROR };
  }

  if (res.status === 401 && token) {
    // The token was presented and rejected — the session is over. When no token
    // was attached (a plain anonymous request, or a failed sign-in) there is
    // nothing to expire and no reason to bounce the user.
    authHooks?.onUnauthorized();
  }
  return res;
}

/**
 * Turn a failed response into the flat error shape the UI already renders.
 *
 * The backend wraps errors as `{error: {code, message, hint}}`; FastAPI's own
 * validation failures arrive as `detail`. Both are normalised here so callers
 * never have to know which they got.
 */
export async function parseError(res: Response): Promise<AnalyzeError> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  const envelope = (body as { error?: Partial<AnalyzeError> } | null)?.error;
  if (envelope && typeof envelope.message === 'string') {
    return {
      code: envelope.code ?? `http_${res.status}`,
      message: envelope.message,
      hint: envelope.hint,
      status: res.status,
    };
  }

  const detail = (body as { detail?: unknown } | null)?.detail;
  if (typeof detail === 'string') {
    return { code: `http_${res.status}`, message: detail, status: res.status };
  }
  if (Array.isArray(detail)) {
    const message = detail
      .map((item) => (item && typeof item === 'object' && 'msg' in item ? String(item.msg) : ''))
      .filter(Boolean)
      .join(' ');
    if (message) return { code: `http_${res.status}`, message, status: res.status };
  }

  return {
    code: `http_${res.status}`,
    message: `The server returned an error (${res.status}).`,
    status: res.status,
  };
}

/** Throw the parsed error for a non-OK response, after normalising it. */
export async function throwParsedError(res: Response): Promise<never> {
  throw await parseError(res);
}

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

  const res = await apiFetch('/analyze', {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    await throwParsedError(res);
  }

  return res.json() as Promise<AnalysisResponse>;
}

export async function checkHealth(): Promise<{ status: string; version: string }> {
  const res = await apiFetch('/health');
  if (!res.ok) {
    throw { ...NETWORK_ERROR, code: 'health_failed', message: 'Health check failed' };
  }
  return res.json();
}
