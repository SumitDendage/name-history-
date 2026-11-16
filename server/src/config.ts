import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Load `.env` from the repo root and from server/, without overriding real env vars. */
export function loadEnvFiles(): void {
  const candidates = [path.resolve(process.cwd(), '.env'), path.resolve(here, '../../.env'), path.resolve(here, '../.env')];
  const seen = new Set<string>();
  for (const file of candidates) {
    if (seen.has(file)) continue;
    seen.add(file);
    try {
      process.loadEnvFile(file);
    } catch {
      // Missing .env files are fine: every setting has a default.
    }
  }
}

export type DemoSetting = 'auto' | 'on' | 'off';
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface Config {
  port: number;
  host: string;
  anthropicApiKey: string | null;
  model: string;
  effort: Effort;
  demo: DemoSetting;
  demoLatencyMs: number;
  aiTimeoutMs: number;
  rateLimitPerMinute: number;
  trustProxy: string | number | boolean;
  corsOrigin: string | null;
  storeUrl: string | null;
  storeToken: string | null;
  clientDist: string;
  /** True when /api/generate will use the local demo generator by default. */
  demoByDefault: boolean;
}

function int(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function trustProxy(value: string | undefined): string | number | boolean {
  if (!value) return false;
  if (value === 'true') return true;
  if (value === 'false') return false;
  const n = Number(value);
  return Number.isInteger(n) ? n : value;
}

const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const key = env.ANTHROPIC_API_KEY?.trim() || null;
  const demoRaw = (env.DEMO_MODE ?? 'auto').trim().toLowerCase();
  const demo: DemoSetting = demoRaw === 'on' || demoRaw === 'off' ? demoRaw : 'auto';
  const effortRaw = (env.ANTHROPIC_EFFORT ?? 'low').trim().toLowerCase() as Effort;

  return {
    port: int(env.PORT, 8787, 1, 65535),
    host: env.HOST?.trim() || '0.0.0.0',
    anthropicApiKey: key,
    model: env.ANTHROPIC_MODEL?.trim() || 'claude-opus-5-5',
    effort: EFFORTS.includes(effortRaw) ? effortRaw : 'low',
    demo,
    demoLatencyMs: int(env.DEMO_LATENCY_MS, 1200, 0, 10_000),
    aiTimeoutMs: int(env.AI_TIMEOUT_MS, 60_000, 5_000, 300_000),
    rateLimitPerMinute: int(env.RATE_LIMIT_PER_MINUTE, 20, 1, 10_000),
    trustProxy: trustProxy(env.TRUST_PROXY),
    corsOrigin: env.CORS_ORIGIN?.trim() || null,
    storeUrl: env.STORE_URL?.trim().replace(/\/+$/, '') || null,
    storeToken: env.STORE_TOKEN?.trim() || null,
    clientDist: env.CLIENT_DIST?.trim() || path.resolve(here, '../../client/dist'),
    demoByDefault: demo === 'on' || (demo === 'auto' && !key),
  };
}
