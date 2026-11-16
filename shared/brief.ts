/**
 * The brief contract shared by the React client and the Express API.
 * Keep this file dependency-free: it is imported from both sides.
 */

export const NAMING_TYPES = [
  { id: 'social', label: 'Social media account', short: 'Social', hint: 'Handles for Instagram, X, Threads, YouTube' },
  { id: 'gaming', label: 'Gaming profile', short: 'Gaming', hint: 'Gamertags for Steam, Discord, BGMI, Xbox' },
  { id: 'personal-brand', label: 'Personal brand', short: 'Personal brand', hint: 'A name people remember you by' },
  { id: 'business', label: 'Business', short: 'Business', hint: 'Companies, shops, products, D2C brands' },
  { id: 'creator', label: 'Creator channel', short: 'Creator', hint: 'YouTube, podcasts, newsletters, streams' },
  { id: 'project', label: 'Project', short: 'Project', hint: 'Apps, open source, events, side projects' },
] as const;

export const MARKETS = [
  { id: 'india', label: 'India', hint: 'Easy across Indian languages and accents' },
  { id: 'international', label: 'International', hint: 'Travels cleanly across languages' },
  { id: 'both', label: 'Both', hint: 'Works at home in India and abroad' },
] as const;

export const STYLES = [
  { id: 'modern', label: 'Modern', hint: 'Clean, current, techy' },
  { id: 'premium', label: 'Premium', hint: 'Refined, quiet luxury' },
  { id: 'playful', label: 'Playful', hint: 'Warm, bouncy, friendly' },
  { id: 'bold', label: 'Bold', hint: 'Punchy, loud, confident' },
  { id: 'minimal', label: 'Minimal', hint: 'Short, spare, essential' },
] as const;

export const REFINEMENTS = [
  { id: 'shorter', label: 'Shorter' },
  { id: 'easier', label: 'Easier to pronounce' },
  { id: 'premium', label: 'More premium' },
  { id: 'no-numbers', label: 'No numbers' },
] as const;

export type NamingType = (typeof NAMING_TYPES)[number]['id'];
export type Market = (typeof MARKETS)[number]['id'];
export type Style = (typeof STYLES)[number]['id'];
export type RefinementId = (typeof REFINEMENTS)[number]['id'];

export const NAMING_TYPE_IDS = NAMING_TYPES.map((t) => t.id) as [NamingType, ...NamingType[]];
export const MARKET_IDS = MARKETS.map((m) => m.id) as [Market, ...Market[]];
export const STYLE_IDS = STYLES.map((s) => s.id) as [Style, ...Style[]];
export const REFINEMENT_IDS = REFINEMENTS.map((r) => r.id) as [RefinementId, ...RefinementId[]];

/** How many suggestions we aim for. The API may return fewer when rules filter some out. */
export const TARGET_COUNT = 12;

export const LIMITS = {
  nickname: 40,
  keywords: 8,
  keywordLength: 24,
  requirements: 600,
  minLength: 3,
  maxLengthFloor: 3,
  maxLengthCeiling: 30,
  avoidChars: 20,
  exclude: 120,
  likeName: 40,
} as const;

/** Handle-style names (no spaces) vs. brand-style names (spaces allowed). */
export const HANDLE_TYPES: readonly NamingType[] = ['social', 'gaming'];

export const DEFAULT_MAX_LENGTH: Record<NamingType, number> = {
  social: 20,
  gaming: 16,
  'personal-brand': 24,
  business: 18,
  creator: 22,
  project: 20,
};

export interface Brief {
  type: NamingType;
  nickname?: string;
  market: Market;
  style: Style;
  keywords: string[];
  requirements?: string;
  /** Hard maximum, counted in characters including spaces. */
  maxLength?: number;
  /** Characters that must not appear, e.g. "xz_". Case-insensitive for letters. */
  avoidChars?: string;
}

export interface GenerateRequest {
  brief: Brief;
  refinements?: RefinementId[];
  /** "More like this": a name the user wants variations of. */
  likeName?: string;
  /** Names already shown; the API will not repeat them. */
  exclude?: string[];
  /** The round being refined. "Shorter" is measured against these names (defaults to `exclude`). */
  previous?: string[];
  /** Force the local demo generator even when an AI key is configured. */
  demo?: boolean;
}

export type Availability = 'unchecked';

export interface Suggestion {
  id: string;
  name: string;
  reason: string;
  length: number;
  availability: { username: Availability; domain: Availability };
}

export interface EffectiveRules {
  minLength: number;
  maxLength: number;
  allowNumbers: boolean;
  allowSpaces: boolean;
  /** Human-readable summary of the allowed character set. */
  allowedCharacters: string;
  avoidChars: string;
}

export interface GenerateResponse {
  requestId: string;
  mode: 'ai' | 'demo';
  model: string | null;
  requested: number;
  returned: number;
  suggestions: Suggestion[];
  rules: EffectiveRules;
  refinements: RefinementId[];
  likeName: string | null;
  notes: string[];
  createdAt: string;
  /** True when the AI failed and the server served demo names instead (DEMO_FALLBACK=on). */
  fallback?: boolean;
}

export interface ApiIssue {
  path: string;
  message: string;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    retryable: boolean;
    issues?: ApiIssue[];
  };
}

export interface HealthResponse {
  status: 'ok';
  mode: 'ai' | 'demo';
  model: string | null;
  store: 'connected' | 'unreachable' | 'disabled';
}

export interface HistoryEntry {
  id: string;
  createdAt: string;
  mode: 'ai' | 'demo';
  brief: Brief;
  refinements: RefinementId[];
  names: string[];
}

export interface HistoryResponse {
  enabled: boolean;
  entries: HistoryEntry[];
}

export const SAMPLE_BRIEF: Brief = {
  type: 'business',
  nickname: '',
  market: 'both',
  style: 'minimal',
  keywords: ['skincare', 'glow', 'gentle'],
  requirements:
    "I'm launching a skincare brand for customers in India and abroad. Suggest short names that are easy to pronounce and spell.",
  maxLength: 10,
  avoidChars: '',
};
