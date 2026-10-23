'use client';

import { useState } from 'react';
import ProviderModelSelector, { type Catalogue } from '@/components/provider-model-selector';

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
    freeModels?: Catalogue['freeModels'];
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
 * The provider panel.
 *
 * It opens over the working screen so the person can choose a provider and model without losing
 * their place, and it collapses again when they are done. The selection itself is the
 * `ProviderModelSelector`, which is also available on its own page, so the two cannot drift apart.
 */
export default function ProviderPanel({ active, open, onClose, onVerified }: Props) {
  // The catalogue is held here only for the summary line at the foot of the panel. The selector
  // is what asks OpenCode what it exposes; asking twice would produce two different answers.
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [verified, setVerified] = useState<{ providerName: string; modelName: string } | null>(null);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink-950/70 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="AI provider and model"
    >
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl border border-ink-100 bg-ink-50 shadow-2xl sm:rounded-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-ink-100 p-5">
          <div>
            <p className="nx-eyebrow">AI configuration</p>
            <h2 className="nx-metric nx-metric--sm">Choose Your AI Provider and Model</h2>
            <p className="nx-help max-w-[58ch]">
              Availability is read live from OpenCode. Nothing is hard-coded, so anything OpenCode adds or removes
              appears here immediately. A model is only accepted after a real test call succeeds.
            </p>
          </div>
          <button type="button" className="nx-btn nx-btn--quiet nx-btn--sm" onClick={onClose} aria-label="Close provider panel">
            Close
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {active?.lastError ? (
            <div className="nx-notice nx-notice--stop mb-4" role="alert">
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

          {verified ? (
            <div className="nx-notice nx-notice--good mb-4" role="status">
              <p className="text-xs font-semibold">
                {verified.providerName} &middot; {verified.modelName} is now your active AI configuration.
              </p>
              <p className="mt-1 text-xs">
                Every AI-assisted step uses it until you choose a different one. Nothing else about your entity has
                changed.
              </p>
            </div>
          ) : null}

          <ProviderModelSelector
            active={active ? { providerId: active.providerId, modelId: active.modelId } : null}
            onCatalogue={setCatalogue}
            onVerified={(result) => {
              setVerified(result);
              onVerified({
                providerId: active?.providerId ?? '',
                providerName: result.providerName,
                modelId: active?.modelId ?? '',
                modelName: result.modelName,
                verifiedAt: new Date().toISOString(),
                lastError: null,
                lastErrorCode: null,
              });
            }}
            onClose={onClose}
          />

          {catalogue ? (
            <p className="nx-help mt-4">
              OpenCode {catalogue.opencodeVersion ?? ''} &middot; {catalogue.totals.providers} providers exposed &middot;{' '}
              {catalogue.totals.connectedProviders} with usable credentials &middot; {catalogue.totals.usableModels} usable
              text models ({catalogue.totals.freeModels} free) &middot; refreshed in {catalogue.durationMs}ms
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
