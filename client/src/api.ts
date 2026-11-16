import type {
  ApiErrorBody,
  ApiIssue,
  GenerateRequest,
  GenerateResponse,
  HealthResponse,
  HistoryResponse,
} from '../../shared/brief';

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly status: number,
    readonly issues: ApiIssue[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const CLIENT_TIMEOUT_MS = 120_000;

async function request<T>(path: string, init: RequestInit & { clientId?: string } = {}): Promise<T> {
  const { clientId, signal, ...rest } = init;
  const timeout = AbortSignal.timeout(CLIENT_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const headers = new Headers(rest.headers);
  if (rest.body) headers.set('content-type', 'application/json');
  if (clientId) headers.set('x-client-id', clientId);

  let res: Response;
  try {
    res = await fetch(path, { ...rest, headers, signal: combined });
  } catch (error) {
    if (signal?.aborted) throw error;
    if (timeout.aborted) {
      throw new ApiError('timeout', 'NameForge took too long to answer. Please try again.', true, 0);
    }
    throw new ApiError('network', "We couldn't reach the NameForge server. Check your connection and try again.", true, 0);
  }

  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }

  if (!res.ok) {
    const err = (body as ApiErrorBody | null)?.error;
    if (err) throw new ApiError(err.code, err.message, err.retryable, res.status, err.issues);
    throw new ApiError('http_error', `The server answered with an error (${res.status}). Please try again.`, res.status >= 500, res.status);
  }
  if (body === null) throw new ApiError('bad_response', 'The server sent an empty answer. Please try again.', true, res.status);
  return body as T;
}

export const api = {
  health: (signal?: AbortSignal) => request<HealthResponse>('/api/health', { signal }),
  generate: (payload: GenerateRequest, signal: AbortSignal, clientId?: string) =>
    request<GenerateResponse>('/api/generate', { method: 'POST', body: JSON.stringify(payload), signal, clientId }),
  history: (clientId: string, signal?: AbortSignal) => request<HistoryResponse>('/api/history', { clientId, signal }),
  clearHistory: (clientId: string) => request<{ deleted: number }>('/api/history', { method: 'DELETE', clientId }),
};
