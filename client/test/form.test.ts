import { describe, expect, it } from 'vitest';
import { SAMPLE_BRIEF } from '../../shared/brief';
import { briefToForm, EMPTY_FORM, issuesToErrors, parseKeywords, validateForm } from '../src/lib/form';
import { edgesFor, formation, orbitPoint, pickLetters, scatter, seeded } from '../src/lib/formations';

describe('form', () => {
  it('requires a naming type and a style', () => {
    const { brief, errors } = validateForm(EMPTY_FORM);
    expect(brief).toBeNull();
    expect(errors.type).toBeTruthy();
    expect(errors.style).toBeTruthy();
  });

  it('round-trips the sample brief', () => {
    const { brief, errors } = validateForm(briefToForm(SAMPLE_BRIEF));
    expect(errors).toEqual({});
    expect(brief).toEqual(SAMPLE_BRIEF);
  });

  it('parses and de-duplicates keywords', () => {
    expect(parseKeywords(' glow, Glow ,  gentle ritual,, ')).toEqual(['glow', 'gentle ritual']);
  });

  it('validates max length and avoided characters', () => {
    const base = { ...briefToForm(SAMPLE_BRIEF) };
    expect(validateForm({ ...base, maxLength: '2' }).errors.maxLength).toBeTruthy();
    expect(validateForm({ ...base, maxLength: '31' }).errors.maxLength).toBeTruthy();
    expect(validateForm({ ...base, avoidChars: 'x, z, x' }).brief?.avoidChars).toBe('xz');
    expect(validateForm({ ...base, avoidChars: 'é' }).errors.avoidChars).toBeTruthy();
  });

  it('maps server issues onto fields', () => {
    expect(issuesToErrors([{ path: 'brief.keywords', message: 'Too many' }, { path: 'refinements.0', message: 'x' }])).toEqual({
      keywords: 'Too many',
    });
  });
});

describe('formations', () => {
  const base = scatter(30, seeded(3));

  it('scatters points inside the safe area', () => {
    for (const p of base) {
      expect(p.x).toBeGreaterThanOrEqual(0.08);
      expect(p.x).toBeLessThanOrEqual(0.92);
    }
  });

  it.each(['idle', 'modern', 'premium', 'playful', 'bold', 'minimal'] as const)('%s keeps every glyph in view', (key) => {
    const poses = formation(key, base);
    expect(poses).toHaveLength(30);
    for (const p of poses) {
      expect(p.x).toBeGreaterThan(-0.05);
      expect(p.x).toBeLessThan(1.05);
      expect(p.y).toBeGreaterThan(-0.05);
      expect(p.y).toBeLessThan(1.05);
      expect(p.o).toBeGreaterThan(0);
    }
  });

  it('style formations differ from idle but only subtly move letters', () => {
    const idle = formation('idle', base);
    const modern = formation('modern', base);
    const moved = modern.filter((p, i) => Math.hypot(p.x - idle[i]!.x, p.y - idle[i]!.y) > 0.01).length;
    expect(moved).toBeGreaterThan(10);
  });

  it('builds a ring of edges for the orbit', () => {
    expect(edgesFor('orbit', base, 1)).toHaveLength(30);
    expect(edgesFor('modern', formation('modern', base), 1.2).length).toBeGreaterThan(10);
  });

  it('puts orbit points inside the field', () => {
    for (let i = 0; i < 30; i++) {
      const p = orbitPoint(i, 30, 0.3, 600, 500);
      expect(p.x).toBeGreaterThan(0);
      expect(p.x).toBeLessThan(600);
      expect(p.y).toBeGreaterThan(0);
      expect(p.y).toBeLessThan(500);
    }
  });

  it('spells the wordmark first', () => {
    expect(pickLetters(14).slice(0, 9).join('')).toBe('NAMEFORGE');
  });
});
