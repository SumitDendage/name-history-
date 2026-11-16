import { describe, expect, it } from 'vitest';
import type { Brief } from '../../shared/brief';
import { checkName, cleanReason, deriveRules, enforceRules, summariseRejections } from '../src/rules';

const brief = (over: Partial<Brief> = {}): Brief => ({
  type: 'business',
  market: 'both',
  style: 'minimal',
  keywords: [],
  ...over,
});

describe('deriveRules', () => {
  it('uses the per-type default max length', () => {
    expect(deriveRules(brief({ type: 'gaming' }), [], []).maxLength).toBe(16);
    expect(deriveRules(brief({ type: 'business' }), [], []).maxLength).toBe(18);
  });

  it('respects the user max length', () => {
    expect(deriveRules(brief({ maxLength: 8 }), [], []).maxLength).toBe(8);
  });

  it('"shorter" tightens relative to previous names but never loosens', () => {
    const rules = deriveRules(brief({ maxLength: 12 }), ['shorter'], ['Lumora', 'Glowly', 'Tarasol']);
    expect(rules.maxLength).toBe(4); // floor(median 6 * 0.8)
    const loose = deriveRules(brief({ maxLength: 5 }), ['shorter'], ['Abcdefghij', 'Abcdefghijk']);
    expect(loose.maxLength).toBe(5);
  });

  it('"no-numbers" disables digits', () => {
    expect(deriveRules(brief(), [], []).allowNumbers).toBe(true);
    expect(deriveRules(brief(), ['no-numbers'], []).allowNumbers).toBe(false);
  });

  it('handles never allow spaces', () => {
    expect(deriveRules(brief({ type: 'social' }), [], []).allowSpaces).toBe(false);
    expect(deriveRules(brief({ type: 'project' }), [], []).allowSpaces).toBe(true);
  });
});

describe('checkName', () => {
  const brand = deriveRules(brief({ maxLength: 10, avoidChars: 'xz' }), [], []);
  const handle = deriveRules(brief({ type: 'social', maxLength: 16 }), ['no-numbers'], []);

  it('accepts good brand names', () => {
    expect(checkName('Lumora', brand, false)).toBeNull();
    expect(checkName('Tara Sol', brand, false)).toBeNull();
    expect(checkName('Glow-Ra', brand, false)).toBeNull();
  });

  it('enforces max length including spaces', () => {
    expect(checkName('Glowing Skin', brand, false)).toBe('too-long');
  });

  it('enforces avoided characters case-insensitively', () => {
    expect(checkName('Zenia', brand, false)).toBe('avoid-chars');
    expect(checkName('Luxa', brand, false)).toBe('avoid-chars');
  });

  it('rejects prohibited characters', () => {
    expect(checkName('Glow!', brand, false)).toBe('characters');
    expect(checkName('Café', brand, false)).toBe('characters');
    expect(checkName('9Lives', brand, false)).toBe('characters');
    expect(checkName('Tara  Sol', brand, false)).toBe('characters');
  });

  it('applies handle rules', () => {
    expect(checkName('the.glowra', handle, true)).toBeNull();
    expect(checkName('glow_ra', handle, true)).toBeNull();
    expect(checkName('glow ra', handle, true)).toBe('spaces');
    expect(checkName('glow..ra', handle, true)).toBe('characters');
    expect(checkName('glowra.', handle, true)).toBe('characters');
    expect(checkName('glowra99', handle, true)).toBe('numbers');
  });
});

describe('enforceRules', () => {
  const rules = deriveRules(brief({ maxLength: 8 }), [], []);

  it('keeps order, drops duplicates, repeats and rule breakers', () => {
    const { accepted, rejected } = enforceRules(
      [
        { name: 'Lumora', reason: 'Soft and bright.' },
        { name: 'lumora', reason: 'Duplicate.' },
        { name: 'Velamorana', reason: 'Too long.' },
        { name: 'Tarasol', reason: 'Star and sun.' },
        { name: 'Nila', reason: 'Already shown.' },
        { name: 'Kavi', reason: '   ' },
      ],
      rules,
      false,
      { exclude: ['NILA'] },
    );
    expect(accepted.map((c) => c.name)).toEqual(['Lumora', 'Tarasol']);
    expect(rejected.map((r) => r.reason)).toEqual(['duplicate', 'too-long', 'repeat', 'reason']);
  });

  it('strips a leading @ from handles', () => {
    const handleRules = deriveRules(brief({ type: 'social' }), [], []);
    const { accepted } = enforceRules([{ name: '@glowra', reason: 'ok' }], handleRules, true, { exclude: [] });
    expect(accepted[0]?.name).toBe('glowra');
  });
});

describe('cleanReason', () => {
  it('collapses to one line and caps length', () => {
    expect(cleanReason('  Two\nlines  here ')).toBe('Two lines here');
    expect(cleanReason('"Wrapped in quotes."')).toBe('Wrapped in quotes.');
    expect(cleanReason('“Lu” from lumi on the ending of Mira.')).toBe('“Lu” from lumi on the ending of Mira.');
    const long = cleanReason('word '.repeat(60));
    expect(long.length).toBeLessThanOrEqual(160);
    expect(long.endsWith('…')).toBe(true);
  });
});

describe('summariseRejections', () => {
  const rules = deriveRules(brief({ maxLength: 8 }), [], []);
  it('explains why fewer than 12 came back', () => {
    const notes = summariseRejections(
      [
        { name: 'a', reason: 'too-long' },
        { name: 'b', reason: 'too-long' },
        { name: 'c', reason: 'avoid-chars' },
      ],
      rules,
      9,
    );
    expect(notes[0]).toContain('Returned 9 of 12');
    expect(notes[0]).toContain('2 longer than 8 characters');
  });
  it('says nothing when the target is met', () => {
    expect(summariseRejections([{ name: 'a', reason: 'too-long' }], rules, 12)).toEqual([]);
  });
});
