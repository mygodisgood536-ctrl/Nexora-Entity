/**
 * The OpenCode Console transport.
 *
 * Nexora Entity never talks to a model provider directly (vision §2, §5, §36): OpenCode is the
 * provider/model bridge, and it is reached over HTTP. There are two shapes that bridge can take,
 * and they are not the same credential:
 *
 *  * **A running `opencode serve` instance** — the local-development shape. It exposes
 *    `/global/health`, `/provider`, `/provider/auth`, `/session` and `/session/:id/message`, and it
 *    is protected by a bearer token or HTTP basic auth that belongs to that server.
 *
 *  * **The OpenCode Console** — the hosted shape. A Console service-account key (`oc_sk_…`) is a
 *    bearer token for the Console itself. It authenticates `GET <console>/api/v2/config` (the
 *    workspace's providers and models, in the OpenCode V2 config format) and the inference gateway
 *    at `<inference>/openai/v1/chat/completions`. It is *not* a token for an `opencode serve`
 *    process, and it does not unlock `/provider` or `/session` on one.
 *
 * A Console key and a serve-server token are therefore not interchangeable, and this module exists
 * so the platform can speak to whichever bridge it has actually been given rather than assuming one.
 *
 * The transport is chosen by the configured base URL: pointing `NEXORA_OPENCODE_URL` at the
 * Console selects the Console transport, and anything else keeps the serve-server transport. No
 * provider list is hard-coded either way — both are read live from OpenCode.
 */

import { config } from '@nexora/core/config';
import { createLogger } from '@nexora/core';

const log = createLogger('opencode:console');

/** The Console origins that identify the hosted transport. */
const CONSOLE_HOSTS = new Set(['opencode.ai', 'dev.opencode.ai', 'console.opencode.ai']);

export function isConsoleTransport(): boolean {
  const url = config().opencodeUrl;
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return CONSOLE_HOSTS.has(host) && new URL(url).pathname.includes('/console');
  } catch {
    return false;
  }
}

/** The Console base, e.g. `https://opencode.ai/console`. */
export function consoleBase(): string {
  const url = config().opencodeUrl ?? 'https://opencode.ai/console';
  return url.replace(/\/+$/, '');
}

/**
 * The inference gateway base, e.g. `https://opencode.ai/inference`.
 *
 * Defaults to the sibling `inference` origin of the Console, which is how the service is laid out.
 * It can be overridden explicitly for a self-hosted gateway.
 */
export function inferenceBase(): string {
  const explicit = config().opencodeInferenceUrl;
  if (explicit) return explicit.replace(/\/+$/, '');
  const consoleUrl = new URL(consoleBase());
  consoleUrl.pathname = consoleUrl.pathname.replace(/\/console\/?$/, '/inference');
  return consoleUrl.toString().replace(/\/+$/, '');
}

function authHeader(): Record<string, string> {
  const token = config().opencodeToken;
  return token ? { authorization: `Bearer ${token}` } : {};
}

export interface ConsoleConfigModel {
  disabled?: boolean;
  package?: string;
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
  name?: string;
}

export interface ConsoleConfigProvider {
  name?: string;
  headers?: Record<string, string>;
  env?: string[];
  models?: Record<string, ConsoleConfigModel>;
}

export interface ConsoleConfig {
  providers?: Record<string, ConsoleConfigProvider>;
}

/* ── The model catalogue OpenCode itself uses ────────────────────────────── */

/**
 * Cost and capability metadata for a model, taken from the catalogue OpenCode lists its models
 * from. It is the same source OpenCode itself consults, so a model priced here is priced the way
 * OpenCode prices it — never from a name that merely looks like a free model.
 */
export interface ModelCostEntry {
  id: string;
  name: string;
  cost: { input: number; output: number; cache_read?: number } | null;
  contextWindow: number | null;
  maxOutput: number | null;
  reasoning: boolean;
  toolCalls: boolean;
  attachment: boolean;
  modalities: { input: string[]; output: string[] };
  isFree: boolean;
}

const COST_INDEX_TTL_MS = 15 * 60 * 1000;
let costIndex: { at: number; byId: Map<string, ModelCostEntry> } | null = null;

/**
 * The catalogue OpenCode lists models from, indexed by model identifier.
 *
 * A model can be offered by several providers with different prices, so the cheapest entry wins:
 * a model is free if *some* way of calling it is free.
 */
export async function modelCostMetadata(): Promise<Map<string, ModelCostEntry>> {
  return modelCostIndex();
}

