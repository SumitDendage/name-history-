import fs from 'node:fs';
import path from 'node:path';
import express, { type ErrorRequestHandler, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import type { Config } from './config';
import { createHandlers, errorBody, parseClientId, type ApiResult, type HandlerDeps } from './handlers';

export type AppDeps = HandlerDeps;

function send<T>(res: Response, result: ApiResult<T>) {
  res.status(result.status).json(result.body);
}

export function createApp(config: Config, deps: AppDeps) {
  const log = deps.log ?? (() => {});
  const handlers = createHandlers(config, deps);
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

  app.get('/api/health', async (_req, res) => send(res, await handlers.health()));

  const generateLimiter = rateLimit({
    windowMs: 60_000,
    limit: config.rateLimitPerMinute,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, res) =>
      res
        .status(429)
        .json(errorBody('rate_limited', 'You are generating names very quickly. Please wait a minute and try again.', true)),
  });

  app.post('/api/generate', generateLimiter, async (req, res) => {
    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) controller.abort();
    });
    const result = await handlers.generate(req.body, { signal: controller.signal, clientId: parseClientId(req.get('x-client-id')) });
    if (controller.signal.aborted || res.headersSent) return;
    send(res, result);
  });

  app.get('/api/history', async (req, res) => send(res, await handlers.history(parseClientId(req.get('x-client-id')))));
  app.delete('/api/history', async (req, res) => send(res, await handlers.clearHistory(parseClientId(req.get('x-client-id')))));

  app.all('/api/{*rest}', (_req, res) => res.status(404).json(errorBody('not_found', 'That API route does not exist.', false)));

  // In production the API also serves the built React app.
  const indexHtml = path.join(config.clientDist, 'index.html');
  if (fs.existsSync(indexHtml)) {
    app.use(express.static(config.clientDist, { index: false, maxAge: '1h' }));
    app.get('/{*rest}', (_req, res) => res.sendFile(indexHtml));
  }

  const onError: ErrorRequestHandler = (error, _req, res, next) => {
    if (res.headersSent) return next(error);
    const type = (error as { type?: string }).type;
    if (type === 'entity.parse.failed') return void res.status(400).json(errorBody('invalid_json', 'The request body must be valid JSON.', false));
    if (type === 'entity.too.large') return void res.status(413).json(errorBody('too_large', 'That brief is too large.', false));
    log('unhandled error', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json(errorBody('internal', 'Something went wrong on our side. Please try again.', true));
  };
  app.use(onError);

  return app;
}
