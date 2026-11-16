import {
  DEFAULT_MAX_LENGTH,
  LIMITS,
  type ApiIssue,
  type Brief,
  type Market,
  type NamingType,
  type Style,
} from '../../../shared/brief';

/** Raw form values. Text inputs stay as strings until submit. */
export interface FormValues {
  type: NamingType | null;
  nickname: string;
  market: Market;
  style: Style | null;
  keywords: string;
  requirements: string;
  maxLength: string;
  avoidChars: string;
}

export type FieldName = keyof FormValues;
export type FieldErrors = Partial<Record<FieldName, string>>;

export const EMPTY_FORM: FormValues = {
  type: null,
  nickname: '',
  market: 'both',
  style: null,
  keywords: '',
  requirements: '',
  maxLength: '',
  avoidChars: '',
};

export function parseKeywords(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(',')) {
    const k = raw.replace(/\s+/g, ' ').trim();
    if (k && !out.some((o) => o.toLowerCase() === k.toLowerCase())) out.push(k);
  }
  return out;
}

const KEYWORD = /^[\p{L}\p{N}][\p{L}\p{N} '&-]*$/u;

export function validateForm(values: FormValues): { brief: Brief | null; errors: FieldErrors } {
  const errors: FieldErrors = {};
  if (!values.type) errors.type = "Choose what you're naming.";
  if (!values.style) errors.style = 'Choose a style.';
  if (values.nickname.trim().length > LIMITS.nickname) errors.nickname = `Keep it to ${LIMITS.nickname} characters.`;
  if (/[<>]/.test(values.nickname)) errors.nickname = 'Please remove < and >.';

  const keywords = parseKeywords(values.keywords);
  if (keywords.length > LIMITS.keywords) errors.keywords = `Use up to ${LIMITS.keywords} keywords.`;
  else if (keywords.some((k) => k.length > LIMITS.keywordLength)) errors.keywords = `Each keyword must be ${LIMITS.keywordLength} characters or fewer.`;
  else if (keywords.some((k) => !KEYWORD.test(k))) errors.keywords = 'Keywords can use letters, numbers, spaces, hyphens, apostrophes and &.';

  const requirements = values.requirements.replace(/\s+/g, ' ').trim();
  if (requirements.length > LIMITS.requirements) errors.requirements = `Keep requirements to ${LIMITS.requirements} characters.`;
  if (/[<>]/.test(requirements)) errors.requirements = 'Please remove < and >.';

  let maxLength: number | undefined;
  if (values.maxLength.trim()) {
    const n = Number(values.maxLength);
    if (!Number.isInteger(n) || n < LIMITS.maxLengthFloor || n > LIMITS.maxLengthCeiling) {
      errors.maxLength = `Enter a whole number from ${LIMITS.maxLengthFloor} to ${LIMITS.maxLengthCeiling}.`;
    } else maxLength = n;
  }

  const avoid = Array.from(new Set(Array.from(values.avoidChars.replace(/[\s,]+/g, '').toLowerCase()))).join('');
  if (avoid.length > LIMITS.avoidChars) errors.avoidChars = `List up to ${LIMITS.avoidChars} characters.`;
  else if (!/^[\x21-\x7E]*$/.test(avoid)) errors.avoidChars = 'Use plain keyboard characters (A–Z, 0–9, symbols).';

  if (Object.keys(errors).length || !values.type || !values.style) return { brief: null, errors };

  return {
    brief: {
      type: values.type,
      nickname: values.nickname.trim(),
      market: values.market,
      style: values.style,
      keywords,
      requirements,
      ...(maxLength ? { maxLength } : {}),
      avoidChars: avoid,
    },
    errors,
  };
}

export function briefToForm(brief: Brief): FormValues {
  return {
    type: brief.type,
    nickname: brief.nickname ?? '',
    market: brief.market,
    style: brief.style,
    keywords: brief.keywords.join(', '),
    requirements: brief.requirements ?? '',
    maxLength: brief.maxLength ? String(brief.maxLength) : '',
    avoidChars: brief.avoidChars ?? '',
  };
}

/** Map server issue paths such as "brief.keywords" onto form fields. */
export function issuesToErrors(issues: ApiIssue[]): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of issues) {
    const field = issue.path.replace(/^brief\./, '').split('.')[0] as FieldName;
    if (field in EMPTY_FORM && !errors[field]) errors[field] = issue.message;
  }
  return errors;
}

export const defaultMaxFor = (type: NamingType | null) => (type ? DEFAULT_MAX_LENGTH[type] : null);
