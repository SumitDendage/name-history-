/** localStorage can throw (private mode, blocked storage). Every access goes through here. */
export function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

let sessionClientId: string | null = null;

/** Anonymous per-browser id, used only to scope "Recent briefs" in the optional store. */
export function getClientId(): string {
  const key = 'nameforge.clientId';
  try {
    const existing = window.localStorage.getItem(key);
    if (existing) return existing;
    const id = crypto.randomUUID();
    window.localStorage.setItem(key, id);
    return id;
  } catch {
    sessionClientId ??= crypto.randomUUID();
    return sessionClientId;
  }
}