async function modelCostIndex(): Promise<Map<string, ModelCostEntry>> {
  if (costIndex && Date.now() - costIndex.at < COST_INDEX_TTL_MS) return costIndex.byId;

  const byId = new Map<string, ModelCostEntry>();
  let payload: Record<string, { models?: Record<string, RawCostModel> }> = {};
  try {
    const res = await fetch('https://models.dev/api.json', {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`models.dev responded ${res.status}`);
    payload = (await res.json()) as typeof payload;
  } catch (err) {
    log.warn('could not read the OpenCode model catalogue', {
      message: err instanceof Error ? err.message : String(err),
    });
    // An empty index is a valid state: it simply means no model can be shown as free, rather than
    // a model being labelled free on a guess.
    costIndex = { at: Date.now(), byId };
    return byId;
  }

  for (const provider of Object.values(payload)) {
    for (const [modelId, raw] of Object.entries(provider.models ?? {})) {
      const entry: ModelCostEntry = {
        id: raw.id ?? modelId,
        name: raw.name ?? modelId,
        cost:
          raw.cost && typeof raw.cost.input === 'number' && typeof raw.cost.output === 'number'
            ? { input: raw.cost.input, output: raw.cost.output, cache_read: raw.cost.cache_read }
            : null,
        contextWindow: raw.limit?.context ?? null,
        maxOutput: raw.limit?.output ?? null,
        reasoning: raw.reasoning === true,
        toolCalls: raw.tool_call === true,
        attachment: raw.attachment === true,
        modalities: {
          input: Object.entries(raw.modalities?.input ?? {}).filter(([, v]) => v === true).map(([k]) => k),
          output: Object.entries(raw.modalities?.output ?? {}).filter(([, v]) => v === true).map(([k]) => k),
        },
        isFree:
          raw.cost != null &&
          typeof raw.cost.input === 'number' &&
          typeof raw.cost.output === 'number' &&
          raw.cost.input === 0 &&
          raw.cost.output === 0,
      };
      const existing = byId.get(entry.id);
      // The cheapest way of calling a model decides whether it is free.
      if (!existing || (entry.cost && existing.cost && entry.cost.input < existing.cost.input)) {
        byId.set(entry.id, entry);
      }
    }
  }

  costIndex = { at: Date.now(), byId };
  return byId;
}

interface RawCostModel {
  id?: string;
  name?: string;
  cost?: { input?: number; output?: number; cache_read?: number };
  limit?: { context?: number; output?: number };
  reasoning?: boolean;
  tool_call?: boolean;
  attachment?: boolean;
  modalities?: { input?: Record<string, boolean>; output?: Record<string, boolean> };
}

/**
 * The models the Console's inference gateway can actually serve right now.
 *
 * This is the authoritative answer to "what can be called", as opposed to the workspace
 * configuration, which says what the workspace has chosen to expose.
 */
export async function fetchConsoleServedModels(timeoutMs = 30_000): Promise<string[]> {
  const res = await fetch(`${inferenceBase()}/v1/models`, {
    headers: { accept: 'application/json', ...authHeader() },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`OpenCode inference catalogue responded ${res.status}`);
  const body = (await res.json()) as { data?: { id?: string }[] };
  return (body.data ?? []).map((m) => String(m.id ?? '')).filter(Boolean);
}

/**
 * The models that are free to use and need no additional provider key.
 *
 * A model qualifies when the bridge can serve it right now *and* the catalogue prices it at zero.
 * Both facts come from OpenCode's own sources, so the list changes automatically as OpenCode
 * changes it, and a model is never called free because of how it is named.
 */
export async function fetchConsoleFreeModels(timeoutMs = 30_000): Promise<ModelCostEntry[]> {
  const [served, costs] = await Promise.all([fetchConsoleServedModels(timeoutMs), modelCostIndex()]);
  const out: ModelCostEntry[] = [];
  for (const id of served) {
    const entry = costs.get(id);
    if (entry && entry.isFree) out.push(entry);
  }
  out.sort((a, b) => (b.contextWindow ?? 0) - (a.contextWindow ?? 0) || a.name.localeCompare(b.name));
  return out;
}

/** The Console workspace configuration: the live provider and model catalogue. */
export async function fetchConsoleConfig(timeoutMs = 30_000): Promise<ConsoleConfig> {
  const url = `${consoleBase()}/api/v2/config`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json', ...authHeader() },
    });
    if (!res.ok) {
      throw new Error(`OpenCode Console config responded ${res.status}`);
    }
    return (await res.json()) as ConsoleConfig;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The headers the Console requires on an inference request.
 *
 * The workspace configuration carries them (for example the organisation identifier that selects
 * the workspace), and they must be echoed back or the gateway cannot resolve the right account.
 */
export function consoleProviderHeaders(config: ConsoleConfig, providerId: string): Record<string, string> {
  const headers = config.providers?.[providerId]?.headers ?? {};
  return { ...headers };
}

export interface ConsoleChatResult {
  text: string;
  status: number;
}

/**
 * A single model call through the Console's OpenAI-compatible chat endpoint.
 *
 * The endpoint takes `messages` and returns assistant text, so a model served by it accepts text
 * and produces text — that is the endpoint's contract, not an assumption about the model.
 */
export async function runConsoleChat(
  modelId: string,
  prompt: string,
  options: { timeoutMs?: number; system?: string; headers?: Record<string, string> } = {},
): Promise<ConsoleChatResult> {
  const messages: { role: string; content: string }[] = [];
  if (options.system) messages.push({ role: 'system', content: options.system });
  messages.push({ role: 'user', content: prompt });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 120_000);
  try {
    const res = await fetch(`${inferenceBase()}/openai/v1/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        ...authHeader(),
        ...(options.headers ?? {}),
      },
      body: JSON.stringify({ model: modelId, messages, max_tokens: 2048 }),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`OpenCode inference responded ${res.status}: ${text.slice(0, 300)}`);
    }
    let parsed: { choices?: { message?: { content?: unknown } }[] };
    try {
      parsed = JSON.parse(text) as typeof parsed;
    } catch {
      throw new Error('OpenCode inference returned a body that is not JSON');
    }
    const content = parsed.choices?.[0]?.message?.content;
    const out = typeof content === 'string' ? content : '';
    if (!out.trim()) {
      throw new Error('Provider returned no text content');
    }
    return { text: out.trim(), status: res.status };
  } finally {
    clearTimeout(timer);
    log.debug('console inference completed', { model: modelId });
  }
}
