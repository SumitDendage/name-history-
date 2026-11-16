import { useId, type FormEvent, type KeyboardEvent } from 'react';
import { LIMITS, MARKETS, NAMING_TYPES, STYLES } from '../../../shared/brief';
import { defaultMaxFor, parseKeywords, type FieldErrors, type FieldName, type FormValues } from '../lib/form';
import { TypeIcon } from './Icons';

interface Props {
  values: FormValues;
  errors: FieldErrors;
  busy: boolean;
  sampleLoaded: boolean;
  onChange: <K extends FieldName>(field: K, value: FormValues[K]) => void;
  onSubmit: () => void;
  onLoadSample: () => void;
}

export function BriefForm({ values, errors, busy, sampleLoaded, onChange, onSubmit, onLoadSample }: Props) {
  const uid = useId();
  const id = (name: string) => `${uid}-${name}`;
  const keywords = parseKeywords(values.keywords);
  const defaultMax = defaultMaxFor(values.type);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit();
  };

  // Ctrl/Cmd + Enter submits from anywhere in the form, including the textarea.
  const onKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      onSubmit();
    }
  };

  const describedBy = (name: FieldName, hint = true) =>
    [hint ? id(`${name}-hint`) : '', errors[name] ? id(`${name}-error`) : ''].filter(Boolean).join(' ') || undefined;

  const ErrorText = ({ name }: { name: FieldName }) =>
    errors[name] ? (
      <p className="field__error" id={id(`${name}-error`)}>
        {errors[name]}
      </p>
    ) : null;

  return (
    <form className="brief" id="brief" onSubmit={submit} onKeyDown={onKeyDown} noValidate aria-labelledby={id('title')}>
      <div className="brief__head">
        <p className="eyebrow">
          <span className="eyebrow__num">01</span> The brief
        </p>
        <h2 className="brief__title" id={id('title')}>
          Tell us what you’re naming
        </h2>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onLoadSample} disabled={busy}>
          {sampleLoaded ? 'Sample brief loaded' : 'Load sample brief'}
        </button>
      </div>

      <fieldset className="field" aria-describedby={describedBy('type', false)} aria-invalid={Boolean(errors.type)}>
        <legend className="field__label" id="field-type">
          What are you naming?
        </legend>
        <div className="type-grid">
          {NAMING_TYPES.map((t) => (
            <label key={t.id} className="choice choice--card">
              <input
                type="radio"
                name="type"
                value={t.id}
                checked={values.type === t.id}
                onChange={() => onChange('type', t.id)}
                className="sr-only"
                data-field="type"
              />
              <span className="choice__body">
                <TypeIcon type={t.id} className="choice__icon" />
                <span className="choice__title">{t.label}</span>
                <span className="choice__hint">{t.hint}</span>
              </span>
            </label>
          ))}
        </div>
        <ErrorText name="type" />
      </fieldset>

      <div className="field">
        <label className="field__label" htmlFor={id('nickname')}>
          Name or nickname <span className="field__optional">optional</span>
        </label>
        <input
          id={id('nickname')}
          className="input"
          data-field="nickname"
          value={values.nickname}
          maxLength={LIMITS.nickname}
          autoComplete="off"
          placeholder="e.g. Ananya, ShadowFox, Bloom"
          aria-describedby={describedBy('nickname')}
          aria-invalid={Boolean(errors.nickname)}
          onChange={(e) => onChange('nickname', e.target.value)}
        />
        <p className="field__hint" id={id('nickname-hint')}>
          A starting point we can riff on. Leave blank for fresh ideas.
        </p>
        <ErrorText name="nickname" />
      </div>

      <fieldset className="field">
        <legend className="field__label">Target market</legend>
        <div className="segmented" role="presentation">
          {MARKETS.map((m) => (
            <label key={m.id} className="choice choice--segment">
              <input
                type="radio"
                name="market"
                value={m.id}
                checked={values.market === m.id}
                onChange={() => onChange('market', m.id)}
                className="sr-only"
                data-field="market"
              />
              <span className="choice__body">
                <span className="choice__title">{m.label}</span>
                <span className="choice__hint">{m.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="field" aria-describedby={describedBy('style', false)} aria-invalid={Boolean(errors.style)}>
        <legend className="field__label">Style</legend>
        <div className="chips">
          {STYLES.map((s) => (
            <label key={s.id} className="choice choice--chip" title={s.hint}>
              <input
                type="radio"
                name="style"
                value={s.id}
                checked={values.style === s.id}
                onChange={() => onChange('style', s.id)}
                className="sr-only"
                data-field="style"
              />
              <span className="choice__body">
                <span className={`choice__title style-word style-word--${s.id}`}>{s.label}</span>
                <span className="sr-only">: {s.hint}</span>
              </span>
            </label>
          ))}
        </div>
        <ErrorText name="style" />
      </fieldset>

      <div className="field">
        <label className="field__label" htmlFor={id('keywords')}>
          Keywords <span className="field__optional">optional</span>
        </label>
        <input
          id={id('keywords')}
          className="input"
          data-field="keywords"
          value={values.keywords}
          autoComplete="off"
          placeholder="glow, gentle, ritual"
          aria-describedby={describedBy('keywords')}
          aria-invalid={Boolean(errors.keywords)}
          onChange={(e) => onChange('keywords', e.target.value)}
        />
        <p className="field__hint" id={id('keywords-hint')}>
          Separate with commas. Up to {LIMITS.keywords}.
        </p>
        {keywords.length > 0 && (
          <ul className="tags" aria-label="Keywords">
            {keywords.slice(0, LIMITS.keywords + 2).map((k) => (
              <li key={k} className="tag">
                {k}
              </li>
            ))}
          </ul>
        )}
        <ErrorText name="keywords" />
      </div>

      <div className="field">
        <label className="field__label" htmlFor={id('requirements')}>
          Specific requirements <span className="field__optional">optional</span>
        </label>
        <textarea
          id={id('requirements')}
          className="input input--area"
          data-field="requirements"
          rows={3}
          value={values.requirements}
          maxLength={LIMITS.requirements + 50}
          placeholder="Must work as an Instagram handle, avoid anything that sounds medical, should feel warm…"
          aria-describedby={describedBy('requirements')}
          aria-invalid={Boolean(errors.requirements)}
          onChange={(e) => onChange('requirements', e.target.value)}
        />
        <p className="field__hint field__hint--split" id={id('requirements-hint')}>
          <span>Anything the names must (or must not) do.</span>
          <span className={values.requirements.length > LIMITS.requirements ? 'is-over' : ''}>
            {values.requirements.length}/{LIMITS.requirements}
          </span>
        </p>
        <ErrorText name="requirements" />
      </div>

      <fieldset className="field rules">
        <legend className="field__label">Rules we enforce</legend>
        <div className="rules__grid">
          <div>
            <label className="field__sublabel" htmlFor={id('maxLength')}>
              Max length
            </label>
            <input
              id={id('maxLength')}
              className="input input--num"
              data-field="maxLength"
              inputMode="numeric"
              value={values.maxLength}
              placeholder={defaultMax ? String(defaultMax) : '—'}
              aria-describedby={describedBy('maxLength')}
              aria-invalid={Boolean(errors.maxLength)}
              onChange={(e) => onChange('maxLength', e.target.value.replace(/[^\d]/g, '').slice(0, 2))}
            />
            <p className="field__hint" id={id('maxLength-hint')}>
              Characters, {LIMITS.maxLengthFloor}–{LIMITS.maxLengthCeiling}.{defaultMax ? ` Default ${defaultMax}.` : ''}
            </p>
            <ErrorText name="maxLength" />
          </div>
          <div>
            <label className="field__sublabel" htmlFor={id('avoidChars')}>
              Characters to avoid
            </label>
            <input
              id={id('avoidChars')}
              className="input"
              data-field="avoidChars"
              value={values.avoidChars}
              autoComplete="off"
              placeholder="e.g. x z _"
              aria-describedby={describedBy('avoidChars')}
              aria-invalid={Boolean(errors.avoidChars)}
              onChange={(e) => onChange('avoidChars', e.target.value)}
            />
            <p className="field__hint" id={id('avoidChars-hint')}>
              Any name using these is removed.
            </p>
            <ErrorText name="avoidChars" />
          </div>
        </div>
      </fieldset>

      <div className="brief__actions">
        <button type="submit" className="btn btn--primary btn--lg" disabled={busy} aria-describedby={id('submit-hint')}>
          {busy ? (
            <>
              <span className="btn__spinner" aria-hidden="true" /> Forging names…
            </>
          ) : (
            'Generate Names'
          )}
        </button>
        <p className="brief__note" id={id('submit-hint')}>
          12 suggestions, checked against your rules. <kbd>Ctrl</kbd> + <kbd>Enter</kbd> works too.
        </p>
      </div>
    </form>
  );
}
