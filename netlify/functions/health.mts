import type { Config } from '@netlify/functions';
import { getHandlers, json } from '../lib/runtime';

export default async () => {
  const result = await getHandlers().health();
  return json(result.body, result.status);
};

export const config: Config = { path: '/api/health', method: 'GET' };
