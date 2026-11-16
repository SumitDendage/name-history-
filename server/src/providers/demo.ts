import type { Brief, Style } from '../../../shared/brief';
import type { GenerationInput } from '../prompt';
import { checkName, isHandleType, nameKey, type Candidate } from '../rules';
import type { NameGenerator } from './types';

/**
 * Demo mode: a deterministic, offline name generator used when no AI key is set
 * (or when the user asks for it). Output is clearly labelled as demo in the UI.
 */

interface Root {
  root: string;
  note: string;
}

const ROOTS: Record<'india' | 'international' | 'both', Root[]> = {
  india: [
    { root: 'tara', note: 'means star in Hindi and Sanskrit' },
    { root: 'veda', note: 'means knowledge in Sanskrit' },
    { root: 'nila', note: 'means blue in Hindi' },
    { root: 'kavi', note: 'means poet in Sanskrit' },
    { root: 'prana', note: 'means breath or life force' },
    { root: 'rasa', note: 'means essence or flavour' },
    { root: 'kiran', note: 'means a ray of light' },
    { root: 'dhara', note: 'means a stream or flow' },
    { root: 'yuva', note: 'means youth' },
    { root: 'jiva', note: 'means life' },
    { root: 'sutra', note: 'means thread or formula' },
    { root: 'mitra', note: 'means friend' },
  ],
  international: [
    { root: 'nova', note: 'is Latin for a new star' },
    { root: 'sol', note: 'means sun in Latin and Spanish' },
    { root: 'lumi', note: 'reads like "luminous" in most languages' },
    { root: 'vela', note: 'means sail in Spanish and Italian' },
    { root: 'lyra', note: 'is a constellation named after the lyre' },
    { root: 'halo', note: 'is a ring of light' },
    { root: 'terra', note: 'is Latin for earth' },
    { root: 'alto', note: 'means high in Italian' },
    { root: 'pura', note: 'means pure in Spanish' },
    { root: 'luma', note: 'echoes luminance and light' },
    { root: 'oro', note: 'means gold in Spanish and Italian' },
    { root: 'kin', note: 'means family in English' },
  ],
  both: [
    { root: 'tara', note: 'means star in Hindi and sounds the same in English' },
    { root: 'mira', note: 'is a star name and a familiar name in India' },
    { root: 'nova', note: 'is Latin for a new star and easy in Hindi' },
    { root: 'nila', note: 'means blue in Hindi and reads cleanly abroad' },
    { root: 'veda', note: 'means knowledge in Sanskrit and is widely known abroad' },
    { root: 'ora', note: 'means now in Italian and flows in Hindi' },
    { root: 'sol', note: 'means sun in Latin and is one easy syllable' },
    { root: 'lumi', note: 'suggests light in both markets' },
    { root: 'kavi', note: 'means poet in Sanskrit and is two clear syllables' },
    { root: 'halo', note: 'is a ring of light, said the same in Hindi and English' },
    { root: 'rasa', note: 'means essence in Sanskrit and is easy everywhere' },
    { root: 'luma', note: 'echoes light and has no hard sounds' },
  ],
};

const SUFFIXES: Record<Style, string[]> = {
  modern: ['ly', 'io', 'labs', 'era', 'eo', 'o'],
  premium: ['ora', 'elle', 'ava', 'ina', 'aura', 'eon'],
  playful: ['oo', 'ie', 'y', 'ito', 'bop', 'pop'],
  bold: ['x', 'ax', 'on', 'ex', 'rush', 'ok'],
  minimal: ['a', 'o', 'i', 'en', 'um', 'e'],
};

const GAMING_TAILS = ['fang', 'volt', 'rush', 'hex', 'blitz', 'storm', 'wolf', 'byte', 'drift', 'nyx'];
const HANDLE_WRAPS = [
  (n: string) => `the.${n}`,
  (n: string) => `${n}.hq`,
  (n: string) => `${n}_studio`,
  (n: string) => `hey.${n}`,
  (n: string) => `${n}.co`,
  (n: string) => `${n}_official`,
];

const STYLE_WORD: Record<Style, string> = {
  modern: 'crisp, modern',
  premium: 'soft, premium',
  playful: 'bouncy, playful',
  bold: 'punchy',
  minimal: 'spare',
};

