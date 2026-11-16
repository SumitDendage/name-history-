import { gsap } from 'gsap';
import { useLayoutEffect, useRef } from 'react';
import {
  HANDLE_TYPES,
  MARKETS,
  NAMING_TYPES,
  REFINEMENTS,
  STYLES,
  TARGET_COUNT,
  type Brief,
  type GenerateResponse,
  type RefinementId,
  type Suggestion,
} from '../../../shared/brief';
import type { ApiError } from '../api';
import { CloseIcon, RetryIcon } from './Icons';
import { NameCard } from './NameCard';

export type Status = 'idle' | 'loading' | 'success' | 'error';

interface Props {
  status: Status;
  result: GenerateResponse | null;
  brief: Brief | null;
  error: ApiError | null;
  refinements: RefinementId[];
  likeName: string | null;
  runId: number;
  reducedMotion: boolean;
  isSaved: (name: string) => boolean;
  onCopy: (name: string) => void;
  onToggleSave: (s: Suggestion) => void;
  onMoreLike: (name: string) => void;
  onRefine: (id: RefinementId) => void;
  onClearLike: () => void;
  onRetry: () => void;
  onUseDemo: () => void;
  onEditBrief: () => void;
  onCancel: () => void;
  onLoadSample: () => void;
  /** Fly the constellation into these card titles while scrolling to `scrollTop`; resolves when the letters land. */
  onReveal: (titles: HTMLElement[], scrollTop: number) => Promise<void>;
}

const ERROR_TITLES: Record<string, string> = {
  network: "We couldn't reach NameForge",
  timeout: 'That took too long',
  rate_limited: 'Slow down a little',
  invalid_brief: 'Check your brief',
  ai_declined: "The AI couldn't use this brief",
  ai_unconfigured: 'AI naming is not set up yet',
  demo_disabled: 'Demo mode is off',
};

