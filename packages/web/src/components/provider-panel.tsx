'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ActionableErrorShape } from '@nexora/core';

export interface ProviderOption {
  id: string;
  name: string;
  connected: boolean;
  credentialRequirement: 'none' | 'optional' | 'required';
  envVars: string[];
  authMethods: { type: string; label: string }[];
  modelCount: number;
  defaultModelId: string | null;
  notice: string | null;
  models: {
    id: string;
    name: string;
    family: string | null;
    contextWindow: number | null;
    reasoning: boolean;
    isFree: boolean;
    releaseDate: string | null;
  }[];
}

export interface CatalogueResponse {
  ok: true;
  data: {
    opencodeVersion: string | null;
    fetchedAt: string;
    durationMs: number;
    totals: { providers: number; connectedProviders: number; usableModels: number; freeModels: number };
    providers: ProviderOption[];
  };
}

export interface ActiveConfig {
  providerId: string;
  providerName: string;
  modelId: string;
  modelName: string;
  verifiedAt: string | null;
  lastError: string | null;
  lastErrorCode: string | null;
}

interface Props {
  active: ActiveConfig | null;
  open: boolean;
  onClose: () => void;
  onVerified: (config: ActiveConfig) => void;
}

/**
 * AI provider and model panel.
 *
 * Availability is read live from OpenCode on every open: no provider list is stored in the
 * platform. A selection is only accepted after a real test call succeeds. If the active
 * configuration fails, the failure is reported as a provider failure with the option to
 * change provider from this same screen — never as a problem with the person's entity data.
 */