const MARKET_PHRASE: Record<Brief['market'], string> = {
  india: 'easy to say across Indian languages',
  international: 'spelled and said the same almost everywhere',
  both: 'sounds the same in Hindi and English',
};

function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function rng(seed: number) {
  let a = seed || 1;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(list: T[], random: () => number): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

const VOWELS = /[aeiou]/;

/** A pronounceable stem: up to the first vowel group plus one consonant, e.g. "skincare" -> "skin". */
function stem(word: string, max = 5): string {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (w.length <= max) return w;
  let i = 0;
  while (i < w.length && !VOWELS.test(w[i]!)) i++;
  while (i < w.length && VOWELS.test(w[i]!)) i++;
  return w.slice(0, Math.min(Math.max(i + 1, 3), max));
}

function join(a: string, b: string): string {
  if (!a) return b;
  if (!b) return a;
  // Avoid doubled vowels at the seam ("lumi" + "io" -> "lumio").
  if (VOWELS.test(a.at(-1)!) && VOWELS.test(b[0]!)) return a + b.slice(1);
  if (a.at(-1) === b[0]) return a + b.slice(1);
  return a + b;
}

const syllables = (word: string) => Math.max(1, (word.toLowerCase().match(/[aeiouy]+/g) ?? []).length);
const capital = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);
const camel = (parts: string[]) => parts.map(capital).join('');

/** Rough pronounceability check used by the "Easier to pronounce" refinement. */
function easyToSay(word: string): boolean {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (/[qxz]/.test(w)) return false;
  if (/[^aeiouy]{3,}/.test(w)) return false;
  if (/(ph|gh|kn|wr|ough)/.test(w)) return false;
  return true;
}

export class DemoGenerator implements NameGenerator {
  readonly mode = 'demo' as const;
  readonly model = null;

  constructor(private readonly latencyMs = 0) {}

  async generate(input: GenerationInput, signal: AbortSignal): Promise<Candidate[]> {
    if (this.latencyMs > 0) await wait(this.latencyMs, signal);
    return generateDemoCandidates(input);
  }
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new Error('aborted'));
      },
      { once: true },
    );
  });
}

