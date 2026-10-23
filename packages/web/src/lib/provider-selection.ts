/**
 * The rules behind the provider and model selector.
 *
 * They are kept here, apart from the component, because they are the part that can be wrong in a
 * way a person would notice: a provider offered in the wrong place, a model list that shows
 * models from a provider that was not chosen, or a key asked for from someone who does not need
 * to give one.
 */

import type { DiscoveredModel, DiscoveredProvider, FreeModel } from '@/components/provider-model-selector';

/**
 * OpenCode comes first.
 *
 * It is the provider the platform already reaches, so offering it first is the difference between
 * "pick a model" and "go and find a key".
 */
export function orderProviders(providers: DiscoveredProvider[]): DiscoveredProvider[] {
  const opencode = providers.filter((p) => p.id === 'opencode');
  const rest = providers.filter((p) => p.id !== 'opencode');
  return [...opencode, ...rest];
}

/** Free models, searched by name or id. */
export function filterFreeModels(models: FreeModel[], search: string): FreeModel[] {
  const q = search.trim().toLowerCase();
  if (!q) return models;
  return models.filter((m) => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q));
}

/** Providers, searched by name or id, in the order they are offered. */
export function filterProviders(providers: DiscoveredProvider[], search: string): DiscoveredProvider[] {
  const q = search.trim().toLowerCase();
  if (!q) return providers;
  return providers.filter((p) => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q));
}

/**
 * The models of the chosen provider, searched by name or id.
 *
 * Only that provider's models are ever listed. With no provider chosen there is nothing to list,
 * which is why an empty result here is a normal state rather than a failure.
 */
export function filterProviderModels(provider: DiscoveredProvider | null, search: string): DiscoveredModel[] {
  if (!provider) return [];
  const q = search.trim().toLowerCase();
  const models = provider.models;
  if (!q) return models;
  return models.filter((m) => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q));
}

/**
 * Whether the chosen provider needs a key from the person.
 *
 * A provider the platform can already reach, with no credentials of its own, does not. A provider
 * that is already connected does not either, because its credentials are present.
 */
export function providerNeedsKey(provider: DiscoveredProvider | null): boolean {
  if (!provider) return false;
  if (provider.connected && provider.credentialRequirement === 'none') return false;
  return provider.credentialRequirement === 'required' || provider.envVars.length > 0;
}

/**
 * The provider and model a free model belongs to.
 *
 * A free model is one the platform can already reach, so choosing it also chooses its provider.
 */
export function providerForFreeModel(model: FreeModel): { providerId: string; modelId: string } {
  return { providerId: model.providerId, modelId: model.id };
}
