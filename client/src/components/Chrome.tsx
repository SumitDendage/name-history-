import { gsap } from 'gsap';
import { Fragment, useLayoutEffect, useRef, type RefObject } from 'react';
import { NAMING_TYPES, type HealthResponse } from '../../../shared/brief';
import { ForgeMark, HeartIcon } from './Icons';

interface HeaderProps {
  health: HealthResponse | null;
  savedCount: number;
  drawerOpen: boolean;
  onOpenDrawer: () => void;
  drawerButtonRef: RefObject<HTMLButtonElement | null>;
}

export function Header({ health, savedCount, drawerOpen, onOpenDrawer, drawerButtonRef }: HeaderProps) {
  return (
    <header className="topbar">
      <a className="skip-link" href="#brief">
        Skip to the brief
      </a>
      <a className="brand" href="#top" aria-label="NameForge AI, back to top">
        <ForgeMark className="brand__mark" />
        <span className="brand__word">
          NameForge <em>AI</em>
        </span>
      </a>
      <nav className="topbar__nav" aria-label="Main">
        <a className="topbar__link" href="#how">
          How it works
        </a>
        {health?.mode === 'demo' && (
          <span className="badge badge--demo" title="No AI key on the server: names come from a local sample generator.">
            Demo mode
          </span>
        )}
        {health?.mode === 'ai' && (
          <span className="badge badge--live" title={health.model ? `Model: ${health.model}` : undefined}>
            AI live
          </span>
        )}
        <button
          ref={drawerButtonRef}
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={onOpenDrawer}
          aria-haspopup="dialog"
          aria-expanded={drawerOpen}
          aria-label={`Saved names: ${savedCount}`}
        >
          <HeartIcon /> <span className="hide-sm">Saved</span> <span className="count">{savedCount}</span>
        </button>
      </nav>
    </header>
  );
}

const HEADLINE = ['Find', 'a', 'name', 'that', 'fits', 'what', 'you’re', 'building.'];

export function Hero({ reducedMotion }: { reducedMotion: boolean }) {
  const root = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    if (reducedMotion || !root.current) return;
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: 'expo.out' } });
      tl.from('.hero__word > span', { yPercent: 115, rotate: 3, duration: 1.4, stagger: 0.07 }, 0.15)
        .from('.hero__eyebrow', { autoAlpha: 0, y: 12, duration: 1 }, 0)
        .from('.hero__lede', { autoAlpha: 0, y: 18, duration: 1.2 }, 0.7)
        .from('.hero__types li', { autoAlpha: 0, y: 10, duration: 0.9, stagger: 0.05 }, 0.9)
        .from('.hero__horizon', { autoAlpha: 0, scaleX: 0.6, duration: 2.4, ease: 'power3.out' }, 0)
        .from('.scroll-cue', { autoAlpha: 0, duration: 1 }, 1.4);
    }, root);
    return () => ctx.revert();
  }, [reducedMotion]);

  return (
    <section className="hero" id="top" ref={root} aria-labelledby="hero-title">
      <div className="hero__horizon" aria-hidden="true" />
      <p className="eyebrow hero__eyebrow">AI naming studio · India &amp; worldwide</p>
      <h1 className="hero__title" id="hero-title">
        {HEADLINE.map((word, i) => (
          <Fragment key={i}>
            <span className={`hero__word${word === 'fits' ? ' hero__word--accent' : ''}`}>
              <span>{word}</span>
            </span>{' '}
          </Fragment>
        ))}
      </h1>
      <p className="hero__lede">
        NameForge AI drafts twelve distinct names for whatever you’re launching, tuned for customers in India, abroad, or both, and checked
        against the rules you set.
      </p>
      <ul className="hero__types" aria-label="What you can name">
        {NAMING_TYPES.map((t) => (
          <li key={t.id}>{t.short}</li>
        ))}
      </ul>
      <a className="scroll-cue" href="#brief">
        Start your brief <span aria-hidden="true">↓</span>
      </a>
    </section>
  );
}

export function HowItWorks() {
  const steps = [
    ['Brief', 'Tell us what you’re naming, who it’s for, and the feel you’re after.'],
    ['Forge', 'The AI drafts more names than you need. Our server removes any that break your rules: length, characters, numbers, repeats.'],
    ['Refine', 'Go shorter, easier to say or more premium, or ask for more like a favourite. Your original brief always stays in place.'],
    ['Shortlist', 'Save favourites in this browser. Availability is marked Unchecked, so verify before you commit.'],
  ];
  return (
    <section className="how" id="how" aria-labelledby="how-title">
      <p className="eyebrow">
        <span className="eyebrow__num">03</span> How it works
      </p>
      <h2 className="how__title" id="how-title">
        From brief to shortlist
      </h2>
      <ol className="how__steps">
        {steps.map(([title, body], i) => (
          <li key={title}>
            <span className="how__num" aria-hidden="true">
              {String(i + 1).padStart(2, '0')}
            </span>
            <h3>{title}</h3>
            <p>{body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="footer">
      <p className="footer__brand">
        <ForgeMark /> NameForge AI
      </p>
      <p>
        Briefs are sent to our server and an AI model to generate names. Favourites stay in your browser. Username and domain availability
        is always shown as <strong>Unchecked</strong>.
      </p>
    </footer>
  );
}

export function Toast({ message }: { message: string | null }) {
  return (
    <div className="toast-region" role="status" aria-live="polite">
      {message && <div className="toast">{message}</div>}
    </div>
  );
}