export function generateDemoCandidates(input: GenerationInput): Candidate[] {
  const { brief, refinements, rules, likeName, exclude, count } = input;
  const random = rng(hash(JSON.stringify([brief, refinements, likeName ?? '', exclude])));
  const handle = isHandleType(brief.type);
  const style: Style = refinements.includes('premium') ? 'premium' : brief.style;
  const market = MARKET_PHRASE[brief.market];
  const words = [brief.nickname ?? '', ...brief.keywords]
    .flatMap((k) => k.split(/[\s-]+/))
    .map((k) => k.toLowerCase().replace(/[^a-z]/g, ''))
    .filter((k) => k.length >= 3);
  const roots = shuffle(ROOTS[brief.market], random);
  const suffixes = shuffle(SUFFIXES[style], random);

  const pool: { base: string; reason: string }[] = [];
  const add = (base: string, reason: string) => pool.push({ base, reason });

  if (likeName) {
    const like = likeName.toLowerCase().replace(/[^a-z]/g, '');
    const s = like.length <= 5 ? like.slice(0, Math.max(2, like.length - 1)) : stem(like, 4);
    const ending = like.slice(-3);
    // Vowel swaps keep the rhythm and length of the liked name: "mira" -> "mora", "mera".
    const firstVowel = like.search(/[aeiou]/);
    if (firstVowel >= 0) {
      for (const v of 'aeiou') {
        if (v === like[firstVowel]) continue;
        const swapped = like.slice(0, firstVowel) + v + like.slice(firstVowel + 1);
        add(swapped, `Keeps the shape and rhythm of ${likeName} with a different opening vowel.`);
      }
    }
    for (const r of roots.slice(0, 6)) {
      const head = r.root.slice(0, 2);
      add(head + like.slice(2), `“${capital(head)}” from ${r.root} (which ${r.note}) on the ending of ${likeName}.`);
    }
    for (const suffix of [...suffixes, ...SUFFIXES.minimal]) {
      add(join(s, suffix), `Keeps the “${s}” opening of ${likeName} with a ${STYLE_WORD[style]} “-${suffix}” ending.`);
    }
    for (const r of roots.slice(0, 6)) {
      add(join(r.root.slice(0, 3), ending), `Same “-${ending}” ending as ${likeName}, opened with “${r.root.slice(0, 3)}”; ${market}.`);
    }
  }

  const from = (part: string, word: string) => (part === word ? `“${part}”` : `“${part}” from ${word}`);
  for (const word of words) {
    const s = stem(word);
    for (const suffix of suffixes.slice(0, 3)) {
      add(join(s, suffix), `Takes ${from(s, word)} and adds a ${STYLE_WORD[style]} “-${suffix}” ending; ${market}.`);
    }
    for (const r of roots.slice(0, 3)) {
      const head = stem(word, 4);
      add(join(head, r.root), `Pairs ${from(head, word)} with “${r.root}”, which ${r.note}.`);
    }
  }

  for (const r of roots) {
    const suffix = suffixes[Math.floor(random() * suffixes.length)]!;
    add(join(r.root, suffix), `Built on “${r.root}”, which ${r.note}, with a ${STYLE_WORD[style]} finish.`);
    if (style === 'minimal' || refinements.includes('shorter')) {
      add(r.root, `Simply “${r.root}”, which ${r.note}; ${syllables(r.root)} ${syllables(r.root) === 1 ? 'syllable' : 'syllables'}.`);
    }
  }

  if (words.length >= 2) {
    const [a, b] = [words[0]!, words[1]!];
    add(join(stem(a, 4), b.slice(Math.max(0, b.length - 4))), `Blends ${a} and ${b} into one ${syllables(a) + 1}-beat word.`);
    add(join(stem(b, 4), a.slice(Math.max(0, a.length - 3))), `Flips the blend: ${b} first, then a hint of ${a}.`);
  }

  // Gamertags: a short head word plus a punchy tail, e.g. "TigerVolt".
  if (brief.type === 'gaming') {
    const heads: { head: string; note: string }[] = [];
    for (const word of words) heads.push({ head: word.length <= 6 ? word : stem(word, 5), note: `comes from ${word}` });
    for (const r of roots) if (r.root.length <= 5) heads.push({ head: r.root, note: r.note });
    const tails = shuffle(GAMING_TAILS, random);
    heads.forEach(({ head, note }, i) => {
      for (let k = 0; k < 2; k++) {
        const tail = tails[(i * 2 + k) % tails.length]!;
        const number = rules.allowNumbers && random() < 0.2 ? String(10 + Math.floor(random() * 89)) : '';
        pool.push({
          base: camel([head, tail]) + number,
          reason: `“${capital(head)}” ${note}; the “${tail}” tail gives it a ${STYLE_WORD[style]} edge for a gamertag.`,
        });
      }
    });
  }

  // Shape the bases into the right kind of name.
  let shaped = pool.map(({ base, reason }, i) => {
    if (brief.type === 'gaming') {
      return /[A-Z]/.test(base.slice(1)) ? { name: base, reason } : { name: capital(base), reason };
    }
    if (handle) {
      const wrapped = random() < 0.45 ? HANDLE_WRAPS[i % HANDLE_WRAPS.length]!(base) : base;
      return { name: wrapped.toLowerCase(), reason };
    }
    return { name: capital(base), reason };
  });

  if (refinements.includes('easier')) shaped = shaped.filter((c) => easyToSay(c.name));
  if (refinements.includes('shorter') || refinements.includes('no-numbers')) {
    shaped = shaped.map((c) => (refinements.includes('no-numbers') ? { ...c, name: c.name.replace(/\d+/g, '') } : c));
  }

  // Pre-filter against the rules so demo mode usually fills all 12 slots.
  const seen = new Set(exclude.map(nameKey));
  if (likeName) seen.add(nameKey(likeName));
  const out: Candidate[] = [];
  for (const candidate of shuffle(shaped, random)) {
    const key = nameKey(candidate.name);
    if (seen.has(key)) continue;
    if (checkName(candidate.name, rules, handle)) continue;
    seen.add(key);
    out.push(candidate);
    if (out.length >= count) break;
  }
  return out;
}
