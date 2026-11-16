import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef } from 'react';
import { STYLES, type Style } from '../../../shared/brief';
import { ConstellationEngine } from '../lib/constellationEngine';
import { pickLetters } from '../lib/formations';

export interface ConstellationHandle {
  gather(): void;
  settle(minMs: number): Promise<void>;
  /** Fly the letters into `targets` while panning the page to `scrollTop`. */
  unfoldTo(targets: HTMLElement[], scrollTop: number): Promise<void>;
  release(): void;
}

interface Props {
  style: Style | null;
  reducedMotion: boolean;
  compact: boolean;
  busy: boolean;
}

/** Decorative: a slowly drifting constellation of letters. Hidden from assistive tech. */
export const Constellation = forwardRef<ConstellationHandle, Props>(function Constellation(
  { style, reducedMotion, compact, busy },
  ref,
) {
  const fieldRef = useRef<HTMLDivElement>(null);
  const glyphRefs = useRef<HTMLSpanElement[]>([]);
  const lineRefs = useRef<SVGLineElement[]>([]);
  const engineRef = useRef<ConstellationEngine | null>(null);
  const count = compact ? 14 : 30;
  const letters = useMemo(() => pickLetters(count), [count]);
  const styleRef = useRef(style);
  styleRef.current = style;

  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    const glyphs = glyphRefs.current.slice(0, count);
    const lines = lineRefs.current.slice(0, count * 2);
    const engine = new ConstellationEngine(field, glyphs, lines, { reducedMotion, compact });
    engineRef.current = engine;
    if (styleRef.current) engine.setFormation(styleRef.current);
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, [count, reducedMotion, compact]);

  useEffect(() => {
    engineRef.current?.setFormation(style ?? 'idle');
  }, [style]);

  useImperativeHandle(
    ref,
    () => ({
      gather: () => engineRef.current?.gather(),
      settle: (ms) => engineRef.current?.settle(ms) ?? Promise.resolve(),
      unfoldTo: (targets, scrollTop) => engineRef.current?.unfoldTo(targets, scrollTop) ?? Promise.resolve(),
      release: () => engineRef.current?.release(),
    }),
    [],
  );

  const styleInfo = STYLES.find((s) => s.id === style);
  const caption = busy
    ? 'Forging your names…'
    : styleInfo
      ? `${styleInfo.label} · ${styleInfo.hint}`
      : 'Pick a style and watch the letters rearrange';

  return (
    <div className="constellation" aria-hidden="true">
      <div className="constellation__sky" />
      <div className="constellation__field" ref={fieldRef}>
        <div className="constellation__halo" />
        <div className="constellation__ring" />
        <svg className="constellation__lines" width="100%" height="100%">
          {Array.from({ length: count * 2 }, (_, i) => (
            <line
              key={i}
              ref={(el) => {
                if (el) lineRefs.current[i] = el;
              }}
            />
          ))}
        </svg>
        {letters.map((ch, i) => (
          <span
            key={`${count}-${i}`}
            className="glyph"
            ref={(el) => {
              if (el) glyphRefs.current[i] = el;
            }}
          >
            {ch}
          </span>
        ))}
      </div>
      <p className="constellation__caption">{caption}</p>
    </div>
  );
});
