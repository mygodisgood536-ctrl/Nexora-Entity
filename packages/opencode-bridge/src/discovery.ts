/**
 * Dynamic provider/model discovery.
 *
 * Everything here is read live from the running OpenCode server. Nexora Entity keeps no
 * hard-coded provider catalogue: if a provider or model is added, removed, renamed or becomes
 * unavailable in OpenCode, this reflects it immediately because it re-reads OpenCode's own API.
 */

import { createLogger } from '@nexora/core';
import { ensureReady, getVersionString, health } from './server';
import { fetchConsoleConfig, isConsoleTransport } from './console';

const log = createLogger('opencode:discovery');

export type ProviderCredentialRequirement = 'none' | 'optional' | 'required';

export interface DiscoveredModel {
  id: string;
  name: string;
  family?: string | null;
  contextWindow: number | null;
  maxOutput: number | null;
  reasoning: boolean;
  toolCalls: boolean;
  attachment: boolean;
  /** Accepts text, image, audio, pdf … as reported by OpenCode. */
  inputModalities: string[];
  outputModalities: string[];
  /** USD per million tokens, as OpenCode reports. null when unknown/free. */
  cost: { input: number | null; output: number | null } | null;
  /** True when both input and output cost are zero — used only for ordering, never as a claim. */
  isFree: boolean;
  releaseDate: string | null;
  status: string | null;
}

export interface DiscoveredProvider {
  id: string;
  name: string;
  /** How OpenCode resolved the provider's credentials: env, config, custom, api. */
  source: string | null;
  /** Environment variables OpenCode expects for this provider. */
  envVars: string[];
  /** Whether OpenCode reports usable credentials right now. */
  connected: boolean;
  credentialRequirement: ProviderCredentialRequirement;
  /** Auth methods OpenCode advertises for this provider. */
  authMethods: { type: string; label: string }[];
  modelCount: number;
  defaultModelId: string | null;
  /** Only text-capable models are offered for Nexora Entity's operations. */
  models: DiscoveredModel[];
  /** Provider-level note, e.g. "needs an API key". */
  notice: string | null;
}

export interface ProviderCatalogue {
  opencodeVersion: string | null;
  fetchedAt: string;
  durationMs: number;
  providers: DiscoveredProvider[];
  totals: {
    providers: number;
    connectedProviders: number;
    usableModels: number;
    freeModels: number;
  };
}

interface RawModel {
  id?: string;
  name?: string;
  family?: string;
  capabilities?: {
    temperature?: boolean;
    reasoning?: boolean;
    attachment?: boolean;
    toolcall?: boolean;
    input?: Record<string, boolean>;
    output?: Record<string, boolean>;
  };
  cost?: { input?: number; output?: number; cache?: { read?: number; write?: number } };
  limit?: { context?: number; output?: number };
  release_date?: string;
  status?: string;
}

interface RawProvider {
  id?: string;
  name?: string;
  source?: string;
  env?: string[];
  key?: string;
  models?: Record<string, RawModel>;
}

