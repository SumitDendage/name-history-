import type {
  ApiErrorBody,
  ApiIssue,
  GenerateResponse,
  HealthResponse,
  HistoryResponse,
} from '../../shared/brief';
import type { Config } from './config';
import type { NameGenerator } from './providers/types';
import { formatIssues, generateRequestSchema } from './schema';
import { runGeneration, toGenerationError } from './service';
import type { StoreClient } from './store';

/**
 * Framework-agnostic API handlers. The Express server (server/src/app.ts) and the
 * Netlify Functions (netlify/functions/*) both call these, so behaviour is identical.
 */

export interface HandlerDeps {
  ai: NameGenerator | null;
  demo: NameGenerator;
  store: StoreClient | null;
  log?: (message: string, fields?: Record<string, unknown>) => void;
}

export interface ApiResult<T> {
  status: number;
  body: T | ApiErrorBody;
}

export function errorBody(code: string, message: string, retryable: boolean, issues?: ApiIssue[]): ApiErrorBody {
  return { error: { code, message, retryable, ...(issues ? { issues } : {}) } };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** The anonymous per-browser id used for Recent briefs, or null when missing or malformed. */
export function parseClientId(value: string | null | undefined): string | null {
  return value && UUID.test(value) ? value.toLowerCase() : null;
}

export interface GenerateOptions {
  signal: AbortSignal;
  clientId: string | null;
  /** Epoch ms by which the response must be ready (serverless time limits). */
  deadlineAt?: number;
}

export function createHandlers(config: Config, deps: HandlerDeps) {
  const log = deps.log ?? (() => {});
  const usesDemoByDefault = () => config.demoByDefault || !deps.ai;

  async function health(): Promise<ApiResult<HealthResponse>> {
    const store = deps.store ? ((await deps.store.health()) ? 'connected' : 'unreachable') : 'disabled';
    const demo = usesDemoByDefault();
    return {
      status: 200,
      body: { status: 'ok', mode: demo ? 'demo' : 'ai', model: demo ? null : (deps.ai?.model ?? null), store },
    };
  }

  async function generate(input: unknown, options: GenerateOptions): Promise<ApiResult<GenerateResponse>> {
    const parsed = generateRequestSchema.safeParse(input ?? {});
    if (!parsed.success) {
      return { status: 400, body: errorBody('invalid_brief', 'Please check the highlighted fields.', false, formatIssues(parsed.error)) };
    }
    const request = parsed.data;

    if (request.demo && config.demo === 'off') {
      return { status: 403, body: errorBody('demo_disabled', 'Demo mode is turned off on this server.', false) };
    }
    const wantsDemo = request.demo || usesDemoByDefault();
    const generator: NameGenerator | null = wantsDemo ? (config.demo === 'off' ? null : deps.demo) : deps.ai;
    if (!generator) {
      return { status: 503, body: errorBody('ai_unconfigured', 'AI naming is not configured on this server yet.', false) };
    }

    const started = Date.now();
    let result: GenerateResponse;
    try {
      result = await runGeneration(request, generator, options.signal, { deadlineAt: options.deadlineAt });
    } catch (error) {
      const err = toGenerationError(error);
      if (options.signal.aborted) return { status: 499, body: errorBody('cancelled', 'The request was cancelled.', true) };
      log('generate failed', { code: err.code, detail: err.detail, ms: Date.now() - started });

      // Optional: keep the site useful when the AI is down (no credit, outage) by serving
      // clearly labelled demo names instead of an error.
      const canFallBack = generator === deps.ai && config.demoFallback && config.demo !== 'off';
      if (!canFallBack) return { status: err.status, body: errorBody(err.code, err.message, err.retryable) };
      try {
        result = await runGeneration(request, deps.demo, options.signal);
        result = { ...result, fallback: true };
        log('generate fell back to demo', { code: err.code });
      } catch {
        return { status: err.status, body: errorBody(err.code, err.message, err.retryable) };
      }
    }

    log('generate', {
      mode: result.mode,
      fallback: Boolean(result.fallback),
      type: request.brief.type,
      market: request.brief.market,
      refinements: request.refinements.length,
      returned: result.returned,
      ms: Date.now() - started,
    });
    if (deps.store && options.clientId) {
      deps.store.record(options.clientId, request, result).catch((error: unknown) => {
        log('store.record failed', { error: error instanceof Error ? error.message : String(error) });
      });
    }
    return { status: 200, body: result };
  }

  async function history(clientId: string | null): Promise<ApiResult<HistoryResponse>> {
    if (!deps.store || !clientId) return { status: 200, body: { enabled: Boolean(deps.store), entries: [] } };
    try {
      return { status: 200, body: { enabled: true, entries: await deps.store.history(clientId, 10) } };
    } catch {
      return { status: 503, body: errorBody('store_unavailable', 'Recent briefs are unavailable right now.', true) };
    }
  }

  async function clearHistory(clientId: string | null): Promise<ApiResult<{ deleted: number }>> {
    if (!deps.store || !clientId) return { status: 200, body: { deleted: 0 } };
    try {
      return { status: 200, body: { deleted: await deps.store.clear(clientId) } };
    } catch {
      return { status: 503, body: errorBody('store_unavailable', 'Recent briefs are unavailable right now.', true) };
    }
  }

  return { health, generate, history, clearHistory };
}

export type Handlers = ReturnType<typeof createHandlers>;
