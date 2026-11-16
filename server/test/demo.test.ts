import { describe, expect, it } from 'vitest';
import { SAMPLE_BRIEF, type Brief, type RefinementId } from '../../shared/brief';
import type { GenerationInput } from '../src/prompt';
import { generateDemoCandidates } from '../src/providers/demo';
import { checkName, deriveRules, isHandleType, nameKey } from '../src/rules';

function input(brief: Brief, refinements: RefinementId[] = [], extra: Partial<GenerationInput> = {}): GenerationInput {
  return {
    brief,
    refinements,
    exclude: [],
    rules: deriveRules(brief, refinements, extra.exclude ?? []),
    count: 20,
    ...extra,
  };
}

describe('demo generator', () => {
  it('returns at least 12 distinct, rule-abiding names for the sample brief', () => {
    const i = input(SAMPLE_BRIEF);
    const names = generateDemoCandidates(i);
    expect(names.length).toBeGreaterThanOrEqual(12);
    expect(new Set(names.map((n) => nameKey(n.name))).size).toBe(names.length);
    for (const n of names) {
      expect(checkName(n.name, i.rules, false)).toBeNull();
      expect(n.reason.length).toBeGreaterThan(10);
    }
  });

  it('is deterministic for the same brief', () => {
    expect(generateDemoCandidates(input(SAMPLE_BRIEF))).toEqual(generateDemoCandidates(input(SAMPLE_BRIEF)));
  });

  it.each(['social', 'gaming', 'personal-brand', 'business', 'creator', 'project'] as const)('works for %s', (type) => {
    const brief: Brief = { type, market: 'india', style: 'bold', keywords: ['tiger', 'storm'], nickname: 'Arjun' };
    const i = input(brief);
    const names = generateDemoCandidates(i);
    expect(names.length).toBeGreaterThanOrEqual(12);
    for (const n of names) expect(checkName(n.name, i.rules, isHandleType(type))).toBeNull();
  });

  it('honours "no numbers" and avoided characters', () => {
    const brief: Brief = { type: 'gaming', market: 'international', style: 'bold', keywords: ['nova'], avoidChars: 'x' };
    const names = generateDemoCandidates(input(brief, ['no-numbers']));
    for (const n of names) {
      expect(n.name).not.toMatch(/\d/);
      expect(n.name.toLowerCase()).not.toContain('x');
    }
  });

  it('"more like this" does not repeat the liked name or excluded names', () => {
    const first = generateDemoCandidates(input(SAMPLE_BRIEF));
    const liked = first[0]!.name;
    const exclude = first.map((n) => n.name);
    const more = generateDemoCandidates(input(SAMPLE_BRIEF, [], { likeName: liked, exclude }));
    const keys = new Set(exclude.map(nameKey));
    for (const n of more) expect(keys.has(nameKey(n.name))).toBe(false);
  });
});