async function apiGet<T>(pathname: string, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const { authHeaders, baseUrl } = await import('./server');
    const res = await fetch(`${baseUrl()}${pathname}`, {
      signal: controller.signal,
      // A hosted bridge requires the same bearer token as the health probe. Without it here the
      // provider catalogue came back unauthenticated, so the panel would show no providers even
      // though the bridge was reachable and correctly configured.
      headers: { accept: 'application/json', ...authHeaders() },
    });
    if (!res.ok) {
      throw new Error(`OpenCode ${pathname} responded ${res.status}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

function activeModalities(map: Record<string, boolean> | undefined): string[] {
  if (!map) return [];
  return Object.entries(map)
    .filter(([, on]) => on === true)
    .map(([k]) => k);
}

function mapModel(id: string, m: RawModel): DiscoveredModel {
  const costIn = m.cost?.input;
  const costOut = m.cost?.output;
  return {
    id: m.id ?? id,
    name: m.name ?? m.id ?? id,
    family: m.family ?? null,
    contextWindow: m.limit?.context ?? null,
    maxOutput: m.limit?.output ?? null,
    reasoning: m.capabilities?.reasoning === true,
    toolCalls: m.capabilities?.toolcall === true,
    attachment: m.capabilities?.attachment === true,
    inputModalities: activeModalities(m.capabilities?.input),
    outputModalities: activeModalities(m.capabilities?.output),
    cost:
      typeof costIn === 'number' || typeof costOut === 'number'
        ? { input: costIn ?? null, output: costOut ?? null }
        : null,
    isFree: typeof costIn === 'number' && costIn === 0 && typeof costOut === 'number' && costOut === 0,
    releaseDate: m.release_date ?? null,
    status: m.status ?? null,
  };
}

/**
 * A model can perform Nexora Entity's operations when it accepts text input and produces text
 * output. Nothing more is assumed — in particular OpenCode is not asked to use tools.
 */
function isUsableForNexora(model: DiscoveredModel): boolean {
  return model.inputModalities.includes('text') && model.outputModalities.includes('text');
}

function connectedIds(payload: unknown): Set<string> {
  const out = new Set<string>();
  const add = (v: unknown) => {
    if (typeof v === 'string') out.add(v);
    else if (v && typeof v === 'object') {
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (val === true || val === 'connected') out.add(k);
        else if (val && typeof val === 'object') add(val);
      }
    }
  };
  if (Array.isArray(payload)) for (const v of payload) add(v);
  else add(payload);
  return out;
}

/** Read the live catalogue from OpenCode. */
export async function fetchCatalogue(options: { includeAllProviders?: boolean } = {}): Promise<ProviderCatalogue> {
  const started = Date.now();
  const h = await ensureReady();
  if (!h.healthy) {
    // health() already carries an honest detail string
    throw new Error(h.detail);
  }

  // The Console transport reads the workspace configuration, which is the OpenCode V2 config
  // format: a provider map whose entries carry the models. It is normalised into the same shape
  // the serve-server transport returns, so one mapper serves both and neither hard-codes a list.
  if (isConsoleTransport()) {
    return fetchConsoleCatalogue(started, options);
  }

  const providerPayload = await apiGet<{
    all?: RawProvider[];
    default?: Record<string, string>;
    connected?: unknown;
  }>('/provider', 45_000);

  const authPayload = await apiGet<Record<string, { type?: string; label?: string }[]>>(
    '/provider/auth',
    20_000,
  ).catch(() => ({}) as Record<string, { type?: string; label?: string }[]>);

  const connected = connectedIds(providerPayload.connected);
  const defaults = providerPayload.default ?? {};
  const all = providerPayload.all ?? [];

  const providers: DiscoveredProvider[] = [];
  for (const p of all) {
    if (!p.id) continue;
    const isConnected = connected.has(p.id);
    const authMethods = (authPayload[p.id] ?? []).map((m) => ({
      type: m.type ?? 'api',
      label: m.label ?? m.type ?? 'API key',
    }));
    const envVars = Array.isArray(p.env) ? p.env : [];

    // A provider OpenCode has not connected can still be usable if it needs no credentials
    // (for example a public gateway). Treat "needs credentials" as required when OpenCode
    // lists env vars for it and it is not connected.
    const credentialRequirement: ProviderCredentialRequirement = isConnected
      ? 'none'
      : envVars.length > 0
        ? 'required'
        : authMethods.length > 0
          ? 'required'
          : 'optional';

    const models = Object.entries(p.models ?? {})
      .map(([id, m]) => mapModel(id, m))
      .filter(isUsableForNexora)
      .sort((a, b) => {
        if (a.isFree !== b.isFree) return a.isFree ? -1 : 1;
        return (b.contextWindow ?? 0) - (a.contextWindow ?? 0);
      });

    // A provider with no credentials configured still appears, but clearly marked: the person
    // can see it exists and that it needs a key. It is never presented as usable.
    providers.push({
      id: p.id,
      name: p.name ?? p.id,
      source: p.source ?? null,
      envVars,
      connected: isConnected,
      credentialRequirement,
      authMethods,
      modelCount: Object.keys(p.models ?? {}).length,
      defaultModelId: defaults[p.id] ?? models[0]?.id ?? null,
      models,
      notice: isConnected
        ? null
        : credentialRequirement === 'required'
          ? `OpenCode needs credentials for this provider (${[...envVars, ...authMethods.map((m) => m.label)].join(', ') || 'API key'}).`
          : 'OpenCode has not reported usable credentials for this provider yet.',
    });
  }

  providers.sort((a, b) => {
    if (a.connected !== b.connected) return a.connected ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const filtered = options.includeAllProviders
    ? providers
    : providers.filter((p) => p.connected || p.models.length > 0);

  const usableModels = filtered.reduce(
    (n, p) => n + (p.connected ? p.models.length : 0),
    0,
  );
  const freeModels = filtered.reduce(
    (n, p) => n + (p.connected ? p.models.filter((m) => m.isFree).length : 0),
    0,
  );

  log.info('catalogue refreshed from OpenCode', {
    providers: filtered.length,
    connected: filtered.filter((p) => p.connected).length,
    usableModels,
  });

  return {
    opencodeVersion: (await getVersionString()) ?? null,
    fetchedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    providers: filtered,
    totals: {
      providers: filtered.length,
      connectedProviders: filtered.filter((p) => p.connected).length,
      usableModels,
      freeModels,
    },
  };
}

/** Providers OpenCode reports as usable right now, cheapest/free first. */
export async function fetchUsableProviders(): Promise<DiscoveredProvider[]> {
  const cat = await fetchCatalogue();
  return cat.providers.filter((p) => p.connected && p.models.length > 0);
}

/**
 * The Console's workspace configuration, mapped into the platform's provider catalogue.
 *
 * The Console serves the OpenCode V2 config format, so the same model mapping is used. Two
 * differences are handled honestly rather than guessed at:
 *
 *  * A model the workspace has disabled is not offered, and a model the workspace has enabled is
 *    offered. The Console reports availability this way rather than through a separate
 *    "connected" list.
 *
 *  * The Console's chat endpoint takes messages and returns assistant text, so a model served by
 *    it accepts text and produces text. That is the endpoint's own contract, so it is stated as
 *    fact rather than left to a guess about the model.
 *
 * Cost and context window are not reported by the Console for a workspace model, so they are left
 * unknown rather than invented.
 */
async function fetchConsoleCatalogue(
  started: number,
  options: { includeAllProviders?: boolean },
): Promise<ProviderCatalogue> {
  const workspace = await fetchConsoleConfig(30_000);
  const providers: DiscoveredProvider[] = [];

  for (const [providerId, provider] of Object.entries(workspace.providers ?? {})) {
    const models: DiscoveredModel[] = [];
    for (const [modelId, raw] of Object.entries(provider.models ?? {})) {
      if (raw?.disabled === true) continue;
      const mapped = mapModel(modelId, {
        id: modelId,
        name: raw?.name ?? modelId,
        capabilities: raw?.capabilities ?? { input: { text: true }, output: { text: true } },
        cost: raw?.cost,
        limit: raw?.limit,
        release_date: raw?.release_date,
        status: raw?.status,
      });
      if (!isUsableForNexora(mapped)) continue;
      models.push(mapped);
    }
    models.sort((a, b) => {
      if (a.isFree !== b.isFree) return a.isFree ? -1 : 1;
      return (b.contextWindow ?? 0) - (a.contextWindow ?? 0);
    });

    providers.push({
      id: providerId,
      name: provider.name ?? providerId,
      // The Console is the credential source for this provider, not an environment variable.
      source: 'console',
      envVars: provider.env ?? [],
      // A provider the Console lists is reachable through the workspace's own credentials.
      connected: true,
      credentialRequirement: 'none',
      authMethods: [],
      modelCount: Object.keys(provider.models ?? {}).length,
      defaultModelId: models[0]?.id ?? null,
      models,
      notice: null,
    });
  }

  providers.sort((a, b) => {
    if (a.connected !== b.connected) return a.connected ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const filtered = options.includeAllProviders
    ? providers
    : providers.filter((p) => p.connected || p.models.length > 0);

  log.info('catalogue refreshed from the OpenCode Console', {
    providers: filtered.length,
    connectedProviders: filtered.filter((p) => p.connected).length,
    usableModels: filtered.reduce((n, p) => n + p.models.length, 0),
  });

  return {
    opencodeVersion: 'console',
    fetchedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    providers: filtered,
    totals: {
      providers: filtered.length,
      connectedProviders: filtered.filter((p) => p.connected).length,
      usableModels: filtered.reduce((n, p) => n + p.models.length, 0),
      freeModels: filtered.reduce((n, p) => n + p.models.filter((m) => m.isFree).length, 0),
    },
  };
}

/** Verify a provider/model exists in OpenCode right now. Used before a verification probe. */
export async function modelExists(providerId: string, modelId: string): Promise<DiscoveredModel | null> {
  const cat = await fetchCatalogue();
  const provider = cat.providers.find((p) => p.id === providerId);
  if (!provider) return null;
  return provider.models.find((m) => m.id === modelId) ?? null;
}

export { health };