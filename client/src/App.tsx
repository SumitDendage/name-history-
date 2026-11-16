import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  LIMITS,
  SAMPLE_BRIEF,
  TARGET_COUNT,
  type Brief,
  type GenerateRequest,
  type GenerateResponse,
  type HealthResponse,
  type HistoryEntry,
  type RefinementId,
  type Suggestion,
} from '../../shared/brief';
import { api, ApiError } from './api';
import { BriefForm } from './components/BriefForm';
import { Footer, Header, Hero, HowItWorks, Toast } from './components/Chrome';
import { Constellation, type ConstellationHandle } from './components/Constellation';
import { Drawer } from './components/Drawer';
import { Results, type Status } from './components/Results';
import { useFavourites } from './hooks/useFavourites';
import { useCompactMotion, useReducedMotion } from './hooks/useMediaQuery';
import { briefToForm, EMPTY_FORM, issuesToErrors, validateForm, type FieldErrors, type FieldName, type FormValues } from './lib/form';
import { getClientId } from './lib/storage';

const FIELD_ORDER: FieldName[] = ['type', 'nickname', 'style', 'keywords', 'requirements', 'maxLength', 'avoidChars'];
/** Let the orbit be seen for at least this long, even when the API answers instantly. */
const MIN_ORBIT_MS = 1100;

interface Pending {
  refinements: RefinementId[];
  likeName: string | null;
}

function focusField(name: FieldName) {
  const el =
    document.querySelector<HTMLInputElement>(`[data-field="${name}"]:checked`) ??
    document.querySelector<HTMLElement>(`[data-field="${name}"]`);
  el?.focus();
  el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}

