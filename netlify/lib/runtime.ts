import { readConfig } from '../../server/src/config';
import { createHandlers, type Handlers } from '../../server/src/handlers';
import { AnthropicGenerator } from '../../server/src/providers/anthropic';
import { DemoGenerator } from '../../server/src/providers/demo';
import { StoreClient } from '../../server/src/store';

/**
 * Shared set-up for the Netlify Functions. Built once per warm instance.
 * Configuration comes from the site's environment variables (Functions scope),
 * exactly as for the Express server; see .env.example.
 */
let handlers: Handlers | null = null;

const log = (message: string, fields: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ t: new Date().toISOString(), msg: message, ...fields }));

export function getHandlers(): Handlers {
  if (handlers) return handlers;
  const config = readConfig(process.env);
  const ai = config.anthropicApiKey
    ? new AnthropicGenerator({ apiKey: config.anthropicApiKey, model: config.model, effort: config.effort, timeoutMs: config.aiTimeoutMs })
    : null;
  const store = config.storeUrl ? new StoreClient(config.storeUrl, config.storeToken) : null;
  handlers = createHandlers(config, { ai, demo: new DemoGenerator(config.demoLatencyMs), store, log });
  return handlers;
}

/** Function responses don't get netlify.toml headers, so set the safe defaults here. */
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    },
  });
}
