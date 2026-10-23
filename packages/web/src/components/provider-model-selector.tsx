'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  filterFreeModels,
  filterProviderModels,
  filterProviders,
  orderProviders,
  providerForFreeModel,
  providerNeedsKey,
} from '@/lib/provider-selection';

export interface DiscoveredModel {
  id: string;
  name: string;
  contextWindow: number | null;
  reasoning: boolean;
  isFree: boolean;
}

export interface DiscoveredProvider {
  id: string;
  name: string;
  connected: boolean;
  credentialRequirement: 'none' | 'optional' | 'required';
  envVars: string[];
  authMethods: { type: string; label: string }[];
  modelCount: number;
  defaultModelId: string | null;
  models: DiscoveredModel[];
  notice: string | null;
}

export interface FreeModel {
  id: string;
  name: string;
  providerId: string;
  providerName: string;
  contextWindow: number | null;
  reasoning: boolean;
}

export interface Catalogue {
  opencodeVersion: string | null;
  fetchedAt: string;
  durationMs: number;
  providers: DiscoveredProvider[];
  freeModels: FreeModel[];
  totals: { providers: number; connectedProviders: number; usableModels: number; freeModels: number };
}

interface Props {
  /** The catalogue, when it is already known. The component fetches it when it is not. */
  catalogue?: Catalogue | null;
  /**
   * Called with the catalogue once it is known.
   *
   * The panel shows a summary of what OpenCode is exposing, and it reads that from here rather
   * than asking OpenCode a second time.
   */
  onCatalogue?: (catalogue: Catalogue) => void;
  /** The provider/model currently active for the account. */
  active?: { providerId: string; modelId: string } | null;
  onVerified?: (result: { providerName: string; modelName: string }) => void;
  onClose?: () => void;
}

/**
 * The provider and model selection page.
 *
 * The layout is a single vertical surface in a fixed order:
 *
 *   1. the free models that need no key,
 *   2. the provider,
 *   3. the API key, when that provider needs one,
 *   4. the model, from that provider.
 *
 * The free list and the provider list are two views of the same catalogue: a free model is one
 * the platform can already reach, so choosing it does not require another provider's key.
 */
