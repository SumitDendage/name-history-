import type { Style } from '../../../shared/brief';

/** Normalised glyph pose: x/y in 0..1 of the field, scale, opacity, rotation (deg), font weight. */
export interface Pose {
  x: number;
  y: number;
  s: number;
  o: number;
  r: number;
  w: number;
}

export type FormationKey = Style | 'idle';
export type Edge = [number, number];

export function seeded(seed: number) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Evenly spread points ("best candidate" sampling) inside a safe margin. */
export function scatter(n: number, random: () => number): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    let best = { x: 0.5, y: 0.5 };
    let bestD = -1;
    for (let c = 0; c < 14; c++) {
      const p = { x: 0.08 + random() * 0.84, y: 0.1 + random() * 0.78 };
      const d = pts.length ? Math.min(...pts.map((q) => (q.x - p.x) ** 2 + (q.y - p.y) ** 2)) : 1;
      if (d > bestD) {
        bestD = d;
        best = p;
      }
    }
    pts.push(best);
  }
  return pts;
}

/** Assign structure slots to the nearest existing points so letters travel as little as possible. */
function assign(base: { x: number; y: number }[], slots: { x: number; y: number }[]): number[] {
  const owner = new Array<number>(slots.length).fill(-1);
  const used = new Set<number>();
  slots.forEach((slot, si) => {
    let best = -1;
    let bestD = Infinity;
    base.forEach((p, bi) => {
      if (used.has(bi)) return;
      const d = (p.x - slot.x) ** 2 + (p.y - slot.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = bi;
      }
    });
    if (best >= 0) {
      used.add(best);
      owner[si] = best;
    }
  });
  return owner;
}

/**
 * A style formation is a blend of the idle scatter and a style-specific structure,
 * so switching style *subtly* rearranges the constellation rather than snapping to a shape.
 */
export function formation(key: FormationKey, base: { x: number; y: number }[], seed = 7): Pose[] {
  const n = base.length;
  const random = seeded(seed + key.length * 31);
  const idle: Pose[] = base.map((p) => ({ x: p.x, y: p.y, s: 0.8 + random() * 0.4, o: 0.5 + random() * 0.45, r: 0, w: 380 }));
  if (key === 'idle') return idle;

  const poses = idle.map((p) => ({ ...p }));
  const place = (slots: { x: number; y: number }[], blend: number, style: (slotIndex: number) => Partial<Pose>) => {
    const owners = assign(base, slots);
    owners.forEach((bi, si) => {
      if (bi < 0) return;
      const slot = slots[si]!;
      const pose = poses[bi]!;
      pose.x = lerp(base[bi]!.x, slot.x, blend);
      pose.y = lerp(base[bi]!.y, slot.y, blend);
      Object.assign(pose, style(si));
    });
  };

  switch (key) {
    case 'modern': {
      const cols = 6;
      const rows = Math.ceil(n / cols);
      const slots = Array.from({ length: n }, (_, i) => ({
        x: 0.14 + (i % cols) * (0.72 / (cols - 1)),
        y: 0.16 + Math.floor(i / cols) * (0.68 / Math.max(1, rows - 1)),
      }));
      place(slots, 0.72, () => ({ s: 0.95, o: 0.85, r: 0, w: 520 }));
      break;
    }
    case 'premium': {
      const outer = Math.ceil(n * 0.6);
      const slots = Array.from({ length: n }, (_, i) => {
        const ring = i < outer ? 0 : 1;
        const k = ring === 0 ? i / Math.max(1, outer - 1) : (i - outer) / Math.max(1, n - outer - 1);
        const a = Math.PI * (1.1 + k * 0.8);
        const r = ring === 0 ? 0.44 : 0.28;
        return { x: 0.5 + Math.cos(a) * r, y: 0.86 + Math.sin(a) * r * 1.05 };
      });
      place(slots, 0.78, (si) => ({ s: si < outer ? 0.92 : 0.78, o: si < outer ? 0.95 : 0.7, r: 0, w: 300 }));
      break;
    }
    case 'playful': {
      const slots = Array.from({ length: n }, (_, i) => {
        const t = i / Math.max(1, n - 1);
        return { x: 0.08 + t * 0.84, y: 0.5 + 0.24 * Math.sin(t * Math.PI * 3.2) * (i % 2 ? 1 : 0.7) };
      });
      place(slots, 0.66, () => ({ s: 0.8 + random() * 0.55, o: 0.9, r: (random() - 0.5) * 34, w: 620 }));
      break;
    }
    case 'bold': {
      const slots = Array.from({ length: n }, (_, i) => {
        const a = i * 2.399963; // golden angle
        const r = Math.sqrt((i + 0.5) / n) * 0.3;
        return { x: 0.5 + Math.cos(a) * r * 1.15, y: 0.5 + Math.sin(a) * r };
      });
      place(slots, 0.74, () => ({ s: 1.25 + random() * 0.3, o: 1, r: 0, w: 860 }));
      break;
    }
    case 'minimal': {
      const lineCount = Math.min(9, n);
      const slots = Array.from({ length: lineCount }, (_, i) => ({ x: 0.16 + (i / Math.max(1, lineCount - 1)) * 0.68, y: 0.5 }));
      // The first letters spell the wordmark; keep them in order on one quiet line.
      slots.forEach((slot, i) => {
        Object.assign(poses[i]!, { x: slot.x, y: slot.y, s: 0.9, o: 0.95, r: 0, w: 300 });
      });
      for (let i = lineCount; i < n; i++) Object.assign(poses[i]!, { s: 0.6, o: 0.16, w: 300 });
      break;
    }
  }
  return poses;
}

