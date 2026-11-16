import { gsap } from 'gsap';
import { edgesFor, formation, orbitPoint, orbitRadii, scatter, seeded, type Edge, type FormationKey, type Pose } from './formations';

interface GlyphState extends Pose {
  /** Ambient drift offset in px, layered on top of the pose. */
  dx: number;
  dy: number;
}

export interface EngineOptions {
  reducedMotion: boolean;
  compact: boolean;
}

type Mode = 'formation' | 'orbit';

const ORBIT_TURN_SECONDS = 7;

/**
 * Drives the letter constellation. GSAP tweens plain state objects; one ticker
 * callback writes transforms and constellation lines to the DOM each frame.
 */
export class ConstellationEngine {
  private readonly state: GlyphState[];
  private readonly base: { x: number; y: number }[];
  private w = 1;
  private h = 1;
  private mode: Mode = 'formation';
  private key: FormationKey = 'idle';
  private edges: Edge[] = [];
  private lineAlpha = { v: 0.32 };
  private orbit = { angle: 0, p: 0 };
  private orbitStart: Pose[] = [];
  /** Vertical centre of the orbit in px: the middle of the part of the field that is on screen. */
  private orbitCy = 0;
  private orbitSpin: gsap.core.Tween | null = null;
  private gatheredAt = 0;
  private visible = true;
  private destroyed = false;
  private readonly resizeObserver: ResizeObserver;
  private readonly intersectionObserver: IntersectionObserver;
  private readonly drift: gsap.core.Tween[] = [];
  private lastWeight: number[] = [];
  private flyerLayer: HTMLDivElement | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly glyphs: HTMLElement[],
    private readonly lines: SVGLineElement[],
    private readonly opts: EngineOptions,
  ) {
    const n = glyphs.length;
    this.base = scatter(n, seeded(n * 97 + 3));
    const poses = formation('idle', this.base);
    this.state = poses.map((p) => ({ ...p, dx: 0, dy: 0 }));
    this.lastWeight = new Array(n).fill(-1);
    this.measure();
    this.edges = edgesFor('idle', this.base, this.w / this.h);

    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(root);
    this.intersectionObserver = new IntersectionObserver(([entry]) => {
      this.visible = Boolean(entry?.isIntersecting);
    });
    this.intersectionObserver.observe(root);

    gsap.ticker.add(this.render);
    this.intro();
  }

  private measure() {
    this.w = Math.max(1, this.root.clientWidth);
    this.h = Math.max(1, this.root.clientHeight);
  }

  private onResize() {
    const prevW = this.w;
    const prevH = this.h;
    this.measure();
    if (this.mode !== 'formation' || (prevW === this.w && prevH === this.h)) return;
    // Re-place without animation so a resize never leaves letters stranded.
    const poses = formation(this.key, this.base);
    poses.forEach((p, i) => {
      const s = this.state[i]!;
      gsap.killTweensOf(s, 'x,y');
      s.x = p.x * this.w;
      s.y = p.y * this.h;
    });
    this.edges = edgesFor(this.key, poses, this.w / this.h);
  }

  private intro() {
    const poses = formation('idle', this.base);
    poses.forEach((p, i) => {
      const s = this.state[i]!;
      Object.assign(s, { x: p.x * this.w, y: p.y * this.h, s: p.s, o: p.o, r: 0, w: p.w });
    });
    if (this.opts.reducedMotion) return;
    gsap.from(this.state, {
      o: 0,
      s: 0.4,
      duration: 1.6,
      ease: 'power2.out',
      stagger: { each: 0.035, from: 'random' },
      delay: 0.35,
    });
    gsap.from(this.lineAlpha, { v: 0, duration: 2.2, delay: 0.9, ease: 'power1.out' });
    this.startDrift();
  }

  private startDrift() {
    if (this.opts.reducedMotion) return;
    const random = seeded(this.state.length * 13);
    const amp = this.opts.compact ? 5 : 11;
    this.state.forEach((s) => {
      this.drift.push(
        gsap.to(s, {
          dx: (random() - 0.5) * 2 * amp,
          dy: (random() - 0.5) * 2 * amp,
          duration: 4 + random() * 5,
          ease: 'sine.inOut',
          repeat: -1,
          yoyo: true,
          delay: random() * 2,
        }),
      );
    });
  }

  /** Move to the formation for a style. Subtle: a blend of the idle scatter and the style shape. */
  setFormation(key: FormationKey) {
    if (this.destroyed || key === this.key) return;
    this.key = key;
    if (this.mode !== 'formation') return;
    this.toFormation(this.opts.reducedMotion ? 0 : 1.6);
  }

  private toFormation(duration: number, fadeIn = false) {
    const poses = formation(this.key, this.base);
    const nextEdges = edgesFor(this.key, poses, this.w / this.h);
    if (duration === 0) {
      poses.forEach((p, i) => {
        const s = this.state[i]!;
        gsap.killTweensOf(s, 'x,y,s,o,r,w');
        Object.assign(s, { x: p.x * this.w, y: p.y * this.h, s: p.s, o: p.o, r: p.r, w: p.w });
      });
      this.edges = nextEdges;
      this.lineAlpha.v = 0.32;
      return;
    }
    poses.forEach((p, i) => {
      gsap.to(this.state[i]!, {
        x: p.x * this.w,
        y: p.y * this.h,
        s: p.s,
        o: p.o,
        r: p.r,
        w: p.w,
        duration,
        ease: fadeIn ? 'power2.out' : 'power3.inOut',
        delay: i * (fadeIn ? 0.03 : 0.012),
        overwrite: 'auto',
      });
    });
    gsap
      .timeline()
      .to(this.lineAlpha, { v: 0, duration: 0.3, ease: 'power1.in', overwrite: 'auto' })
      .call(() => {
        this.edges = nextEdges;
      })
      .to(this.lineAlpha, { v: 0.32, duration: duration * 0.8, ease: 'power1.out' });
  }

  /** Gather every letter into a glowing orbit while a request runs. */
  gather() {
    if (this.destroyed) return;
    this.flyerLayer?.remove();
    this.flyerLayer = null;
    this.state.forEach((s) => gsap.killTweensOf(s, 'x,y,s,o,r,w'));
    this.orbitStart = this.state.map((s) => ({ x: s.x, y: s.y, s: s.s, o: s.o, r: s.r, w: s.w }));
    this.mode = 'orbit';
    this.gatheredAt = performance.now();
    this.orbitCy = this.visibleCentreY();
    this.root.style.setProperty('--orbit-y', `${this.orbitCy.toFixed(0)}px`);
    this.root.classList.add('is-orbiting');
    this.edges = edgesFor('orbit', this.base, 1);
    gsap.killTweensOf(this.orbit);
    gsap.killTweensOf(this.lineAlpha);
    this.orbit.angle = 0;

    if (this.opts.reducedMotion) {
      this.orbit.p = 1;
      this.lineAlpha.v = 0.5;
      return;
    }
    this.orbit.p = 0;
    gsap.to(this.orbit, { p: 1, duration: 1.2, ease: 'power3.inOut' });
    gsap.to(this.lineAlpha, { v: 0.55, duration: 1.2, ease: 'power2.out' });
    this.orbitSpin = gsap.to(this.orbit, {
      angle: Math.PI * 2,
      duration: ORBIT_TURN_SECONDS,
      ease: 'none',
      repeat: -1,
    });
  }

  /** Centre the orbit in the visible part of the field so the sticky header never hides it. */
  private visibleCentreY(): number {
    const rect = this.root.getBoundingClientRect();
    const header = document.querySelector<HTMLElement>('.topbar')?.offsetHeight ?? 0;
    const top = Math.max(rect.top, header + 8);
    const bottom = Math.min(rect.bottom, window.innerHeight - 8);
    const { ry } = orbitRadii(this.w, this.h);
    const margin = Math.min(this.h / 2, ry + 36);
    const centre = bottom - top > 140 ? (top + bottom) / 2 - rect.top : this.h / 2;
    return Math.min(this.h - margin, Math.max(margin, centre));
  }

  /** Resolve once the orbit has had at least `minMs` on screen, so the gather never looks cut off. */
  settle(minMs: number): Promise<void> {
    if (this.mode !== 'orbit' || this.opts.reducedMotion) return Promise.resolve();
    const left = minMs - (performance.now() - this.gatheredAt);
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, left)));
  }

  /** Leave the orbit (error, cancel) and return to the current style formation. */
  release() {
    if (this.destroyed || this.mode !== 'orbit') return;
    this.freezeOrbit();
    this.toFormation(this.opts.reducedMotion ? 0 : 1.4);
  }

  private freezeOrbit() {
    this.orbitSpin?.kill();
    this.orbitSpin = null;
    gsap.killTweensOf(this.orbit);
    // Bake the on-screen orbit positions into state so the next tween starts from them.
    // Drift offsets keep running, so subtract their current share to avoid a jump.
    const p = this.orbit.p;
    this.state.forEach((s, i) => {
      const pos = this.orbitPose(i);
      Object.assign(s, { x: pos.x - s.dx * p, y: pos.y - s.dy * p, s: pos.s, o: pos.o, r: pos.r, w: pos.w });
    });
    this.mode = 'formation';
    this.root.classList.remove('is-orbiting');
  }

  private orbitPose(i: number): Pose {
    const start = this.orbitStart[i] ?? this.state[i]!;
    const o = orbitPoint(i, this.state.length, this.orbit.angle, this.w, this.h, this.orbitCy || this.h / 2);
    const p = this.orbit.p;
    return {
      x: start.x + (o.x - start.x) * p,
      y: start.y + (o.y - start.y) * p,
      s: start.s + (o.s - start.s) * p,
      o: start.o + (o.o - start.o) * p,
      r: start.r * (1 - p),
      w: start.w + (600 - start.w) * p,
    };
  }

  /**
   * Unfold the orbit into the first row of name cards: each letter flies (in document
   * coordinates, so page scrolling doesn't matter) to a card title, then fades as the cards appear.
   * Resolves when the letters land. Falls back to a simple release on mobile / reduced motion.
   */
  unfoldTo(targets: HTMLElement[], scrollTop: number): Promise<void> {
    if (this.destroyed) return Promise.resolve();
    const rootRect = this.root.getBoundingClientRect();
    const onScreen = rootRect.bottom > 0 && rootRect.top < window.innerHeight;
    if (this.opts.reducedMotion || this.opts.compact || !targets.length || this.mode !== 'orbit' || !onScreen) {
      this.release();
      window.scrollTo({ top: scrollTop, behavior: this.opts.reducedMotion ? 'auto' : 'smooth' });
      return Promise.resolve();
    }

    const sx = window.scrollX;
    const sy = window.scrollY;
    const fontSize = parseFloat(getComputedStyle(this.glyphs[0]!).fontSize) || 24;
    const layer = document.createElement('div');
    layer.className = 'flyer-layer';
    layer.setAttribute('aria-hidden', 'true');
    document.body.appendChild(layer);
    this.flyerLayer = layer;

    const starts = this.state.map((s, i) => {
      const pose = this.orbitPose(i);
      return { x: rootRect.left + sx + pose.x + s.dx * (1 - this.orbit.p), y: rootRect.top + sy + pose.y + s.dy * (1 - this.orbit.p), s: pose.s, o: pose.o };
    });

    // Hide the field's own letters; they fade back into formation once the flight is over.
    this.freezeOrbit();
    this.state.forEach((s) => (s.o = 0));
    this.lineAlpha.v = 0;

    const perTarget = Math.ceil(this.state.length / targets.length);
    const rects = targets.map((t) => t.getBoundingClientRect());
    const random = seeded(17);

    // The camera pans down to the results with the same easing as the letters' fall,
    // so the letters stay in view while they fly into the cards. Any user scroll input stops the pan.
    const FLIGHT = 1.35;
    const camera = { y: sy };
    const pan = gsap.to(camera, {
      y: Math.max(0, scrollTop),
      duration: FLIGHT,
      ease: 'power2.inOut',
      onUpdate: () => window.scrollTo({ top: camera.y, behavior: 'instant' }),
    });
    const stopPan = () => pan.kill();
    const inputs = ['wheel', 'touchstart', 'keydown'] as const;
    inputs.forEach((ev) => window.addEventListener(ev, stopPan, { once: true, passive: true }));
    const cleanupInputs = () => inputs.forEach((ev) => window.removeEventListener(ev, stopPan));

    return new Promise((resolve) => {
      const tl = gsap.timeline({
        onComplete: () => {
          cleanupInputs();
          layer.remove();
          if (this.flyerLayer === layer) this.flyerLayer = null;
          this.toFormation(1.6, true);
        },
      });
      starts.forEach((start, i) => {
        const flyer = document.createElement('span');
        flyer.className = 'flyer';
        flyer.textContent = this.glyphs[i]!.textContent;
        flyer.style.fontSize = `${fontSize}px`;
        layer.appendChild(flyer);

        const rect = rects[i % rects.length]!;
        const slot = Math.floor(i / rects.length);
        const tx = rect.left + sx + rect.width * ((slot + 0.5) / perTarget);
        const ty = rect.top + sy + rect.height * 0.52;
        const d = FLIGHT - 0.15 + random() * 0.3;
        const at = i * 0.012;

        gsap.set(flyer, { x: start.x, y: start.y, xPercent: -50, yPercent: -50, scale: start.s, opacity: Math.max(0.5, start.o) });
        tl.to(flyer, { x: tx, duration: d, ease: 'power3.inOut' }, at)
          .to(flyer, { y: ty, duration: d, ease: 'power2.inOut' }, at)
          .to(flyer, { scale: 0.55, duration: d, ease: 'power1.in' }, at)
          .to(flyer, { opacity: 0, duration: 0.35, ease: 'power1.out' }, at + d - 0.12);
      });
      tl.call(resolve, [], FLIGHT - 0.2);
    });
  }

  private render = () => {
    if (this.destroyed || (!this.visible && !this.flyerLayer)) return;
    const n = this.state.length;
    const xs = new Array<number>(n);
    const ys = new Array<number>(n);
    const os = new Array<number>(n);
    const orbiting = this.mode === 'orbit';
    const damp = orbiting ? 1 - this.orbit.p : 1;

    for (let i = 0; i < n; i++) {
      const s = this.state[i]!;
      const pose = orbiting ? this.orbitPose(i) : s;
      const x = pose.x + s.dx * damp;
      const y = pose.y + s.dy * damp;
      xs[i] = x;
      ys[i] = y;
      os[i] = pose.o;
      const el = this.glyphs[i]!;
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -50%) rotate(${pose.r.toFixed(1)}deg) scale(${pose.s.toFixed(3)})`;
      el.style.opacity = pose.o.toFixed(3);
      const weight = Math.round(pose.w / 20) * 20;
      if (weight !== this.lastWeight[i]) {
        el.style.fontWeight = String(weight);
        this.lastWeight[i] = weight;
      }
    }

    for (let k = 0; k < this.lines.length; k++) {
      const line = this.lines[k]!;
      const edge = this.edges[k];
      if (!edge || this.lineAlpha.v <= 0.001) {
        line.style.opacity = '0';
        continue;
      }
      const [a, b] = edge;
      line.setAttribute('x1', xs[a]!.toFixed(1));
      line.setAttribute('y1', ys[a]!.toFixed(1));
      line.setAttribute('x2', xs[b]!.toFixed(1));
      line.setAttribute('y2', ys[b]!.toFixed(1));
      line.style.opacity = (Math.min(os[a]!, os[b]!) * this.lineAlpha.v).toFixed(3);
    }
  };

  destroy() {
    this.destroyed = true;
    gsap.ticker.remove(this.render);
    this.resizeObserver.disconnect();
    this.intersectionObserver.disconnect();
    this.drift.forEach((t) => t.kill());
    this.orbitSpin?.kill();
    this.state.forEach((s) => gsap.killTweensOf(s));
    gsap.killTweensOf(this.orbit);
    gsap.killTweensOf(this.lineAlpha);
    this.flyerLayer?.remove();
  }
}
