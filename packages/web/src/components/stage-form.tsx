'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { StageDefinition, StageField } from '@nexora/core/stages';
import type { ActionableErrorShape } from '@nexora/core';

type Value = string | string[];
type StageData = Record<string, Value>;

interface Props {
  entityId: string;
  stage: StageDefinition;
  initialData: StageData;
  initialStatus: string;
  initialAutosaveAt: string | null;
}

function fieldValue(data: StageData, key: string): string {
  const v = data[key];
  if (Array.isArray(v)) return v.join('\n');
  return typeof v === 'string' ? v : '';
}

/**
 * One guided stage.
 *
 * Behaviour required by the specification:
 *  - autosave, so an interruption never loses work,
 *  - Continue (save as complete), Skip (explicitly not satisfied), and Back,
 *  - plain language, never entity-resolution terminology,
 *  - provider failures are reported as provider failures and never blame the person's data.
 */
export default function StageForm({ entityId, stage, initialData, initialStatus, initialAutosaveAt }: Props) {
  const [data, setData] = useState<StageData>(initialData);
  const [status, setStatus] = useState<string>(initialStatus);
  const [savedAt, setSavedAt] = useState<string | null>(initialAutosaveAt);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ActionableErrorShape | null>(null);
  const [message, setMessage] = useState<string | null>(null);
    /**
   * True only once the person has actually changed something.
   *
   * Autosave is gated on this. Without the gate, merely *opening* a stage rewrites its status to
   * `in_progress` about a second after mount, which silently downgrades a stage the person had
   * deliberately marked Complete or Skipped â€” and the readiness report reads exactly this column.
   */
  const [dirty, setDirty] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const save = useCallback(
    async (nextStatus: 'in_progress' | 'complete' | 'skipped', opts: { analyse?: boolean } = {}) => {
      setSaving(true);
      setError(null);
      try {
        const res = await fetch('/api/stages', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ entityId, stageKey: stage.key, status: nextStatus, data, analyse: opts.analyse ?? false }),
        });
        const body = (await res.json()) as { ok: boolean; error?: ActionableErrorShape };
        if (!body.ok) {
          setError(body.error ?? null);
          return false;
        }
        setStatus(nextStatus);
        setSavedAt(new Date().toISOString());
        setMessage(null);
        setDirty(false);
        return true;
      } catch {
        setError({
          code: 'network',
          domain: 'system',
          message: 'Your changes could not be saved just now. They are still on screen â€” try again in a moment.',
          retryable: true,
          remediation: [{ kind: 'retry', label: 'Try saving again', primary: true }],
          preservesUserProgress: true,
          severity: 'warning',
          status: 502,
          occurredAt: new Date().toISOString(),
        });
        return false;
      } finally {
        setSaving(false);
      }
    },
    [data, entityId, stage.key],
  );

