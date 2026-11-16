import type { GenerateResponse, HistoryEntry } from '../../shared/brief';
import type { ParsedGenerateRequest } from './schema';

/**
 * Client for the optional Rust store service (store/). It keeps a per-browser
 * history of briefs in SQLite. Every call is best-effort: if the store is down,
 * naming keeps working and history is simply unavailable.
 */
export class StoreClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string | null,
  ) {}

  private headers(json = false): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    if (json) headers['content-type'] = 'application/json';
    return headers;
  }

  async health(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(1500) });
      return res.ok;
    } catch {
      return false;
    }
  }

  async record(clientId: string, request: ParsedGenerateRequest, result: GenerateResponse): Promise<void> {
    const res = await fetch(`${this.baseUrl}/v1/generations`, {
      method: 'POST',
      headers: this.headers(true),
      signal: AbortSignal.timeout(3000),
      body: JSON.stringify({
        id: result.requestId,
        client_id: clientId,
        mode: result.mode,
        model: result.model,
        brief: request.brief,
        refinements: result.refinements,
        like_name: result.likeName,
        names: result.suggestions.map((s) => ({ name: s.name, reason: s.reason })),
        requested: result.requested,
        returned: result.returned,
      }),
    });
    if (!res.ok) throw new Error(`store responded ${res.status}`);
  }

  async history(clientId: string, limit = 10): Promise<HistoryEntry[]> {
    const url = new URL(`${this.baseUrl}/v1/generations`);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('limit', String(limit));
    const res = await fetch(url, { headers: this.headers(), signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(`store responded ${res.status}`);
    const body = (await res.json()) as { entries: StoreEntry[] };
    return body.entries.map((e) => ({
      id: e.id,
      createdAt: e.created_at,
      mode: e.mode,
      brief: e.brief,
      refinements: e.refinements,
      names: e.names.map((n) => n.name),
    }));
  }

  async clear(clientId: string): Promise<number> {
    const url = new URL(`${this.baseUrl}/v1/generations`);
    url.searchParams.set('client_id', clientId);
    const res = await fetch(url, { method: 'DELETE', headers: this.headers(), signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(`store responded ${res.status}`);
    const body = (await res.json()) as { deleted: number };
    return body.deleted;
  }
}

interface StoreEntry {
  id: string;
  created_at: string;
  mode: 'ai' | 'demo';
  brief: HistoryEntry['brief'];
  refinements: HistoryEntry['refinements'];
  names: { name: string; reason: string }[];
}
