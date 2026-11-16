import {
  DEFAULT_MAX_LENGTH,
  HANDLE_TYPES,
  TARGET_COUNT,
  type Brief,
  type EffectiveRules,
  type RefinementId,
} from '../../shared/brief';

export interface Candidate {
  name: string;
  reason: string;
}

export type RejectReason =
  | 'too-long'
  | 'too-short'
  | 'characters'
  | 'spaces'
  | 'numbers'
  | 'avoid-chars'
  | 'duplicate'
  | 'repeat'
  | 'reason';

export interface Rejection {
  name: string;
  reason: RejectReason;
}

export const isHandleType = (type: Brief['type']) => HANDLE_TYPES.includes(type);

/** Lowercase letters and digits only: used to spot duplicates such as "Glow Ra" vs "glowra". */
export const nameKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Turn the brief plus refinements into explicit, checkable rules.
 * Refinements only ever tighten the user's original rules; they never loosen them.
 */
export function deriveRules(brief: Brief, refinements: RefinementId[], previousNames: string[]): EffectiveRules {
  const handle = isHandleType(brief.type);
  const base = brief.maxLength ?? DEFAULT_MAX_LENGTH[brief.type];
  let maxLength = base;

  if (refinements.includes('shorter')) {
    const target = previousNames.length
      ? Math.floor(median(previousNames.map((n) => n.length)) * 0.8)
      : Math.round(base * 0.6);
    maxLength = Math.min(base, Math.max(4, target));
  }

  const allowNumbers = !refinements.includes('no-numbers');
  const allowedCharacters = handle
    ? `letters${allowNumbers ? ', numbers' : ''}, underscores and full stops (no spaces)`
    : `letters${allowNumbers ? ', numbers' : ''}, single spaces and hyphens`;

  return {
    minLength: Math.min(3, maxLength),
    maxLength,
    allowNumbers,
    allowSpaces: !handle,
    allowedCharacters,
    avoidChars: brief.avoidChars ?? '',
  };
}

const HANDLE_PATTERN = /^[A-Za-z][A-Za-z0-9]*(?:[._][A-Za-z0-9]+)*_?$/;
const BRAND_PATTERN = /^[A-Za-z][A-Za-z0-9]*(?:[ -][A-Za-z0-9]+){0,2}$/;

export function normaliseName(raw: string, handle: boolean): string {
  let name = raw.normalize('NFC').replace(/\s+/g, ' ').trim();
  name = name.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '');
  if (handle) name = name.replace(/^@+/, '');
  return name;
}

/** Check one name against the rules. Returns the reason it fails, or null when it passes. */
export function checkName(name: string, rules: EffectiveRules, handle: boolean): RejectReason | null {
  if (name.length < rules.minLength) return 'too-short';
  if (name.length > rules.maxLength) return 'too-long';
  if (handle && /\s/.test(name)) return 'spaces';
  if (!(handle ? HANDLE_PATTERN : BRAND_PATTERN).test(name)) return 'characters';
  if (!rules.allowNumbers && /\d/.test(name)) return 'numbers';
  const lower = name.toLowerCase();
  for (const ch of rules.avoidChars) {
    if (lower.includes(ch)) return 'avoid-chars';
  }
  return null;
}

export function cleanReason(raw: string): string {
  let text = raw.replace(/\s+/g, ' ').trim();
  // Strip quotes only when they wrap the whole reason, not when it merely starts with a quoted word.
  if (/^["“].*["”]$/.test(text) && !/["“”]/.test(text.slice(1, -1))) text = text.slice(1, -1).trim();
  if (text.length <= 160) return text;
  const cut = text.slice(0, 157);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 100 ? cut.lastIndexOf(' ') : 157).replace(/[,;:.\s]+$/, '')}…`;
}

export interface EnforceResult {
  accepted: Candidate[];
  rejected: Rejection[];
}

/**
 * Apply every rule to a candidate list. Order is preserved, so the model's ranking
 * is kept for the names that pass.
 */
export function enforceRules(
  candidates: Candidate[],
  rules: EffectiveRules,
  handle: boolean,
  options: { exclude: string[]; alreadyAccepted?: Candidate[] },
): EnforceResult {
  const excluded = new Set(options.exclude.map(nameKey));
  const seen = new Set((options.alreadyAccepted ?? []).map((c) => nameKey(c.name)));
  const accepted: Candidate[] = [];
  const rejected: Rejection[] = [];

  for (const candidate of candidates) {
    const name = normaliseName(candidate.name ?? '', handle);
    const reason = cleanReason(candidate.reason ?? '');
    const failure = checkName(name, rules, handle);
    if (failure) {
      rejected.push({ name, reason: failure });
      continue;
    }
    const key = nameKey(name);
    if (excluded.has(key)) {
      rejected.push({ name, reason: 'repeat' });
      continue;
    }
    if (seen.has(key)) {
      rejected.push({ name, reason: 'duplicate' });
      continue;
    }
    if (!reason) {
      rejected.push({ name, reason: 'reason' });
      continue;
    }
    seen.add(key);
    accepted.push({ name, reason });
  }

  return { accepted, rejected };
}

const REASON_LABELS: Record<RejectReason, (rules: EffectiveRules) => string> = {
  'too-long': (r) => `longer than ${r.maxLength} characters`,
  'too-short': (r) => `shorter than ${r.minLength} characters`,
  characters: () => 'used characters outside the allowed set',
  spaces: () => 'contained spaces',
  numbers: () => 'contained numbers',
  'avoid-chars': () => 'used a character you asked to avoid',
  duplicate: () => 'duplicated another suggestion',
  repeat: () => "repeated a name you've already seen",
  reason: () => 'came without a reason',
};

export function summariseRejections(rejected: Rejection[], rules: EffectiveRules, returned: number): string[] {
  if (returned >= TARGET_COUNT) return [];
  const counts = new Map<RejectReason, number>();
  for (const r of rejected) counts.set(r.reason, (counts.get(r.reason) ?? 0) + 1);
  const parts = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([reason, n]) => `${n} ${REASON_LABELS[reason](rules)}`);
  const head = `Returned ${returned} of ${TARGET_COUNT}.`;
  if (!parts.length) return [`${head} Not enough distinct names fit this brief. Try loosening a rule.`];
  return [`${head} We removed candidates that broke your rules: ${parts.join(', ')}.`];
}