// Autosave: debounced, and only after a real edit. Opening a stage must never write, otherwise
// simply viewing a stage the person had marked Complete or Skipped would undo that decision.
useEffect(() => {
    if (!dirty) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void save('in_progress');
    }, 1200);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [data, dirty, save]);

  function setField(key: string, value: Value) {
    setData((prev) => ({ ...prev, [key]: value }));
    setMessage(null);
    setDirty(true);
  }

  const filledCount = useMemo(() => {
    return stage.fields.filter((f) => {
      if (f.kind === 'file' || f.kind === 'photo') return false;
      const v = fieldValue(data, f.key).trim();
      return v.length > 0;
    }).length;
  }, [data, stage.fields]);

  const requiredFields = stage.fields.filter((f) => !f.optional);
  const requiredMissing = requiredFields.filter((f) => fieldValue(data, f.key).trim().length === 0);

  return (
    <div className="nx-stack" style={{ gap: '1.25rem' }}>
      <div>
        <div className="nx-row justify-between" style={{ alignItems: 'flex-start' }}>
          <div>
            <p className="nx-eyebrow">
              Stage {stage.letter} &middot; {stage.summary}
            </p>
            <h1 className="nx-title" style={{ marginTop: '0.3rem' }}>
              {stage.title}
            </h1>
          </div>
          <StatusBadge status={status} saving={saving} />
        </div>
        <p className="nx-subtitle" style={{ marginTop: '0.6rem' }}>
          {stage.whyItMatters}
        </p>
        {stage.requirement === 'evidence_minimum' ? (
          <div className="nx-notice nx-notice--info" style={{ marginTop: '0.75rem' }}>
            <p className="text-xs leading-relaxed">
              This stage carries one of Nexora Entity&rsquo;s internal evidence requirements. They are not requirements
              imposed by Google or any other search engine, and each entry is checked for quality rather than merely
              counted.
            </p>
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="nx-notice nx-notice--stop" role="alert">
          <p className="font-semibold">{error.message}</p>
          {error.detail ? <p className="mt-1 text-xs">{error.detail}</p> : null}
          <p className="mt-1 text-xs">Nothing you entered has been lost.</p>
          <div className="nx-row mt-2">
            {error.remediation.map((r, i) =>
              r.href ? (
                <a key={r.kind + i} href={r.href} className="nx-btn nx-btn--ghost nx-btn--sm">
                  {r.label}
                </a>
              ) : (
                <button
                  key={r.kind + i}
                  type="button"
                  className={`nx-btn nx-btn--sm ${r.primary ? 'nx-btn--primary' : 'nx-btn--ghost'}`}
                  onClick={() =>
                    // Re-assert the decision the person already made. A stage they marked
                    // Complete or Skipped must not be downgraded to In progress just because the
                    // save failed and they pressed "try again".
                    void save(status === 'complete' || status === 'skipped' ? status : 'in_progress')
                  }
                >
                  {r.label}
                </button>
              ),
            )}
          </div>
        </div>
      ) : null}

      {message ? (
        <div className="nx-notice nx-notice--info" role="status">
          {message}
        </div>
      ) : null}

      <div className="nx-card nx-card--pad nx-stack">
        {stage.fields.map((field) => (
          <Field key={field.key} field={field} value={data[field.key]} onChange={(v) => setField(field.key, v)} entityId={entityId} />
        ))}
      </div>

      <div className="nx-card nx-card--pad nx-stack">
        <div className="nx-row justify-between">
          <p className="nx-help">
            {saving ? 'Savingâ€¦' : savedAt ? `Autosaved ${new Date(savedAt).toLocaleTimeString()}` : 'Autosaves as you type'}
            {filledCount > 0 ? ` Â· ${filledCount} field${filledCount === 1 ? '' : 's'} filled` : ''}
          </p>
          {requiredMissing.length > 0 && status !== 'skipped' ? (
            <p className="nx-help">
              Still to complete here: {requiredMissing.map((f) => f.label.toLowerCase()).join(', ')}
            </p>
          ) : null}
        </div>

        <div className="nx-row justify-between">
          <button type="button" className="nx-btn nx-btn--ghost" disabled={saving} onClick={() => void save('skipped')}>
            Skip for now
          </button>
          <div className="nx-row">
            <span className="nx-help">Skipping does not mark this stage satisfied.</span>
            <button
              type="button"
              className="nx-btn nx-btn--accent"
              disabled={saving}
              onClick={async () => {
                const ok = await save('complete', { analyse: true });
                if (ok) setMessage('Saved. Nexora Entity is checking your sources in the background.');
              }}
            >
              Continue
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status, saving }: { status: string; saving: boolean }) {
  const map: Record<string, { label: string; cls: string }> = {
    complete: { label: 'Complete', cls: 'nx-badge--good' },
    skipped: { label: 'Skipped â€” not satisfied', cls: 'nx-badge--warn' },
    in_progress: { label: 'In progress', cls: 'nx-badge--accent' },
    pending: { label: 'Not started', cls: '' },
  };
  const entry = map[status] ?? map['pending']!;
  return (
    <span className={`nx-badge ${entry.cls}`}>
      {saving ? 'Savingâ€¦' : entry.label}
    </span>
  );
}