export function Results(props: Props) {
  const { status, result, brief, error, refinements, likeName, runId, reducedMotion } = props;
  const sectionRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const titleRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const currentRun = useRef(runId);
  currentRun.current = runId;
  const onRevealRef = useRef(props.onReveal);
  onRevealRef.current = props.onReveal;

  // Reveal choreography for each new set of results.
  useLayoutEffect(() => {
    if (status !== 'success' || !result || !gridRef.current || !sectionRef.current) return;
    const run = runId;
    const cards = Array.from(gridRef.current.querySelectorAll<HTMLElement>('[data-card]'));
    const header = document.querySelector<HTMLElement>('.topbar')?.offsetHeight ?? 0;
    const top = sectionRef.current.getBoundingClientRect().top + window.scrollY - header - 12;
    const focusHeading = () => headingRef.current?.focus({ preventScroll: true });

    if (!cards.length) {
      window.scrollTo({ top, behavior: reducedMotion ? 'auto' : 'smooth' });
      focusHeading();
      return;
    }
    if (reducedMotion) {
      window.scrollTo({ top, behavior: 'auto' });
      focusHeading();
      return;
    }

    gsap.set(cards, { autoAlpha: 0, y: 28 });
    const firstTop = cards[0]!.offsetTop;
    const firstRow = cards.filter((c) => c.offsetTop === firstTop);
    const rest = cards.slice(firstRow.length);
    const titles = firstRow.map((_, i) => titleRefs.current[i]).filter((t): t is HTMLSpanElement => Boolean(t));

    void onRevealRef.current(titles, top).then(() => {
      if (currentRun.current !== run) return;
      gsap.to(firstRow, { autoAlpha: 1, y: 0, duration: 0.8, stagger: 0.07, ease: 'power3.out' });
      gsap.to(rest, { autoAlpha: 1, y: 0, duration: 0.8, stagger: 0.045, delay: 0.3, ease: 'power3.out' });
      focusHeading();
    });
    return () => {
      gsap.killTweensOf(cards);
      gsap.set(cards, { clearProps: 'opacity,visibility,transform' });
    };
    // Only a new run should replay the choreography.
  }, [runId]);

  const typeLabel = brief ? NAMING_TYPES.find((t) => t.id === brief.type)!.label.toLowerCase() : '';
  const handle = brief ? HANDLE_TYPES.includes(brief.type) : false;

  return (
    <section className="results" id="results" ref={sectionRef} aria-labelledby="results-title" aria-busy={status === 'loading'}>
      <div className="results__head">
        <p className="eyebrow">
          <span className="eyebrow__num">02</span> The names
        </p>

        {status === 'idle' && (
          <h2 className="results__title" id="results-title" tabIndex={-1} ref={headingRef}>
            Your names will land here
          </h2>
        )}

        {status === 'loading' && (
          <>
            <h2 className="results__title" id="results-title" tabIndex={-1} ref={headingRef}>
              {likeName ? `Forging names like “${likeName}”…` : refinements.length ? 'Refining your names…' : `Forging ${TARGET_COUNT} names…`}
            </h2>
            <div className="loader">
              <span className="loader__orbit" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <span>Checking every suggestion against your rules.</span>
              <button type="button" className="btn btn--ghost btn--sm" onClick={props.onCancel}>
                Cancel
              </button>
            </div>
          </>
        )}

        {status === 'error' && error && (
          <>
            <h2 className="results__title" id="results-title" tabIndex={-1} ref={headingRef}>
              {ERROR_TITLES[error.code] ?? (error.code.startsWith('ai_') ? 'The AI hit a snag' : 'Something went wrong')}
            </h2>
            <div className="state state--error" role="alert">
              <p>{error.message}</p>
              {error.code === 'invalid_brief' && error.issues.length > 0 && (
                <ul className="state__issues">
                  {error.issues.map((i) => (
                    <li key={i.path + i.message}>{i.message}</li>
                  ))}
                </ul>
              )}
              <div className="state__actions">
                {error.retryable && (
                  <button type="button" className="btn btn--primary" onClick={props.onRetry}>
                    <RetryIcon /> Retry
                  </button>
                )}
                {error.code !== 'invalid_brief' && error.code !== 'demo_disabled' && result?.mode !== 'demo' && (
                  <button type="button" className="btn btn--ghost" onClick={props.onUseDemo}>
                    Try demo mode
                  </button>
                )}
                <button type="button" className="btn btn--ghost" onClick={props.onEditBrief}>
                  Edit brief
                </button>
              </div>
            </div>
          </>
        )}

        {status === 'success' && result && brief && (
          <>
            <h2 className="results__title" id="results-title" tabIndex={-1} ref={headingRef}>
              {result.returned === 0
                ? 'No names passed your rules'
                : `${result.returned} ${result.returned === 1 ? 'name' : 'names'} for your ${typeLabel}`}
            </h2>
            <p className="results__meta">
              {MARKETS.find((m) => m.id === brief.market)!.label} · {STYLES.find((s) => s.id === brief.style)!.label} · up to{' '}
              {result.rules.maxLength} characters
              {result.rules.avoidChars ? ` · avoids ${result.rules.avoidChars.split('').join(' ')}` : ''}
              {!result.rules.allowNumbers ? ' · no numbers' : ''}
            </p>
            {result.mode === 'demo' && (
              <p className="demo-banner">
                <strong>Demo mode</strong> These sample names come from a local generator, not AI. Add an{' '}
                <code>ANTHROPIC_API_KEY</code> on the server for real suggestions.
              </p>
            )}
            {result.notes.map((note) => (
              <p className="note" key={note}>
                {note}
              </p>
            ))}
            {(result.returned > 0 || refinements.length > 0 || likeName) && (
              <div className="refine" role="group" aria-labelledby="refine-label">
                <p className="refine__label" id="refine-label">
                  Refine <span>· keeps your original brief</span>
                </p>
                <div className="refine__chips">
                  {REFINEMENTS.map((r) => {
                    const active = refinements.includes(r.id);
                    return (
                      <button
                        key={r.id}
                        type="button"
                        className={`chip${active ? ' is-active' : ''}`}
                        aria-pressed={active}
                        onClick={() => props.onRefine(r.id)}
                      >
                        {r.label}
                      </button>
                    );
                  })}
                  {likeName && (
                    <button type="button" className="chip chip--like is-active" onClick={props.onClearLike} aria-label={`Stop basing names on ${likeName}`}>
                      Like “{likeName}” <CloseIcon width={14} height={14} />
                    </button>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {status === 'idle' && (
        <div className="state state--empty">
          <div className="empty__orbit" aria-hidden="true" />
          <p>
            Fill in the brief and press <strong>Generate Names</strong>. You’ll get {TARGET_COUNT} distinct suggestions, each with a
            reason, checked against your rules.
          </p>
          <button type="button" className="btn btn--ghost" onClick={props.onLoadSample}>
            Load the sample skincare brief
          </button>
        </div>
      )}

      {status === 'loading' && (
        <div className="grid grid--skeleton" aria-hidden="true">
          {Array.from({ length: 6 }, (_, i) => (
            <div className="card card--skeleton" key={i}>
              <span />
              <span />
              <span />
            </div>
          ))}
        </div>
      )}

      {status === 'success' && result && brief && result.returned === 0 && (
        <div className="state state--empty">
          <p>Try a longer max length, fewer characters to avoid, or switch off a refinement.</p>
          <div className="state__actions">
            <button type="button" className="btn btn--primary" onClick={props.onEditBrief}>
              Edit brief
            </button>
            <button type="button" className="btn btn--ghost" onClick={props.onRetry}>
              <RetryIcon /> Try again
            </button>
          </div>
        </div>
      )}

      {status === 'success' && result && brief && result.returned > 0 && (
        <>
          <div className="grid" ref={gridRef}>
            {result.suggestions.map((s, i) => (
              <NameCard
                key={s.id}
                ref={(el) => {
                  titleRefs.current[i] = el;
                }}
                index={i}
                suggestion={s}
                handle={handle}
                market={brief.market}
                saved={props.isSaved(s.name)}
                busy={false}
                onCopy={props.onCopy}
                onToggleSave={props.onToggleSave}
                onMoreLike={props.onMoreLike}
              />
            ))}
          </div>
          <p className="results__foot">
            Username and domain availability is <strong>Unchecked</strong>. Confirm on each platform and with a domain registrar before you
            commit, and run a trademark search for business names.
          </p>
        </>
      )}
    </section>
  );
}
