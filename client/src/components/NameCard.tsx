import { forwardRef } from 'react';
import type { Market, Suggestion } from '../../../shared/brief';
import { CopyIcon, HeartIcon, SparkIcon } from './Icons';

interface Props {
  index: number;
  suggestion: Suggestion;
  handle: boolean;
  market: Market;
  saved: boolean;
  busy: boolean;
  onCopy: (name: string) => void;
  onToggleSave: (suggestion: Suggestion) => void;
  onMoreLike: (name: string) => void;
}

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

export const NameCard = forwardRef<HTMLSpanElement, Props>(function NameCard(
  { index, suggestion, handle, market, saved, busy, onCopy, onToggleSave, onMoreLike },
  titleRef,
) {
  const titleId = `name-${suggestion.id}`;
  const s = slug(suggestion.name);
  const username = handle ? suggestion.name.replace(/\s+/g, '').toLowerCase() : s;
  const tld = market === 'india' ? '.in' : '.com';

  return (
    <article className="card" aria-labelledby={titleId} data-card>
      <header className="card__head">
        <span className="card__index" aria-hidden="true">
          {String(index + 1).padStart(2, '0')}
        </span>
        <h3 className="card__name" id={titleId}>
          <span className="card__name-text" ref={titleRef}>
            {suggestion.name}
          </span>
        </h3>
        <span className="card__len">
          {suggestion.length} <span aria-hidden="true">chars</span>
          <span className="sr-only">characters</span>
        </span>
      </header>
      <p className="card__reason">{suggestion.reason}</p>
      <dl className="card__avail">
        <div>
          <dt>Username @{username}</dt>
          <dd>
            <span className="pill pill--unchecked" title="Availability not checked. Confirm on each platform before you commit.">
              Unchecked
            </span>
          </dd>
        </div>
        <div>
          <dt>
            Domain {s}
            {tld}
          </dt>
          <dd>
            <span className="pill pill--unchecked" title="Availability not checked. Confirm with a domain registrar before you commit.">
              Unchecked
            </span>
          </dd>
        </div>
      </dl>
      <div className="card__actions">
        <button type="button" className="action" onClick={() => onCopy(suggestion.name)} aria-label={`Copy ${suggestion.name}`}>
          <CopyIcon /> <span aria-hidden="true">Copy</span>
        </button>
        <button
          type="button"
          className={`action${saved ? ' is-active' : ''}`}
          aria-pressed={saved}
          aria-label={saved ? `Saved ${suggestion.name}. Remove from favourites` : `Save ${suggestion.name} to favourites`}
          onClick={() => onToggleSave(suggestion)}
        >
          <HeartIcon filled={saved} /> <span aria-hidden="true">{saved ? 'Saved' : 'Save'}</span>
        </button>
        <button
          type="button"
          className="action action--accent"
          onClick={() => onMoreLike(suggestion.name)}
          disabled={busy}
          aria-label={`More names like ${suggestion.name}`}
        >
          <SparkIcon /> <span aria-hidden="true">More like this</span>
        </button>
      </div>
    </article>
  );
});
