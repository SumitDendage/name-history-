import { createApp } from './app';
import { loadEnvFiles, readConfig } from './config';
import { AnthropicGenerator } from './providers/anthropic';
import { DemoGenerator } from './providers/demo';
import { StoreClient } from './store';

loadEnvFiles();
const config = readConfig();

const log = (message: string, fields: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ t: new Date().toISOString(), msg: message, ...fields }));

const ai = config.anthropicApiKey
  ? new AnthropicGenerator({
      apiKey: config.anthropicApiKey,
      model: config.model,
      effort: config.effort,
      timeoutMs: config.aiTimeoutMs,
    })
  : null;
const demo = new DemoGenerator(config.demoLatencyMs);
const store = config.storeUrl ? new StoreClient(config.storeUrl, config.storeToken) : null;

const app = createApp(config, { ai, demo, store, log });

const server = app.listen(config.port, config.host, () => {
  const mode = config.demoByDefault || !ai ? 'demo' : `ai (${config.model}, effort ${config.effort})`;
  log('NameForge API listening', {
    url: `http://localhost:${config.port}`,
    mode,
    demoSetting: config.demo,
    store: config.storeUrl ?? 'disabled',
  });
  if (!ai && config.demo !== 'off') log('No ANTHROPIC_API_KEY set: running in demo mode.');
  if (!ai && config.demo === 'off') log('No ANTHROPIC_API_KEY set and DEMO_MODE=off: /api/generate will return 503.');
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    log(`Received ${signal}, shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
