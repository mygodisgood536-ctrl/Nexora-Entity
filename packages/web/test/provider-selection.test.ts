import { describe, expect, it } from 'vitest';
import {
  filterFreeModels,
  filterProviderModels,
  filterProviders,
  orderProviders,
  providerForFreeModel,
  providerNeedsKey,
} from '../src/lib/provider-selection';
import type { DiscoveredProvider, FreeModel } from '../src/components/provider-model-selector';

function provider(over: Partial<DiscoveredProvider> = {}): DiscoveredProvider {
  return {
    id: 'acme',
    name: 'Acme',
    connected: false,
    credentialRequirement: 'required',
    envVars: ['ACME_API_KEY'],
    authMethods: [{ type: 'api', label: 'API key' }],
    modelCount: 1,
    defaultModelId: null,
    models: [
      { id: 'acme-1', name: 'Acme One', contextWindow: 128000, reasoning: false, isFree: false },
      { id: 'acme-2', name: 'Acme Two', contextWindow: 200000, reasoning: true, isFree: false },
    ],
    notice: null,
    ...over,
  };
}

function freeModel(over: Partial<FreeModel> = {}): FreeModel {
  return {
    id: 'opencode/grok-build-0.1',
    name: 'Grok Build',
    providerId: 'opencode',
    providerName: 'OpenCode',
    contextWindow: 131072,
    reasoning: false,
    ...over,
  };
}

describe('the provider and model selector rules', () => {
  it('offers OpenCode before every other provider', () => {
    const ordered = orderProviders([
      provider({ id: 'acme', name: 'Acme' }),
      provider({ id: 'opencode', name: 'OpenCode' }),
      provider({ id: 'zebra', name: 'Zebra' }),
    ]);
    expect(ordered.map((p) => p.id)).toEqual(['opencode', 'acme', 'zebra']);
  });

  it('does not lose a provider when OpenCode is absent', () => {
    const ordered = orderProviders([provider({ id: 'acme' }), provider({ id: 'zebra' })]);
    expect(ordered.map((p) => p.id)).toEqual(['acme', 'zebra']);
  });

  it('lists no model at all when no provider has been chosen', () => {
    // The requirement is exact: with no provider selected, the model list must not show a list.
    expect(filterProviderModels(null, '')).toEqual([]);
    expect(filterProviderModels(null, 'grok')).toEqual([]);
  });

  it('lists only the chosen provider’s models', () => {
    const chosen = provider({ id: 'acme', models: [provider().models[0]!] });
    const other = provider({ id: 'zebra', models: [provider().models[1]!] });
    expect(filterProviderModels(chosen, '').map((m) => m.id)).toEqual(['acme-1']);
    expect(other.models[0]!.id).not.toBe('acme-1');
  });

  it('searches models by name and by id', () => {
    const chosen = provider();
    expect(filterProviderModels(chosen, 'two').map((m) => m.id)).toEqual(['acme-2']);
    expect(filterProviderModels(chosen, 'acme-1').map((m) => m.id)).toEqual(['acme-1']);
    expect(filterProviderModels(chosen, 'nothing')).toEqual([]);
  });

  it('searches free models and providers by name and by id', () => {
    expect(filterFreeModels([freeModel()], 'grok').length).toBe(1);
    expect(filterFreeModels([freeModel()], 'nope')).toEqual([]);
    expect(filterProviders([provider({ id: 'acme', name: 'Acme' })], 'acme').length).toBe(1);
    expect(filterProviders([provider({ id: 'acme', name: 'Acme' })], 'zzz')).toEqual([]);
  });

  it('shows every free model when nothing has been typed', () => {
    const models = [freeModel(), freeModel({ id: 'x', name: 'Other' })];
    expect(filterFreeModels(models, '   ')).toHaveLength(2);
  });

  it('asks for a key only from a provider that needs one', () => {
    expect(providerNeedsKey(provider({ credentialRequirement: 'required' }))).toBe(true);
    expect(providerNeedsKey(provider({ credentialRequirement: 'optional', envVars: ['ACME_API_KEY'] }))).toBe(true);
  });

  it('does not ask for a key from a provider the platform can already reach', () => {
    expect(
      providerNeedsKey(
        provider({ id: 'opencode', connected: true, credentialRequirement: 'none', envVars: [] }),
      ),
    ).toBe(false);
  });

  it('asks for no key when no provider has been chosen', () => {
    expect(providerNeedsKey(null)).toBe(false);
  });

  it('treats a free model as choosing its provider as well', () => {
    // A free model is reached with the platform's credential, so choosing it must not leave the
    // provider unchosen and the model list empty.
    expect(providerForFreeModel(freeModel())).toEqual({
      providerId: 'opencode',
      modelId: 'opencode/grok-build-0.1',
    });
  });
});
