import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { SAMPLE_BRIEF } from '../../shared/brief';
import { createApp } from '../src/app';
import { readConfig } from '../src/config';
import type { GenerationInput } from '../src/prompt';
import { DemoGenerator } from '../src/providers/demo';
import { GenerationError, type NameGenerator } from '../src/providers/types';
import type { Candidate } from '../src/rules';

class FakeAi implements NameGenerator {
  readonly mode = 'ai' as const;
  readonly model = 'test-model';
  calls: GenerationInput[] = [];
  constructor(private readonly rounds: (Candidate[] | Error)[]) {}
  async generate(input: GenerationInput): Promise<Candidate[]> {
    this.calls.push(input);
    const next = this.rounds.shift() ?? [];
    if (next instanceof Error) throw next;
    return next;
  }
}

const names = (list: string[]) => list.map((name) => ({ name, reason: `Because ${name} fits.` }));
const TWELVE = ['Lumora', 'Tarasol', 'Nilaa', 'Vedalu', 'Kavira', 'Halora', 'Rasena', 'Oraly', 'Mirava', 'Solene', 'Lumiva', 'Taveda'];

function setup(ai: NameGenerator | null, env: Record<string, string> = {}) {
  const config = readConfig({ DEMO_MODE: 'auto', CLIENT_DIST: '/nonexistent', ...env } as NodeJS.ProcessEnv);
  if (ai) config.demoByDefault = env.DEMO_MODE === 'on';
  return createApp(config, { ai, demo: new DemoGenerator(0), store: null });
}