export function App() {
  const reducedMotion = useReducedMotion();
  const compact = useCompactMotion();
  const clientId = useMemo(getClientId, []);
  const { favourites, isSaved, toggle, remove, clear } = useFavourites();

  const [values, setValues] = useState<FormValues>(EMPTY_FORM);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [sampleLoaded, setSampleLoaded] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [result, setResult] = useState<GenerateResponse | null>(null);
  const [activeBrief, setActiveBrief] = useState<Brief | null>(null);
  const [pending, setPending] = useState<Pending>({ refinements: [], likeName: null });
  const [error, setError] = useState<ApiError | null>(null);
  const [runId, setRunId] = useState(0);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [forceDemo, setForceDemo] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const constellation = useRef<ConstellationHandle>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastRun = useRef<{ request: GenerateRequest; brief: Brief; pending: Pending } | null>(null);
  const seenNames = useRef<string[]>([]);
  const shorterBase = useRef<string[] | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const drawerButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    api.health(controller.signal).then(setHealth, () => setHealth(null));
    return () => controller.abort();
  }, []);

  useEffect(() => {
    document.body.classList.toggle('has-drawer', drawerOpen);
  }, [drawerOpen]);

  const showToast = useCallback((message: string) => {
    window.clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  }, []);

  const onChange = useCallback(<K extends FieldName>(field: K, value: FormValues[K]) => {
    setValues((v) => ({ ...v, [field]: value }));
    setErrors((e) => (e[field] ? { ...e, [field]: undefined } : e));
  }, []);

  const run = useCallback(
    async (request: GenerateRequest, brief: Brief, next: Pending) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const payload: GenerateRequest = forceDemo ? { ...request, demo: true } : request;
      lastRun.current = { request: payload, brief, pending: next };

      setPending(next);
      setError(null);
      setStatus('loading');
      setAnnouncement('Forging names…');
      constellation.current?.gather();
      if (compact) {
        requestAnimationFrame(() =>
          document.getElementById('results')?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' }),
        );
      }

      try {
        const res = await api.generate(payload, controller.signal, clientId);
        await constellation.current?.settle(MIN_ORBIT_MS);
        if (controller.signal.aborted) return;
        seenNames.current = [...seenNames.current, ...res.suggestions.map((s) => s.name)].slice(-LIMITS.exclude);
        setResult(res);
        setActiveBrief(brief);
        setStatus('success');
        setRunId((r) => r + 1);
        setHistory(null);
        setAnnouncement(
          res.returned === 0
            ? 'No names passed your rules.'
            : `${res.returned} names ready${res.returned < TARGET_COUNT ? ` (fewer than ${TARGET_COUNT} fitted your rules)` : ''}.${res.mode === 'demo' ? ' Demo mode.' : ''}`,
        );
      } catch (e) {
        if (controller.signal.aborted) return;
        const err = e instanceof ApiError ? e : new ApiError('unknown', 'Something went wrong. Please try again.', true, 0);
        constellation.current?.release();
        setError(err);
        setStatus('error');
        setAnnouncement(err.message);
        if (err.issues.length) setErrors(issuesToErrors(err.issues));
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [clientId, compact, forceDemo, reducedMotion],
  );

  const submit = useCallback(() => {
    const { brief, errors: found } = validateForm(values);
    setErrors(found);
    if (!brief) {
      const first = FIELD_ORDER.find((f) => found[f]);
      setAnnouncement('Please fix the highlighted fields.');
      if (first) focusField(first);
      return;
    }
    seenNames.current = [];
    shorterBase.current = null;
    void run({ brief, refinements: [], exclude: [] }, brief, { refinements: [], likeName: null });
  }, [run, values]);

  const followUp = useCallback(
    (refinements: RefinementId[], likeName: string | null) => {
      if (!activeBrief || !result) return;
      if (refinements.includes('shorter') && !shorterBase.current) shorterBase.current = result.suggestions.map((s) => s.name);
      if (!refinements.includes('shorter')) shorterBase.current = null;
      const request: GenerateRequest = {
        brief: activeBrief, // the original brief is always kept when refining
        refinements,
        exclude: seenNames.current,
        ...(shorterBase.current ? { previous: shorterBase.current } : {}),
        ...(likeName ? { likeName } : {}),
      };
      void run(request, activeBrief, { refinements, likeName });
    },
    [activeBrief, result, run],
  );

  const refine = (id: RefinementId) => {
    if (!result) return;
    const current = result.refinements;
    const next = current.includes(id) ? current.filter((r) => r !== id) : [...current, id];
    followUp(next, result.likeName);
  };

  const cancel = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    constellation.current?.release();
    setStatus(result ? 'success' : 'idle');
    setAnnouncement('Cancelled.');
  };

  const retry = () => {
    const last = lastRun.current;
    if (last) void run(last.request, last.brief, last.pending);
  };

  const useDemo = () => {
    const last = lastRun.current;
    setForceDemo(true);
    if (last) void run({ ...last.request, demo: true }, last.brief, last.pending);
  };

  const editBrief = () => {
    document.getElementById('brief')?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
    const first = FIELD_ORDER.find((f) => errors[f]) ?? 'type';
    window.setTimeout(() => focusField(first), reducedMotion ? 0 : 450);
  };

  const loadBrief = (brief: Brief, message: string) => {
    setValues(briefToForm(brief));
    setErrors({});
    showToast(message);
    const form = document.getElementById('brief');
    if (form && form.getBoundingClientRect().top < -40) {
      form.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
    }
  };

  const loadSample = () => {
    loadBrief(SAMPLE_BRIEF, 'Sample brief loaded. Press Generate Names when ready.');
    setSampleLoaded(true);
  };

  const copy = async (text: string, label?: string) => {
    const ok = await copyText(text);
    showToast(ok ? `Copied ${label ?? `“${text}”`}` : "Couldn't copy. Select the name and copy it manually.");
  };

  const toggleSave = (s: Suggestion) => {
    if (!activeBrief) return;
    const saved = toggle({
      name: s.name,
      reason: s.reason,
      context: { type: activeBrief.type, market: activeBrief.market, style: activeBrief.style },
    });
    showToast(saved ? `Saved “${s.name}” to this browser` : `Removed “${s.name}”`);
  };

  const loadHistory = useCallback(async () => {
    setHistoryError(null);
    try {
      const res = await api.history(clientId);
      setHistory(res.entries);
    } catch {
      setHistoryError('Recent briefs are unavailable right now.');
    }
  }, [clientId]);

  const clearHistory = async () => {
    try {
      await api.clearHistory(clientId);
      setHistory([]);
      showToast('Recent briefs cleared');
    } catch {
      showToast("Couldn't clear recent briefs. Please try again.");
    }
  };

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
    window.setTimeout(() => drawerButtonRef.current?.focus(), 0);
  }, []);

  const busy = status === 'loading';
  const shownRefinements = busy ? pending.refinements : (result?.refinements ?? []);
  const shownLike = busy ? pending.likeName : (result?.likeName ?? null);

  return (
    <>
      <div className="backdrop" aria-hidden="true">
        <div className="backdrop__stars" />
        <div className="backdrop__stars backdrop__stars--far" />
        <div className="backdrop__glow" />
        <div className="backdrop__grain" />
      </div>

      <Header
        health={health && result ? { ...health, mode: result.mode } : health}
        savedCount={favourites.length}
        drawerOpen={drawerOpen}
        onOpenDrawer={() => setDrawerOpen(true)}
        drawerButtonRef={drawerButtonRef}
      />

      <main id="main">
        <Hero reducedMotion={reducedMotion} />

        <section className="studio" aria-label="Naming studio">
          <div className="studio__form">
            <BriefForm
              values={values}
              errors={errors}
              busy={busy}
              sampleLoaded={sampleLoaded}
              onChange={onChange}
              onSubmit={submit}
              onLoadSample={loadSample}
            />
          </div>
          <div className="studio__visual">
            <Constellation ref={constellation} style={values.style} reducedMotion={reducedMotion} compact={compact} busy={busy} />
          </div>
        </section>

        {forceDemo && health?.mode === 'ai' && (
          <p className="demo-switch">
            You switched to demo mode.{' '}
            <button type="button" className="link-btn" onClick={() => setForceDemo(false)}>
              Use AI again
            </button>
          </p>
        )}

        <Results
          status={status}
          result={result}
          brief={activeBrief}
          error={error}
          refinements={shownRefinements}
          likeName={shownLike}
          runId={runId}
          reducedMotion={reducedMotion}
          isSaved={isSaved}
          onCopy={(name) => void copy(name)}
          onToggleSave={toggleSave}
          onMoreLike={(name) => followUp(result?.refinements ?? [], name)}
          onRefine={refine}
          onClearLike={() => followUp(result?.refinements ?? [], null)}
          onRetry={retry}
          onUseDemo={useDemo}
          onEditBrief={editBrief}
          onCancel={cancel}
          onLoadSample={loadSample}
          onReveal={(titles, scrollTop) => {
            if (constellation.current) return constellation.current.unfoldTo(titles, scrollTop);
            window.scrollTo({ top: scrollTop, behavior: reducedMotion ? 'auto' : 'smooth' });
            return Promise.resolve();
          }}
        />

        <HowItWorks />
      </main>

      <Footer />

      <Drawer
        open={drawerOpen}
        onClose={closeDrawer}
        favourites={favourites}
        onCopy={(text, label) => void copy(text, label)}
        onRemove={(name) => {
          remove(name);
          showToast(`Removed “${name}”`);
        }}
        onClear={() => {
          clear();
          showToast('Favourites cleared');
        }}
        historyEnabled={health?.store === 'connected'}
        history={history}
        historyError={historyError}
        onLoadHistory={loadHistory}
        onClearHistory={() => void clearHistory()}
        onUseBrief={(brief) => {
          closeDrawer();
          loadBrief(brief, 'Brief loaded from your recent briefs.');
        }}
      />

      <Toast message={toast} />
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
    </>
  );
}
