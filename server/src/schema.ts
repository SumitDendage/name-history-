import { z } from 'zod';
import {
  LIMITS,
  MARKET_IDS,
  NAMING_TYPE_IDS,
  REFINEMENT_IDS,
  STYLE_IDS,
  type ApiIssue,
  type GenerateRequest,
} from '../../shared/brief';

/** Control characters and angle brackets are never accepted in free text. */
const UNSAFE_TEXT = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F<>]/;

const cleanText = (max: number, label: string) =>
  z
    .string({ error: `${label} must be text.` })
    .transform((s) => s.replace(/\s+/g, ' ').trim())
    .refine((s) => s.length <= max, `${label} must be ${max} characters or fewer.`)
    .refine((s) => !UNSAFE_TEXT.test(s), `${label} contains characters we can't accept (< > or control characters).`);

const keyword = z
  .string()
  .transform((s) => s.replace(/\s+/g, ' ').trim())
  .refine((s) => s.length > 0, 'Keywords cannot be empty.')
  .refine((s) => s.length <= LIMITS.keywordLength, `Each keyword must be ${LIMITS.keywordLength} characters or fewer.`)
  .refine((s) => /^[\p{L}\p{N}][\p{L}\p{N} '&-]*$/u.test(s), 'Keywords can use letters, numbers, spaces, hyphens, apostrophes and &.');

const keywordList = z
  .union([z.array(keyword), z.string()])
  .transform((value, ctx) => {
    const raw = typeof value === 'string' ? value.split(',') : value;
    const list: string[] = [];
    for (const item of raw) {
      const parsed = keyword.safeParse(item);
      if (typeof value === 'string' && item.trim() === '') continue;
      if (!parsed.success) {
        ctx.addIssue({ code: 'custom', message: parsed.error.issues[0]?.message ?? 'Invalid keyword.' });
        return z.NEVER;
      }
      if (!list.some((k) => k.toLowerCase() === parsed.data.toLowerCase())) list.push(parsed.data);
    }
    return list;
  })
  .refine((list) => list.length <= LIMITS.keywords, `Use up to ${LIMITS.keywords} keywords.`);

const avoidChars = z
  .string()
  .transform((s) => Array.from(new Set(Array.from(s.replace(/[\s,]+/g, '').toLowerCase()))).join(''))
  .refine((s) => s.length <= LIMITS.avoidChars, `List up to ${LIMITS.avoidChars} characters to avoid.`)
  .refine((s) => /^[\x21-\x7E]*$/.test(s), 'Characters to avoid must be plain keyboard characters (A–Z, 0–9, symbols).');

const nameLike = z
  .string()
  .transform((s) => s.replace(/\s+/g, ' ').trim())
  .refine((s) => s.length > 0 && s.length <= LIMITS.likeName, `Names must be 1–${LIMITS.likeName} characters.`)
  .refine((s) => /^[A-Za-z0-9 ._'&-]+$/.test(s), 'Names can only use letters, numbers, spaces and . _ - \' &.');

export const briefSchema = z
  .object({
    type: z.enum(NAMING_TYPE_IDS, { error: 'Choose what you are naming.' }),
    nickname: cleanText(LIMITS.nickname, 'Name or nickname').optional().default(''),
    market: z.enum(MARKET_IDS, { error: 'Choose India, International or Both.' }),
    style: z.enum(STYLE_IDS, { error: 'Choose a style.' }),
    keywords: keywordList.optional().default([]),
    requirements: cleanText(LIMITS.requirements, 'Requirements').optional().default(''),
    maxLength: z
      .number({ error: 'Maximum length must be a number.' })
      .int('Maximum length must be a whole number.')
      .min(LIMITS.maxLengthFloor, `Maximum length must be at least ${LIMITS.maxLengthFloor}.`)
      .max(LIMITS.maxLengthCeiling, `Maximum length must be ${LIMITS.maxLengthCeiling} or less.`)
      .optional(),
    avoidChars: avoidChars.optional().default(''),
  })
  .strict();

export const generateRequestSchema = z
  .object({
    brief: briefSchema,
    refinements: z
      .array(z.enum(REFINEMENT_IDS, { error: 'Unknown refinement.' }))
      .max(REFINEMENT_IDS.length)
      .optional()
      .default([])
      .transform((list) => Array.from(new Set(list))),
    likeName: nameLike.optional(),
    exclude: z.array(nameLike).max(LIMITS.exclude, `Send at most ${LIMITS.exclude} names to exclude.`).optional().default([]),
    previous: z.array(nameLike).max(LIMITS.exclude, `Send at most ${LIMITS.exclude} previous names.`).optional(),
    demo: z.boolean().optional().default(false),
  })
  .strict();

export type ParsedGenerateRequest = z.output<typeof generateRequestSchema>;

// Compile-time check that the parsed request still satisfies the shared contract.
const _contract: (r: ParsedGenerateRequest) => GenerateRequest = (r) => r;
void _contract;

export function formatIssues(error: z.ZodError): ApiIssue[] {
  return error.issues.slice(0, 20).map((issue) => ({
    path: issue.path.length ? issue.path.join('.') : 'body',
    message: issue.code === 'unrecognized_keys' ? `Unknown field(s): ${issue.keys.join(', ')}.` : issue.message,
  }));
}