/** Constellation lines: each point links to its nearest neighbours within a radius. */
export function edgesFor(key: FormationKey | 'orbit', poses: { x: number; y: number }[], aspect: number): Edge[] {
  const n = poses.length;
  if (key === 'orbit') return Array.from({ length: n }, (_, i) => [i, (i + 1) % n] as Edge);
  if (key === 'minimal') {
    const lineCount = Math.min(9, n);
    return Array.from({ length: lineCount - 1 }, (_, i) => [i, i + 1] as Edge);
  }
  const k = key === 'bold' ? 3 : 2;
  const max = key === 'bold' ? 0.22 : 0.3;
  const out = new Map<string, Edge>();
  poses.forEach((p, i) => {
    const near = poses
      .map((q, j) => ({ j, d: Math.hypot((q.x - p.x) * aspect, q.y - p.y) }))
      .filter(({ j, d }) => j !== i && d < max)
      .sort((a, b) => a.d - b.d)
      .slice(0, k);
    for (const { j } of near) {
      const a = Math.min(i, j);
      const b = Math.max(i, j);
      out.set(`${a}-${b}`, [a, b]);
    }
  });
  return [...out.values()];
}

/** A point on the tilted loading orbit, in pixels, plus a depth cue (0 back .. 1 front). */
export function orbitRadii(w: number, h: number) {
  const rx = Math.min(w * 0.4, h * 0.62);
  return { rx, ry: rx * 0.38 };
}

export function orbitPoint(i: number, n: number, angle: number, w: number, h: number, cy = h / 2) {
  const a = angle + (i / n) * Math.PI * 2;
  const { rx, ry } = orbitRadii(w, h);
  const tilt = -0.2;
  const ex = Math.cos(a) * rx;
  const ey = Math.sin(a) * ry;
  const depth = (Math.sin(a) + 1) / 2;
  return {
    x: w / 2 + ex * Math.cos(tilt) - ey * Math.sin(tilt),
    y: cy + ex * Math.sin(tilt) + ey * Math.cos(tilt),
    s: 0.72 + depth * 0.5,
    o: 0.35 + depth * 0.65,
  };
}

export function pickLetters(n: number, seed = 11): string[] {
  const word = 'NAMEFORGE'.split('');
  const pool = 'AEIOULMNRSTKVYDBHZX';
  const random = seeded(seed);
  const out = word.slice(0, Math.min(n, word.length));
  while (out.length < n) out.push(pool[Math.floor(random() * pool.length)]!);
  return out;
}