function Field({
  field,
  value,
  onChange,
  entityId,
}: {
  field: StageField;
  value: Value | undefined;
  onChange: (v: Value) => void;
  entityId: string;
}) {
  const text = Array.isArray(value) ? value.join('\n') : (value ?? '');

  if (field.kind === 'photo') {
    return <PhotoUploader entityId={entityId} field={field} />;
  }
  if (field.kind === 'file') {
    return <PortfolioUploader entityId={entityId} field={field} />;
  }

  return (
    <div className="nx-field">
      <label className="nx-label" htmlFor={field.key}>
        {field.label}
        {field.optional ? <span className="ml-1.5 text-xs font-normal text-ink-400">optional</span> : null}
      </label>
      {field.kind === 'longtext' ? (
        <textarea
          id={field.key}
          className="nx-textarea"
          placeholder={field.placeholder}
          value={text}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : field.kind === 'list' || field.kind === 'url_list' || field.kind === 'tags' ? (
        <textarea
          id={field.key}
          className="nx-textarea"
          style={{ minHeight: field.kind === 'url_list' ? '6rem' : '5rem' }}
          placeholder={field.placeholder ?? `One ${(field.itemLabel ?? 'item').toLowerCase()} per line`}
          value={text}
          onChange={(e) => onChange(e.target.value)}
          aria-describedby={`${field.key}-help`}
        />
      ) : (
        <input
          id={field.key}
          className="nx-input"
          type={field.kind === 'date' ? 'date' : 'text'}
          placeholder={field.placeholder}
          value={text}
          onChange={(e) => onChange(e.target.value)}
          aria-describedby={field.help ? `${field.key}-help` : undefined}
        />
      )}
      {field.help ? (
        <p className="nx-help" id={`${field.key}-help`}>
          {field.help}
        </p>
      ) : field.kind === 'list' ? (
        <p className="nx-help">One per line. Order is preserved on your public site.</p>
      ) : null}
    </div>
  );
}

interface UploadState {
  busy: boolean;
  error: ActionableErrorShape | null;
  items: { label: string; ok: boolean; detail: string }[];
}

function PhotoUploader({ entityId, field }: { entityId: string; field: StageField }) {
  const [state, setState] = useState<UploadState>({ busy: false, error: null, items: [] });
  const inputRef = useRef<HTMLInputElement>(null);

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setState({ busy: true, error: null, items: [] });
    const form = new FormData();
    for (const f of Array.from(files)) form.append('files', f);
    try {
      const res = await fetch(`/api/entities/${entityId}/photos`, { method: 'POST', body: form });
      const body = (await res.json()) as { ok: boolean; error?: ActionableErrorShape; data?: { results: UploadState['items'] } };
      if (!body.ok) {
        setState({ busy: false, error: body.error ?? null, items: [] });
        return;
      }
      setState({ busy: false, error: null, items: body.data?.results ?? [] });
      if (inputRef.current) inputRef.current.value = '';
    } catch {
      setState({
        busy: false,
        error: {
          code: 'network',
          domain: 'system',
          message: 'The upload could not be completed. Your other information is unaffected.',
          retryable: true,
          remediation: [{ kind: 'retry', label: 'Try the upload again', primary: true }],
          preservesUserProgress: true,
          severity: 'warning',
          status: 502,
          occurredAt: new Date().toISOString(),
        },
        items: [],
      });
    }
  }

  const qualifying = state.items.filter((i) => i.ok).length;

  return (
    <div className="nx-field">
      <span className="nx-label">{field.label}</span>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic"
        multiple
        className="nx-input"
        onChange={(e) => void upload(e.target.files)}
        disabled={state.busy}
        aria-describedby="photo-help"
      />
      <p className="nx-help" id="photo-help">
        {field.help ?? 'A clear primary portrait plus supporting photographs work best.'} Each upload is checked for
        validity, resolution and duplication. Nexora Entity does not run biometric face matching.
      </p>
      {state.busy ? <p className="nx-help">Checking your uploadsâ€¦</p> : null}
      {state.error ? (
        <div className="nx-notice nx-notice--stop" role="alert">
          <p className="text-xs font-semibold">{state.error.message}</p>
        </div>
      ) : null}
      {state.items.length > 0 ? (
        <div className="nx-stack-sm">
          <p className="nx-help">
            {qualifying} of {state.items.length} uploaded photo{state.items.length === 1 ? '' : 's'} qualify toward the
            minimum.
          </p>
          <ul className="nx-stack-sm" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {state.items.map((item, i) => (
              <li key={i} className="nx-row items-start gap-2 text-xs">
                <span className={`nx-badge ${item.ok ? 'nx-badge--good' : 'nx-badge--warn'}`}>
                  {item.ok ? 'Counts' : 'Not counted'}
                </span>
                <span className="min-w-0 flex-1 text-ink-600">
                  <span className="font-medium">{item.label}</span> â€” {item.detail}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function PortfolioUploader({ entityId, field }: { entityId: string; field: StageField }) {
  const [state, setState] = useState<UploadState>({ busy: false, error: null, items: [] });
  const [discovered, setDiscovered] = useState<{ value: string; context: string }[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setState({ busy: true, error: null, items: [] });
    const form = new FormData();
    for (const f of Array.from(files)) form.append('files', f);
    try {
      const res = await fetch(`/api/entities/${entityId}/portfolio`, { method: 'POST', body: form });
      const body = (await res.json()) as {
        ok: boolean;
        error?: ActionableErrorShape;
        data?: { results: UploadState['items']; candidates: { value: string; context: string }[] };
      };
      if (!body.ok) {
        setState({ busy: false, error: body.error ?? null, items: [] });
        return;
      }
      setState({ busy: false, error: null, items: body.data?.results ?? [] });
      setDiscovered(body.data?.candidates ?? []);
      if (inputRef.current) inputRef.current.value = '';
    } catch {
      setState({
        busy: false,
        error: {
          code: 'network',
          domain: 'system',
          message: 'The portfolio upload could not be completed. Nothing else was affected.',
          retryable: true,
          remediation: [{ kind: 'retry', label: 'Try again', primary: true }],
          preservesUserProgress: true,
          severity: 'warning',
          status: 502,
          occurredAt: new Date().toISOString(),
        },
        items: [],
      });
    }
  }

  return (
    <div className="nx-field">
      <span className="nx-label">{field.label}</span>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.docx,.md,.txt,.csv,image/*"
        multiple
        className="nx-input"
        onChange={(e) => void upload(e.target.files)}
        disabled={state.busy}
      />
      <p className="nx-help">
        {field.help ?? 'PDF, Word, Markdown, plain text, CSV and images are supported.'} Anything found in your portfolio
        is treated as information you supplied. Nothing from it is published until you accept it, and a portfolio never
        replaces the five-website minimum.
      </p>
      {state.busy ? <p className="nx-help">Reading your portfolioâ€¦</p> : null}
      {state.error ? (
        <div className="nx-notice nx-notice--stop" role="alert">
          <p className="text-xs font-semibold">{state.error.message}</p>
        </div>
      ) : null}
      {state.items.map((item, i) => (
        <p key={i} className="nx-help">
          <span className="font-medium">{item.label}</span> â€” {item.detail}
        </p>
      ))}
      {discovered.length > 0 ? (
        <div className="nx-notice nx-notice--info">
          <p className="text-xs font-semibold">Found in your portfolio â€” review before anything is published</p>
          <ul className="nx-stack-sm mt-1" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {discovered.slice(0, 8).map((d, i) => (
              <li key={i} className="text-xs leading-relaxed">
                <span className="font-medium">{d.value}</span> â€” {d.context}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs">These are queued for review in your review queue.</p>
        </div>
      ) : null}
    </div>
  );
}