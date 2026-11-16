import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { MARKETS, NAMING_TYPES, STYLES, type Brief, type HistoryEntry } from '../../../shared/brief';
import type { Favourite } from '../hooks/useFavourites';
import { CloseIcon, CopyIcon } from './Icons';

type Tab = 'saved' | 'history';

interface Props {
  open: boolean;
  onClose: () => void;
  favourites: Favourite[];
  onCopy: (text: string, label?: string) => void;
  onRemove: (name: string) => void;
  onClear: () => void;
  historyEnabled: boolean;
  history: HistoryEntry[] | null;
  historyError: string | null;
  onLoadHistory: () => void;
  onClearHistory: () => void;
  onUseBrief: (brief: Brief) => void;
}

const describe = (b: { type: Brief['type']; market: Brief['market']; style: Brief['style'] }) =>
  [NAMING_TYPES.find((t) => t.id === b.type)?.short, MARKETS.find((m) => m.id === b.market)?.label, STYLES.find((s) => s.id === b.style)?.label]
    .filter(Boolean)
    .join(' · ');

export function Drawer(props: Props) {
  const { open, onClose, favourites, historyEnabled } = props;
  const [tab, setTab] = useState<Tab>('saved');
  const [confirmClear, setConfirmClear] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ saved: null, history: null });
  const { onLoadHistory } = props;

  useEffect(() => {
    if (!open) {
      setConfirmClear(false);
      return;
    }
    closeRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (open && tab === 'history') onLoadHistory();
  }, [open, tab, onLoadHistory]);

  if (!open) return null;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab' || !panelRef.current) return;
    const focusable = Array.from(
      panelRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input, [tabindex]:not([tabindex="-1"])'),
    ).filter((el) => el.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const tabs: Tab[] = historyEnabled ? ['saved', 'history'] : ['saved'];
  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    const i = tabs.indexOf(tab);
    const next = tabs[(i + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]!;
    setTab(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <div className="drawer-wrap">
      <div className="drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title" ref={panelRef} onKeyDown={onKeyDown}>
        <div className="drawer__head">
          <h2 id="drawer-title">Your shortlist</h2>
          <button type="button" className="icon-btn" onClick={onClose} ref={closeRef} aria-label="Close shortlist">
            <CloseIcon />
          </button>
        </div>

        {tabs.length > 1 && (
          <div className="tabs" role="tablist" aria-label="Shortlist sections">
            {tabs.map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                id={`tab-${t}`}
                aria-controls={`panel-${t}`}
                aria-selected={tab === t}
                tabIndex={tab === t ? 0 : -1}
                className={`tab${tab === t ? ' is-active' : ''}`}
                ref={(el) => {
                  tabRefs.current[t] = el;
                }}
                onClick={() => setTab(t)}
                onKeyDown={onTabKey}
              >
                {t === 'saved' ? `Saved names (${favourites.length})` : 'Recent briefs'}
              </button>
            ))}
          </div>
        )}

        {tab === 'saved' && (
          <div role={tabs.length > 1 ? 'tabpanel' : undefined} id="panel-saved" aria-labelledby={tabs.length > 1 ? 'tab-saved' : undefined} className="drawer__body">
            {favourites.length === 0 ? (
              <div className="drawer__empty">
                <p>No saved names yet.</p>
                <p className="muted">Press Save on any name card. Favourites are kept in this browser only.</p>
              </div>
            ) : (
              <>
                <ul className="fav-list">
                  {favourites.map((f) => (
                    <li key={f.name} className="fav">
                      <div>
                        <p className="fav__name">{f.name}</p>
                        <p className="fav__reason">{f.reason}</p>
                        <p className="fav__meta">{describe(f.context)}</p>
                      </div>
                      <div className="fav__actions">
                        <button type="button" className="icon-btn" onClick={() => props.onCopy(f.name)} aria-label={`Copy ${f.name}`}>
                          <CopyIcon />
                        </button>
                        <button type="button" className="icon-btn" onClick={() => props.onRemove(f.name)} aria-label={`Remove ${f.name}`}>
                          <CloseIcon />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
                <div className="drawer__foot">
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => props.onCopy(favourites.map((f) => f.name).join('\n'), `${favourites.length} names`)}
                  >
                    Copy all
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm btn--danger"
                    onClick={() => {
                      if (confirmClear) {
                        props.onClear();
                        setConfirmClear(false);
                      } else setConfirmClear(true);
                    }}
                  >
                    {confirmClear ? 'Press again to clear all' : 'Clear all'}
                  </button>
                </div>
              </>
            )}
            <p className="muted drawer__note">Saved in this browser only. Clearing site data removes them.</p>
          </div>
        )}

        {tab === 'history' && (
          <div role="tabpanel" id="panel-history" aria-labelledby="tab-history" className="drawer__body">
            {props.historyError && <p className="note note--error">{props.historyError}</p>}
            {!props.historyError && props.history === null && <p className="muted">Loading recent briefs…</p>}
            {props.history && props.history.length === 0 && (
              <div className="drawer__empty">
                <p>No recent briefs yet.</p>
                <p className="muted">Briefs you generate from this browser appear here.</p>
              </div>
            )}
            {props.history && props.history.length > 0 && (
              <>
                <ul className="fav-list">
                  {props.history.map((h) => (
                    <li key={h.id} className="fav">
                      <div>
                        <p className="fav__meta">
                          {describe(h.brief)} · {new Date(h.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                          {h.mode === 'demo' ? ' · demo' : ''}
                        </p>
                        <p className="fav__reason">
                          {h.brief.keywords.length ? `Keywords: ${h.brief.keywords.join(', ')}. ` : ''}
                          {h.names.slice(0, 5).join(', ')}
                          {h.names.length > 5 ? '…' : ''}
                        </p>
                      </div>
                      <div className="fav__actions">
                        <button type="button" className="btn btn--ghost btn--sm" onClick={() => props.onUseBrief(h.brief)}>
                          Load brief
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
                <div className="drawer__foot">
                  <button type="button" className="btn btn--ghost btn--sm btn--danger" onClick={props.onClearHistory}>
                    Clear recent briefs
                  </button>
                </div>
              </>
            )}
            <p className="muted drawer__note">Recent briefs are stored by the NameForge store service, linked to an anonymous ID for this browser.</p>
          </div>
        )}
      </div>
    </div>
  );
}
