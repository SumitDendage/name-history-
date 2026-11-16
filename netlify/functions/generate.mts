import type { Config } from '@netlify/functions';
import { errorBody, parseClientId } from '../../server/src/handlers';
import { getHandlers, json } from '../lib/runtime';

/** Synchronous functions stop at 60 s; answer comfortably before that. */
const BUDGET_MS = 55_000;
const MAX_BODY = 16 * 1024;

export default async (req: Request) => {
  const started = Date.now();
  const text = await req.text();
  if (text.length > MAX_BODY) return json(errorBody('too_large', 'That brief is too large.', false), 413);

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json(errorBody('invalid_json', 'The request body must be valid JSON.', false), 400);
  }

  const result = await getHandlers().generate(body, {
    signal: req.signal,
    clientId: parseClientId(req.headers.get('x-client-id')),
    deadlineAt: started + BUDGET_MS,
  });
  return json(result.body, result.status);
};

export const config: Config = {
  path: '/api/generate',
  method: 'POST',
  // Per-IP limit enforced by Netlify before the function runs.
  rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