export default function ProviderModelSelector({
  catalogue: provided,
  onCatalogue,
  active,
  onVerified,
  onClose,
}: Props) {
  const [catalogue, setCatalogue] = useState<Catalogue | null>(provided ?? null);
  const [loading, setLoading] = useState(!provided);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);

  const [providerId, setProviderId] = useState<string | null>(active?.providerId ?? null);
  const [modelId, setModelId] = useState<string | null>(active?.modelId ?? null);
  const [apiKey, setApiKey] = useState('');
  const [freeSearch, setFreeSearch] = useState('');
  const [providerSearch, setProviderSearch] = useState('');
  const [modelSearch, setModelSearch] = useState('');

  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [verified, setVerified] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/ai/providers');
      const body = (await res.json()) as {
        ok: boolean;
        data?: Catalogue;
        error?: { message?: string; staleSnapshot?: unknown };
      };
      if (!body.ok || !body.data) {
        setLoadError(body.error?.message ?? 'The provider list could not be loaded.');
        setStale(Boolean(body.error?.staleSnapshot));
        return;
      }
      setCatalogue(body.data);
      setStale(false);
      onCatalogue?.(body.data);
    } catch {
      setLoadError('The provider list could not be loaded. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [onCatalogue]);

  useEffect(() => {
    if (provided) {
      setCatalogue(provided);
      setLoading(false);
      onCatalogue?.(provided);
      return;
    }
    void load();
  }, [provided, load, onCatalogue]);

  const providers = useMemo(() => catalogue?.providers ?? [], [catalogue]);
  const freeModels = useMemo(() => catalogue?.freeModels ?? [], [catalogue]);

  const provider = useMemo(
    () => providers.find((p) => p.id === providerId) ?? null,
    [providers, providerId],
  );

  /** OpenCode is offered first, because it is the provider the platform already reaches. */
  const orderedProviders = useMemo(() => orderProviders(providers), [providers]);

  const filteredFree = useMemo(() => filterFreeModels(freeModels, freeSearch), [freeModels, freeSearch]);

  const filteredProviders = useMemo(() => filterProviders(orderedProviders, providerSearch), [orderedProviders, providerSearch]);

  const providerModels = useMemo(() => filterProviderModels(provider, modelSearch), [provider, modelSearch]);

  /** Whether the selected provider needs a key of its own. */
  const needsKey = useMemo(() => providerNeedsKey(provider), [provider]);

  function chooseFreeModel(model: FreeModel) {
    const chosen = providerForFreeModel(model);
    setProviderId(chosen.providerId);
    setModelId(chosen.modelId);
    setVerifyError(null);
    setVerified(null);
    // A free model is reached with the platform's own credential, so no key is asked for.
    setApiKey('');
  }

  function chooseProvider(id: string) {
    setProviderId(id);
    setModelId(null);
    setVerifyError(null);
    setVerified(null);
    // The key belongs to the provider that was just chosen, so it does not carry over.
    setApiKey('');
  }

  function chooseModel(id: string) {
    setModelId(id);
    setVerifyError(null);
    setVerified(null);
  }

  async function verify() {
    if (!providerId || !modelId) return;
    setVerifying(true);
    setVerifyError(null);
    setVerified(null);
    try {
      const res = await fetch('/api/ai/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ providerId, modelId, ...(apiKey ? { apiKey } : {}) }),
      });
      const body = (await res.json()) as {
        ok: boolean;
        data?: { providerName: string; modelName: string };
        error?: { message?: string };
      };
      if (!body.ok || !body.data) {
        setVerifyError(body.error?.message ?? 'That model did not complete a test request.');
        return;
      }
      setVerified(`${body.data.providerName} · ${body.data.modelName}`);
      onVerified?.(body.data);
    } catch {
      setVerifyError('That model could not be tested. Nothing you entered has been lost.');
    } finally {
      setVerifying(false);
    }
  }

  if (loading) {
    return (
      <div className="nx-stack nx-stack--loose" aria-busy="true">
        <div className="nx-skeleton h-3 w-40" />
        <div className="nx-skeleton h-40 w-full" />
        <div className="nx-skeleton h-40 w-full" />
        <div className="nx-skeleton h-40 w-full" />
      </div>
    );
  }

  if (loadError && !catalogue) {
    return (
      <div className="nx-notice nx-notice--stop" role="alert">
        <p className="font-semibold">The provider list could not be loaded.</p>
        <p className="mt-1 text-xs">{loadError}</p>
        {stale ? (
          <p className="mt-1 text-xs">
            What is shown below is the last known list. It may no longer match what OpenCode exposes.
          </p>
        ) : null}
        <button type="button" className="nx-btn nx-btn--ghost nx-btn--sm mt-3" onClick={() => void load()}>
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="nx-stack nx-stack--loose">
      {/* 1 — Free models */}
      <section className="nx-card nx-card--pad nx-stack" aria-labelledby="free-models-heading">
        <div>
          <p className="nx-eyebrow">Free Models — No API Key Required</p>
          <h2 className="nx-title nx-metric--md" id="free-models-heading">
            Free Models
          </h2>
          <p className="nx-help">
            Powered by OpenCode. These are the models the platform can already reach, priced at nothing, so they need
            no key of your own.
          </p>
        </div>

        <div className="nx-field">
          <label className="nx-sr-only" htmlFor="free-model-search">
            Search free models
          </label>
          <input
            id="free-model-search"
            className="nx-input"
            placeholder="Search free models…"
            value={freeSearch}
            onChange={(e) => setFreeSearch(e.target.value)}
            type="search"
            autoComplete="off"
          />
        </div>

        {filteredFree.length === 0 ? (
          <p className="nx-help">
            {freeModels.length === 0
              ? 'OpenCode is not currently exposing a free model that needs no key. You can choose a provider and model below instead.'
              : 'No free model matches that search.'}
          </p>
        ) : (
          <ul className="nx-list nx-stack-sm" role="radiogroup" aria-label="Free models">
            {filteredFree.map((m) => {
              const selected = modelId === m.id;
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    className="nx-card nx-card--pad nx-stack nx-stack--tight w-full text-left transition"
                    style={{
                      borderColor: selected ? 'var(--nx-accent-600)' : undefined,
                      boxShadow: selected ? '0 0 0 3px var(--nx-accent-50)' : undefined,
                    }}
                    onClick={() => chooseFreeModel(m)}
                  >
                    <span className="nx-row justify-between">
                      <span className="text-sm font-medium text-ink-900">{m.name}</span>
                      <span className="nx-badge nx-badge--good">Free</span>
                    </span>
                    <span className="nx-help nx-mono">
                      {m.id}
                      {m.contextWindow ? ` · ${Math.round(m.contextWindow / 1000)}k context` : ''}
                      {m.reasoning ? ' · reasoning' : ''}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* 2 — Provider */}
      <section className="nx-card nx-card--pad nx-stack" aria-labelledby="provider-heading">
        <div>
          <p className="nx-eyebrow">API Provider</p>
          <h2 className="nx-title nx-metric--md" id="provider-heading">
            API Provider
          </h2>
          <p className="nx-help">
            The list comes from OpenCode. OpenCode is first, because it is the provider the platform already reaches.
          </p>
        </div>

        <div className="nx-field">
          <label className="nx-sr-only" htmlFor="provider-search">
            Search and select provider
          </label>
          <input
            id="provider-search"
            className="nx-input"
            placeholder="Search and select provider…"
            value={providerSearch}
            onChange={(e) => setProviderSearch(e.target.value)}
            type="search"
            autoComplete="off"
          />
        </div>

        {filteredProviders.length === 0 ? (
          <p className="nx-help">No provider matches that search.</p>
        ) : (
          <ul className="nx-list nx-stack-sm" role="radiogroup" aria-label="Providers">
            {filteredProviders.map((p) => {
              const selected = providerId === p.id;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    className="nx-card nx-card--pad nx-stack nx-stack--tight w-full text-left transition"
                    style={{
                      borderColor: selected ? 'var(--nx-accent-600)' : undefined,
                      boxShadow: selected ? '0 0 0 3px var(--nx-accent-50)' : undefined,
                    }}
                    onClick={() => chooseProvider(p.id)}
                  >
                    <span className="nx-row justify-between">
                      <span className="text-sm font-medium text-ink-900">{p.name}</span>
                      {p.connected ? (
                        <span className="nx-badge nx-badge--good">Usable now</span>
                      ) : p.credentialRequirement === 'required' ? (
                        <span className="nx-badge nx-badge--warn">Needs a key</span>
                      ) : (
                        <span className="nx-badge">Not connected</span>
                      )}
                    </span>
                    <span className="nx-help">
                      {p.modelCount} model{p.modelCount === 1 ? '' : 's'}
                      {p.envVars.length > 0 ? ` · needs ${p.envVars.join(', ')}` : ''}
                    </span>
                    {p.notice ? <span className="nx-help">{p.notice}</span> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* 3 — API key, only when the chosen provider needs one */}
      {needsKey ? (
        <section className="nx-card nx-card--pad nx-stack" aria-labelledby="api-key-heading">
          <div>
            <p className="nx-eyebrow">API Key</p>
            <h2 className="nx-title nx-metric--md" id="api-key-heading">
              API Key
            </h2>
            <p className="nx-help">
              {provider?.name} needs a key of its own. It is used only to reach that provider, is never shown again, and
              is never sent to the browser.
            </p>
          </div>
          <div className="nx-field">
            <label className="nx-sr-only" htmlFor="provider-api-key">
              Enter your API key
            </label>
            <input
              id="provider-api-key"
              className="nx-input"
              type="password"
              placeholder="Enter your API key…"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              autoComplete="off"
            />
            {provider && provider.envVars.length > 0 ? (
              <p className="nx-help">OpenCode expects: {provider.envVars.join(', ')}</p>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* 4 — Model */}
      <section className="nx-card nx-card--pad nx-stack" aria-labelledby="model-heading">
        <div>
          <p className="nx-eyebrow">Model</p>
          <h2 className="nx-title nx-metric--md" id="model-heading">
            Model
          </h2>
          <p className="nx-help">
            {provider
              ? `Only models available for ${provider.name} are shown.`
              : 'Choose a provider, or a free model above, and the models you can use will appear here.'}
          </p>
        </div>

        {provider ? (
          <>
            <div className="nx-field">
              <label className="nx-sr-only" htmlFor="model-search">
                Search and select a model
              </label>
              <input
                id="model-search"
                className="nx-input"
                placeholder="Search and select a model…"
                value={modelSearch}
                onChange={(e) => setModelSearch(e.target.value)}
                type="search"
                autoComplete="off"
              />
            </div>

            {providerModels.length === 0 ? (
              <p className="nx-help">
                {provider.models.length === 0
                  ? 'OpenCode is not currently exposing a model for that provider. Choose another provider.'
                  : 'No model matches that search.'}
              </p>
            ) : (
              <ul className="nx-list nx-stack-sm" role="radiogroup" aria-label="Models">
                {providerModels.map((m) => {
                  const selected = modelId === m.id;
                  return (
                    <li key={m.id}>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        className="nx-row justify-between w-full rounded-lg border border-ink-100 px-3 py-2 text-left transition hover:bg-ink-50"
                        style={{
                          borderColor: selected ? 'var(--nx-accent-600)' : undefined,
                          background: selected ? 'var(--nx-accent-50)' : undefined,
                        }}
                        onClick={() => chooseModel(m.id)}
                      >
                        <span className="min-w-0 truncate text-sm text-ink-800">{m.name}</span>
                        <span className="nx-row flex-none gap-1">
                          {m.isFree ? <span className="nx-badge nx-badge--good">Free</span> : null}
                          {m.contextWindow ? (
                            <span className="nx-badge">{Math.round(m.contextWindow / 1000)}k</span>
                          ) : null}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        ) : (
          <p className="nx-notice nx-notice--info">
            Choose a provider above, or pick a free model, and the models you can use will be listed here.
          </p>
        )}

        {verifyError ? (
          <div className="nx-notice nx-notice--stop" role="alert">
            <p className="text-sm font-semibold">{verifyError}</p>
            <p className="mt-1 text-xs">Nothing you entered has been lost. You can choose a different model and try again.</p>
          </div>
        ) : null}
        {verified ? (
          <div className="nx-notice nx-notice--good" role="status">
            <p className="text-sm font-semibold">Tested and working: {verified}</p>
            <p className="mt-1 text-xs">This is now your account&rsquo;s active AI configuration.</p>
          </div>
        ) : null}

        <div className="nx-row">
          <button
            type="button"
            className="nx-btn nx-btn--accent"
            onClick={() => void verify()}
            disabled={verifying || !providerId || !modelId || (needsKey && !apiKey)}
          >
            {verifying ? 'Testing this model…' : 'Verify and use this model'}
          </button>
          {onClose ? (
            <button type="button" className="nx-btn nx-btn--ghost" onClick={onClose}>
              Close
            </button>
          ) : null}
        </div>
        {needsKey && !apiKey ? (
          <p className="nx-help">Enter the key for {provider?.name} before the model can be tested.</p>
        ) : null}
      </section>
    </div>
  );
}