describe('POST /api/generate', () => {
  it('rejects an invalid brief with field-level issues', async () => {
    const res = await request(setup(null))
      .post('/api/generate')
      .send({ brief: { type: 'spaceship', market: 'mars', style: 'modern', maxLength: 99 } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_brief');
    const paths = res.body.error.issues.map((i: { path: string }) => i.path);
    expect(paths).toEqual(expect.arrayContaining(['brief.type', 'brief.market', 'brief.maxLength']));
  });

  it('rejects unknown fields and unsafe text', async () => {
    const res = await request(setup(null))
      .post('/api/generate')
      .send({ brief: { ...SAMPLE_BRIEF, requirements: '<script>alert(1)</script>' }, extra: true });
    expect(res.status).toBe(400);
    expect(res.body.error.issues.length).toBeGreaterThanOrEqual(2);
  });

  it('rejects malformed JSON', async () => {
    const res = await request(setup(null)).post('/api/generate').set('content-type', 'application/json').send('{"brief":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_json');
  });

  it('uses demo mode when no AI key is configured, and labels it', async () => {
    const res = await request(setup(null)).post('/api/generate').send({ brief: SAMPLE_BRIEF });
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('demo');
    expect(res.body.model).toBeNull();
    expect(res.body.returned).toBe(12);
    for (const s of res.body.suggestions) {
      expect(s.name.length).toBeLessThanOrEqual(10);
      expect(s.availability).toEqual({ username: 'unchecked', domain: 'unchecked' });
    }
  });

  it('returns AI suggestions in order after enforcing rules', async () => {
    const ai = new FakeAi([names([...TWELVE, 'WayTooLongName', 'Glow!', 'lumora'])]);
    const res = await request(setup(ai)).post('/api/generate').send({ brief: SAMPLE_BRIEF });
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('ai');
    expect(res.body.suggestions.map((s: { name: string }) => s.name)).toEqual(TWELVE);
    expect(ai.calls).toHaveLength(1);
    expect(ai.calls[0]!.rules.maxLength).toBe(10);
  });

  it('tops up once, then returns fewer than 12 with a note when rules filter too many', async () => {
    const ai = new FakeAi([
      names(['Lumora', 'Tarasol', 'Velamoranas', 'Zenith', 'Nilaa']),
      names(['Kavira', 'Excessivelylong', 'Lumora']),
    ]);
    const res = await request(setup(ai))
      .post('/api/generate')
      .send({ brief: { ...SAMPLE_BRIEF, avoidChars: 'z' } });
    expect(res.status).toBe(200);
    expect(ai.calls).toHaveLength(2);
    expect(ai.calls[1]!.exclude).toEqual(expect.arrayContaining(['Lumora', 'Velamoranas', 'Zenith']));
    expect(res.body.returned).toBe(4);
    expect(res.body.notes.join(' ')).toMatch(/Returned 4 of 12/);
  });

  it('keeps the original brief and tightens rules when refining', async () => {
    const ai = new FakeAi([names(TWELVE.map((n) => n.slice(0, 5)))]);
    const res = await request(setup(ai))
      .post('/api/generate')
      .send({ brief: SAMPLE_BRIEF, refinements: ['shorter', 'no-numbers', 'shorter'], exclude: TWELVE });
    expect(res.status).toBe(200);
    expect(res.body.refinements).toEqual(['shorter', 'no-numbers']);
    const call = ai.calls[0]!;
    expect(call.brief.requirements).toBe(SAMPLE_BRIEF.requirements);
    expect(call.rules.maxLength).toBeLessThan(10);
    expect(call.rules.allowNumbers).toBe(false);
    expect(call.exclude).toEqual(TWELVE);
  });

  it('measures "shorter" against `previous` when it is sent', async () => {
    const ai = new FakeAi([names(['Lumi', 'Tara', 'Nila', 'Veda'])]);
    const res = await request(setup(ai))
      .post('/api/generate')
      .send({ brief: SAMPLE_BRIEF, refinements: ['shorter'], previous: ['Lumora', 'Tarasol', 'Nilaa'], exclude: ['Velamorana', 'Glowarious', 'Skintarana'] });
    expect(res.status).toBe(200);
    expect(ai.calls[0]!.rules.maxLength).toBe(4); // floor(0.8 x median 6 of previous), not of exclude
  });

  it('passes "more like this" through and never returns the liked name', async () => {
    const ai = new FakeAi([names(['Lumora', ...TWELVE.slice(1)])]);
    const res = await request(setup(ai)).post('/api/generate').send({ brief: SAMPLE_BRIEF, likeName: 'Lumora' });
    expect(res.body.likeName).toBe('Lumora');
    expect(res.body.suggestions.map((s: { name: string }) => s.name)).not.toContain('Lumora');
    expect(ai.calls[0]!.likeName).toBe('Lumora');
  });

  it('maps provider failures to retryable errors', async () => {
    const ai = new FakeAi([new GenerationError(503, 'ai_busy', 'Busy.', true)]);
    const res = await request(setup(ai)).post('/api/generate').send({ brief: SAMPLE_BRIEF });
    expect(res.status).toBe(503);
    expect(res.body.error).toEqual({ code: 'ai_busy', message: 'Busy.', retryable: true });
  });

  it('lets the client force demo mode', async () => {
    const ai = new FakeAi([]);
    const res = await request(setup(ai)).post('/api/generate').send({ brief: SAMPLE_BRIEF, demo: true });
    expect(res.body.mode).toBe('demo');
    expect(ai.calls).toHaveLength(0);
  });

  it('returns 503 when demo is off and no key is set', async () => {
    const res = await request(setup(null, { DEMO_MODE: 'off' })).post('/api/generate').send({ brief: SAMPLE_BRIEF });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('ai_unconfigured');
  });

  it('rate limits bursts', async () => {
    const app = setup(null, { RATE_LIMIT_PER_MINUTE: '2' });
    await request(app).post('/api/generate').send({ brief: SAMPLE_BRIEF });
    await request(app).post('/api/generate').send({ brief: SAMPLE_BRIEF });
    const res = await request(app).post('/api/generate').send({ brief: SAMPLE_BRIEF });
    expect(res.status).toBe(429);
    expect(res.body.error.retryable).toBe(true);
  });
});

describe('other routes', () => {
  it('reports health and demo mode', async () => {
    const res = await request(setup(null)).get('/api/health');
    expect(res.body).toEqual({ status: 'ok', mode: 'demo', model: null, store: 'disabled' });
  });

  it('returns disabled history without a store', async () => {
    const res = await request(setup(null)).get('/api/history');
    expect(res.body).toEqual({ enabled: false, entries: [] });
  });

  it('records generations to the store when a client id is sent', async () => {
    const record = vi.fn().mockResolvedValue(undefined);
    const config = readConfig({ CLIENT_DIST: '/nonexistent' } as NodeJS.ProcessEnv);
    const store = { record, health: vi.fn(), history: vi.fn(), clear: vi.fn() };
    const app = createApp(config, { ai: null, demo: new DemoGenerator(0), store: store as never });
    await request(app)
      .post('/api/generate')
      .set('x-client-id', '3f1c2a5e-8b7d-4c1e-9a2b-1234567890ab')
      .send({ brief: SAMPLE_BRIEF });
    expect(record).toHaveBeenCalledOnce();
    expect(record.mock.calls[0]![0]).toBe('3f1c2a5e-8b7d-4c1e-9a2b-1234567890ab');
  });

  it('returns JSON 404 for unknown API routes', async () => {
    const res = await request(setup(null)).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });
});