export default function ProviderPanel({ active, open, onClose, onVerified }: Props) {
  const [catalogue, setCatalogue] = useState<CatalogueResponse['data'] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<ActionableErrorShape | null>(null);
  const [providerId, setProviderId] = useState<string | null>(null);
  const [modelId, setModelId] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<ActionableErrorShape | null>(null);
  const [search, setSearch] = useState('');
  const [showDisconnected, setShowDisconnected] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/ai/providers', { cache: 'no-store' });
      const body = (await res.json()) as CatalogueResponse | { ok: false; error: ActionableErrorShape };
      if (!body.ok) {
        setLoadError(body.error);
        return;
      }
      setCatalogue(body.data);
      setProviderId((current) => current ?? body.data.providers.find((p) => p.connected)?.id ?? null);
    } catch {
      setLoadError({
        code: 'network',
        domain: 'ai_provider',
        message: 'The AI bridge could not be reached. Your entity work has not been affected.',
        retryable: true,
        remediation: [{ kind: 'retry', label: 'Try again', primary: true }],
        preservesUserProgress: true,
        severity: 'warning',
        status: 502,
        occurredAt: new Date().toISOString(),
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const providers = useMemo(() => {
    if (!catalogue) return [];
    const q = search.trim().toLowerCase();
    return catalogue.providers.filter((p) => {
      if (!showDisconnected && !p.connected) return false;
      if (!q) return true;
      return p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q);
    });
  }, [catalogue, search, showDisconnected]);

  const selected = providers.find((p) => p.id === providerId) ?? catalogue?.providers.find((p) => p.id === providerId) ?? null;

  async function verify() {
    if (!selected || !modelId) return;
    setVerifying(true);
    setVerifyError(null);
    try {
      const res = await fetch('/api/ai/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ providerId: selected.id, modelId }),
      });
      const body = (await res.json()) as
        | { ok: true; data: { providerName: string; modelName: string; latencyMs: number; verifiedAt: string } }
        | { ok: false; error: ActionableErrorShape };
      if (!body.ok) {
        setVerifyError(body.error);
        return;
      }
      onVerified({
        providerId: selected.id,
        providerName: body.data.providerName,
        modelId,
        modelName: body.data.modelName,
        verifiedAt: body.data.verifiedAt,
        lastError: null,
        lastErrorCode: null,
      });
      onClose();
    } catch {
      setVerifyError({
        code: 'network',
        domain: 'ai_provider',
        message: 'The verification request could not be sent. Your entity work is untouched.',
        retryable: true,
        remediation: [{ kind: 'retry', label: 'Try again', primary: true }],
        preservesUserProgress: true,
        severity: 'warning',
        status: 502,
        occurredAt: new Date().toISOString(),
      });
    } finally {
      setVerifying(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink-950/40 p-0 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label="AI provider and model">
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-ink-100 p-5">
          <div>
            <p className="nx-eyebrow">AI configuration</p>
            <h2 className="nx-title" style={{ fontSize: '1.25rem', marginTop: '0.2rem' }}>
              Choose your AI provider and model
            </h2>
            <p className="nx-help" style={{ marginTop: '0.25rem', maxWidth: '58ch' }}>
              Availability is read live from OpenCode. Nothing is hard-coded, so anything OpenCode adds or removes appears
              here immediately. A model is only accepted after a real test call succeeds.
            </p>
          </div>
          <button type="button" className="nx-btn nx-btn--quiet nx-btn--sm" onClick={onClose} aria-label="Close provider panel">
            Close
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {active?.lastError ? (
            <div className="nx-notice nx-notice--stop" role="alert" style={{ marginBottom: '1rem' }}>
              <p className="font-semibold">The active configuration is failing.</p>
              <p className="mt-1 text-xs leading-relaxed">
                {active.lastError}
                {active.lastErrorCode ? ` (${active.lastErrorCode})` : ''}
              </p>
              <p className="mt-1 text-xs">
                This is a provider problem, not a problem with your entity information. Everything you have entered is
                intact. Choose a replacement below and you will continue from exactly where you stopped.
              </p>
            </div>
          ) : null}

          {loadError ? (
            <div className="nx-notice nx-notice--stop" role="alert" style={{ marginBottom: '1rem' }}>
              <p className="font-semibold">{loadError.message}</p>
              {loadError.detail ? <p className="mt-1 text-xs">{loadError.detail}</p> : null}
              <button type="button" className="nx-btn nx-btn--ghost nx-btn--sm mt-2" onClick={() => void load()}>
                Try again
              </button>
            </div>
          ) : null}

          {catalogue ? (
            <div className="nx-stack" style={{ gap: '0.75rem' }}>
              <div className="nx-row justify-between">
                <p className="nx-help">
                  OpenCode {catalogue.opencodeVersion ?? ''} &middot; {catalogue.totals.providers} providers exposed &middot;{' '}
                  {catalogue.totals.connectedProviders} with usable credentials &middot; {catalogue.totals.usableModels}{' '}
                  usable text models ({catalogue.totals.freeModels} free) &middot; refreshed in{' '}
                  {catalogue.durationMs}ms
                </p>
                <button type="button" className="nx-btn nx-btn--ghost nx-btn--sm" onClick={() => void load()} disabled={loading}>
                  {loading ? 'Refreshing…' : 'Refresh'}
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <input
                  className="nx-input"
                  style={{ maxWidth: '18rem' }}
                  placeholder="Search providers…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label="Search providers"
                />
                <label className="nx-row gap-1.5 text-xs text-ink-500">
                  <input type="checkbox" checked={showDisconnected} onChange={(e) => setShowDisconnected(e.target.checked)} />
                  Show providers that need credentials
                </label>
              </div>

              {loading && providers.length === 0 ? (
                <div className="nx-stack-sm">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="nx-skeleton" style={{ height: '2.5rem' }} />
                  ))}
                </div>
              ) : null}

              <div className="grid gap-3 sm:grid-cols-2">
                {providers.slice(0, 60).map((p) => {
                  const isActive = providerId === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setProviderId(p.id);
                        setModelId(p.defaultModelId ?? p.models[0]?.id ?? null);
                        setVerifyError(null);
                      }}
                      className="nx-card nx-card--pad text-left transition"
                      style={{
                        borderColor: isActive ? 'var(--color-accent-600)' : undefined,
                        boxShadow: isActive ? '0 0 0 3px var(--color-accent-50)' : undefined,
                      }}
                      aria-pressed={isActive}
                    >
                      <div className="nx-row justify-between">
                        <span className="text-sm font-semibold text-ink-900">{p.name}</span>
                        <span className={`nx-badge ${p.connected ? 'nx-badge--good' : 'nx-badge--warn'}`}>
                          {p.connected ? 'Usable now' : 'Needs credentials'}
                        </span>
                      </div>
                      <p className="nx-help" style={{ marginTop: '0.25rem' }}>
                        {p.connected
                          ? `${p.models.length} text model${p.models.length === 1 ? '' : 's'} · ${p.models.filter((m) => m.isFree).length} free`
                          : (p.notice ?? 'OpenCode has not reported usable credentials for this provider.')}
                      </p>
                    </button>
                  );
                })}
              </div>

              {selected ? (
                <div className="nx-card nx-card--pad nx-stack">
                  <div>
                    <p className="nx-eyebrow">Model for {selected.name}</p>
                    <p className="nx-help">
                      Only models that accept text and produce text are offered. Nothing is assumed about tools or images.
                    </p>
                  </div>
                  <div className="nx-stack-sm" style={{ maxHeight: '15rem', overflowY: 'auto' }}>
                    {selected.models.length === 0 ? (
                      <p className="nx-help">
                        No usable text models are exposed for this provider right now. Choose another provider.
                      </p>
                    ) : null}
                    {selected.models.slice(0, 40).map((m) => (
                      <label
                        key={m.id}
                        className="nx-row flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-ink-50"
                        style={{ background: modelId === m.id ? 'var(--color-accent-50)' : undefined }}
                      >
                        <input
                          type="radio"
                          name="model"
                          value={m.id}
                          checked={modelId === m.id}
                          onChange={() => setModelId(m.id)}
                          disabled={!selected.connected}
                        />
                        <span className="min-w-0 flex-1 truncate text-ink-800">{m.name}</span>
                        <span className="nx-badge">{m.contextWindow ? `${Math.round(m.contextWindow / 1000)}k ctx` : 'ctx unknown'}</span>
                        {m.isFree ? <span className="nx-badge nx-badge--good">Free</span> : null}
                        {m.reasoning ? <span className="nx-badge">Reasoning</span> : null}
                      </label>
                    ))}
                  </div>
                  {!selected.connected ? (
                    <div className="nx-notice nx-notice--warn">
                      <p className="text-xs leading-relaxed">
                        OpenCode has not reported usable credentials for {selected.name}
                        {selected.envVars.length > 0 ? ` (${selected.envVars.join(', ')})` : ''}. You can still select it,
                        but verification will fail until credentials exist. Everything else in Nexora Entity keeps working
                        without AI.
                      </p>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {verifyError ? (
                <div className="nx-notice nx-notice--stop" role="alert">
                  <p className="font-semibold">{verifyError.message}</p>
                  {verifyError.detail ? <p className="mt-1 text-xs">{verifyError.detail}</p> : null}
                  <p className="mt-1 text-xs">
                    Your entity information has not changed and nothing was lost. Choose a different provider or model and
                    continue.
                  </p>
                  <div className="nx-row mt-2">
                    {verifyError.remediation.map((r, i) => (
                      <button
                        key={r.kind + i}
                        type="button"
                        className={`nx-btn nx-btn--sm ${r.primary ? 'nx-btn--primary' : 'nx-btn--ghost'}`}
                        onClick={() => void verify()}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : loading ? (
            <div className="nx-stack-sm">
              {[0, 1, 2].map((i) => (
                <div key={i} className="nx-skeleton" style={{ height: '2.5rem' }} />
              ))}
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-100 p-5">
          <p className="nx-help">
            Your verified choice becomes your account&rsquo;s active AI configuration and powers every AI-assisted step
            until you change it.
          </p>
          <div className="nx-row">
            <button type="button" className="nx-btn nx-btn--ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="nx-btn nx-btn--accent"
              disabled={!selected || !modelId || !selected.connected || verifying}
              onClick={() => void verify()}
            >
              {verifying ? 'Testing this model…' : 'Verify and use this model'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}