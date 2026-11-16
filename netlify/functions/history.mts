import type { Config } from '@netlify/functions';
import { parseClientId } from '../../server/src/handlers';
import { getHandlers, json } from '../lib/runtime';

/** Recent briefs need the Rust store (STORE_URL). Without it this reports `enabled: false`. */
export default async (req: Request) => {
  const clientId = parseClientId(req.headers.get('x-client-id'));
  const result = req.method === 'DELETE' ? await getHandlers().clearHistory(clientId) : await getHandlers().history(clientId);
  return json(result.body, result.status);
};

export const config: Config = { path: '/api/history', method: ['GET', 'DELETE'] };
