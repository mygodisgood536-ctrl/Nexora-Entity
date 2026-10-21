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
