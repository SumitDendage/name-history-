import fs from 'node:fs';
import path from 'node:path';
import express, { type ErrorRequestHandler, type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import type { ApiErrorBody, HealthResponse, HistoryResponse } from '../../shared/brief';
import type { Config } from './config';
import type { NameGenerator } from './providers/types';
import { formatIssues, generateRequestSchema } from './schema';
import { runGeneration, toGenerationError } from './service';
import type { StoreClient } from './store';

export interface AppDeps {
  ai: NameGenerator | null;
  demo: NameGenerator;
  store: StoreClient | null;
  log?: (message: string, fields?: Record<string, unknown>) => void;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function sendError(res: Response, status: number, code: string, message: string, retryable: boolean, extra?: Partial<ApiErrorBody['error']>) {
  const body: ApiErrorBody = { error: { code, message, retryable, ...extra } };
  res.status(status).json(body);
}

function clientIdOf(req: Request): string | null {
  const id = req.get('x-client-id');
  return id && UUID.test(id) ? id.toLowerCase() : null;
}

export function createApp(config: Config, deps: AppDeps) {
  const log = deps.log ?? (() => {});
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          fontSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          // Leave HTTPS upgrades to the TLS proxy, so plain-HTTP LAN testing (e.g. on a phone) still works.
          upgradeInsecureRequests: null,
        },
      },
    }),
  );

  if (config.corsOrigin) {
    const origin = config.corsOrigin;
    app.use('/api', (req, res, next) => {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Client-Id');
      if (req.method === 'OPTIONS') return void res.sendStatus(204);
      next();
    });
  }

  app.use('/api', express.json({ limit: '16kb' }));

  const usesDemoByDefault = () => config.demoByDefault || !deps.ai;

  app.get('/api/health', async (_req, res) => {
    const store = deps.store ? ((await deps.store.health()) ? 'connected' : 'unreachable') : 'disabled';
    const demo = usesDemoByDefault();
    const body: HealthResponse = {
      status: 'ok',
      mode: demo ? 'demo' : 'ai',
      model: demo ? null : (deps.ai?.model ?? null),
      store,
    };
    res.json(body);
  });

  const generateLimiter = rateLimit({
    windowMs: 60_000,
    limit: config.rateLimitPerMinute,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, res) =>
      sendError(res, 429, 'rate_limited', 'You are generating names very quickly. Please wait a minute and try again.', true),
  });

  app.post('/api/generate', generateLimiter, async (req, res) => {
    const parsed = generateRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return sendError(res, 400, 'invalid_brief', 'Please check the highlighted fields.', false, {
        issues: formatIssues(parsed.error),
      });
    }
    const request = parsed.data;

    if (request.demo && config.demo === 'off') {
      return sendError(res, 403, 'demo_disabled', 'Demo mode is turned off on this server.', false);
    }
    const wantsDemo = request.demo || usesDemoByDefault();
    const generator: NameGenerator | null = wantsDemo ? (config.demo === 'off' ? null : deps.demo) : deps.ai;
    if (!generator) {
      return sendError(res, 503, 'ai_unconfigured', 'AI naming is not configured on this server yet.', false);
    }

    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) controller.abort();
    });

    const started = Date.now();
    try {
      const result = await runGeneration(request, generator, controller.signal);
      res.json(result);
      log('generate', {
        mode: result.mode,
        type: request.brief.type,
        market: request.brief.market,
        refinements: request.refinements.length,
        returned: result.returned,
        ms: Date.now() - started,
      });
      const clientId = clientIdOf(req);
      if (deps.store && clientId) {
        deps.store.record(clientId, request, result).catch((error: unknown) => {
          log('store.record failed', { error: error instanceof Error ? error.message : String(error) });
        });
      }
    } catch (error) {
      const err = toGenerationError(error);
      if (controller.signal.aborted || res.headersSent) return;
      log('generate failed', { code: err.code, detail: err.detail, ms: Date.now() - started });
      sendError(res, err.status, err.code, err.message, err.retryable);
    }
  });

  app.get('/api/history', async (req, res) => {
    const clientId = clientIdOf(req);
    if (!deps.store || !clientId) {
      const body: HistoryResponse = { enabled: Boolean(deps.store), entries: [] };
      return res.json(body);
    }
    try {
      const entries = await deps.store.history(clientId, 10);
      const body: HistoryResponse = { enabled: true, entries };
      res.json(body);
    } catch {
      sendError(res, 503, 'store_unavailable', 'Recent briefs are unavailable right now.', true);
    }
  });

  app.delete('/api/history', async (req, res) => {
    const clientId = clientIdOf(req);
    if (!deps.store || !clientId) return res.json({ deleted: 0 });
    try {
      res.json({ deleted: await deps.store.clear(clientId) });
    } catch {
      sendError(res, 503, 'store_unavailable', 'Recent briefs are unavailable right now.', true);
    }
  });

  app.all('/api/{*rest}', (_req, res) => sendError(res, 404, 'not_found', 'That API route does not exist.', false));

  // In production the API also serves the built React app.
  const indexHtml = path.join(config.clientDist, 'index.html');
  if (fs.existsSync(indexHtml)) {
    app.use(express.static(config.clientDist, { index: false, maxAge: '1h' }));
    app.get('/{*rest}', (_req, res) => res.sendFile(indexHtml));
  }

  const onError: ErrorRequestHandler = (error, _req, res, next) => {
    if (res.headersSent) return next(error);
    const type = (error as { type?: string }).type;
    if (type === 'entity.parse.failed') return sendError(res, 400, 'invalid_json', 'The request body must be valid JSON.', false);
    if (type === 'entity.too.large') return sendError(res, 413, 'too_large', 'That brief is too large.', false);
    log('unhandled error', { error: error instanceof Error ? error.message : String(error) });
    sendError(res, 500, 'internal', 'Something went wrong on our side. Please try again.', true);
  };
  app.use(onError);

  return app;
}
