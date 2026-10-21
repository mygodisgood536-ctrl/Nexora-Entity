/**
 * AI operations through OpenCode.
 *
 * Every operation:
 *  - runs against the account's active, verified provider/model (never a hard-coded one),
 *  - times out explicitly,
 *  - classifies failures into the provider taxonomy (spec §6),
 *  - never mutates user data, so a failure can never lose progress.
 *
 * Deterministic Nexora rules remain authoritative: AI output is treated as advisory input to
 * the engines, and is never allowed to satisfy an evidence minimum or override a gate.
 */

import { config } from '@nexora/core/config';
import { NexoraError, createLogger } from '@nexora/core';
import { classifyProviderFailure, failureCode, type ProviderFailureClassification } from './failure';
import { baseUrl, ensureReady, health, authHeaders } from './server';
import { modelExists } from './discovery';
import { consoleProviderHeaders, fetchConsoleConfig, isConsoleTransport, runConsoleChat } from './console';

const log = createLogger('opencode:ops');

export interface ModelRef {
  providerId: string;
  modelId: string;
  providerName: string;
  modelName: string;
}

export interface AiCallResult {
  text: string;
  provider: ModelRef;
  latencyMs: number;
  sessionId: string;
}

interface RawMessageResponse {
  parts?: { type?: string; text?: string }[];
  error?: { name?: string; data?: { message?: string } } | null;
  info?: { providerID?: string; modelID?: string };
}

function providerDisplay(providerId: string, providerName: string, modelId: string, modelName: string) {
  return {
    id: providerId,
    modelId,
    displayName: `${providerName} · ${modelName} (${providerId}/${modelId})`,
  };
}

export function aiProviderError(input: {
  classification: ProviderFailureClassification;
  model: ModelRef | null;
  operation: string;
}): NexoraError {
  const c = input.classification;
  const remediation: NexoraError['remediation'] = [];
  if (c.requiresCredentials) {
    remediation.push({
      kind: 'change_ai_configuration',
      label: 'Set up or change provider credentials',
      primary: true,
    });
  }
  if (c.requiresModelChange) {
    remediation.push({
      kind: 'change_ai_configuration',
      label: 'Choose a different provider or model',
      primary: true,
    });
  }
  if (c.retryable) {
    remediation.push({ kind: 'retry', label: 'Try the same provider again', primary: !c.requiresModelChange });
  }
  remediation.push({ kind: 'contact_support', label: 'Get help' });

  return new NexoraError({
    code: failureCode(c.kind),
    domain: 'ai_provider',
    message: c.userMessage,
    detail: `Operation: ${input.operation}. Provider: ${input.model ? input.model.providerName : 'unknown'} / ${input.model ? input.model.modelId : 'unknown'}.`,
    provider: input.model
      ? providerDisplay(
          input.model.providerId,
          input.model.providerName,
          input.model.modelId,
          input.model.modelName,
        )
      : undefined,
    retryable: c.retryable,
    remediation,
    // The whole classification is kept, not just its kind. An operation that fails inside the
    // bridge is classified once, where the provider's own words are still available; a caller
    // that re-classifies the resulting error must be able to recover that answer instead of
    // re-reading a user-facing message that no longer contains it.
    context: {
      failureKind: c.kind,
      retryable: c.retryable,
      requiresModelChange: c.requiresModelChange,
      requiresCredentials: c.requiresCredentials,
      raw: c.raw?.slice(0, 2000),
    },
  });
}

async function httpJson<T>(
  pathname: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ status: number; data: T }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl()}${pathname}`, {
      ...init,
      signal: controller.signal,
      // The bearer token is required by a hosted bridge for session creation and message sending
      // as well as for the health probe, so it is applied to every call the platform makes.
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        ...authHeaders(),
        ...(init.headers ?? {}),
      },
    });
    const text = await res.text();
    let data: unknown = undefined;
    try {
      data = text ? JSON.parse(text) : undefined;
    } catch {
      data = text;
    }
    return { status: res.status, data: data as T };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Verify a provider/model by actually running it. A configuration is only ever marked
 * verified when a real round-trip succeeded.
 */
export async function verifyModel(
  model: ModelRef,
  options: { timeoutMs?: number; operation?: string } = {},
): Promise<{
  ok: boolean;
  model: ModelRef;
  latencyMs: number;
  probeText: string;
  error?: NexoraError;
}> {
  const started = Date.now();
  const operation = options.operation ?? 'provider_verification';

  const h = await ensureReady();
  if (!h.healthy) {
    return {
      ok: false,
      model,
      latencyMs: Date.now() - started,
      probeText: '',
      error: new NexoraError({
        code: 'ai_provider_bridge_unavailable',
        domain: 'ai_provider',
        message:
          'The OpenCode AI bridge is not available, so this provider could not be tested. Nothing has been lost.',
        detail: h.detail,
        retryable: true,
        remediation: [
          { kind: 'retry', label: 'Try again', primary: true },
          { kind: 'change_ai_configuration', label: 'Choose another provider or model' },
        ],
      }),
    };
  }

  // Confirm OpenCode currently exposes this provider/model before spending a request on it.
  try {
    const exists = await modelExists(model.providerId, model.modelId);
    if (!exists) {
      const classification: ProviderFailureClassification = {
        kind: 'model_unavailable',
        userMessage:
          'OpenCode does not currently expose that provider and model. It may have been removed or renamed. Choose another one.',
        retryable: false,
        requiresModelChange: true,
        requiresCredentials: false,
      };
      return {
        ok: false,
        model,
        latencyMs: Date.now() - started,
        probeText: '',
        error: aiProviderError({ classification, model, operation: 'provider_availability_check' }),
      };
    }
  } catch (err) {
    log.warn('availability pre-check failed; attempting the probe anyway', { message: String(err) });
  }

  try {
    const result = await runPrompt(
      model,
      'You are being tested as an AI provider for Nexora Entity. Reply with exactly the single token NEXORA_OK and nothing else.',
      { timeoutMs: options.timeoutMs ?? config().opencodeProbeTimeoutMs, operation },
    );
    const text = result.text.trim();
    const ok = /NEXORA_OK/i.test(text);
    if (!ok) {
      const classification: ProviderFailureClassification = {
        kind: 'invalid_response',
        userMessage:
          'The provider responded but did not behave as a working model, so it was not accepted. Choose another provider or model.',
        retryable: false,
        requiresModelChange: true,
        requiresCredentials: false,
        raw: text.slice(0, 400),
      };
      return {
        ok: false,
        model,
        latencyMs: result.latencyMs,
        probeText: text,
        error: aiProviderError({ classification, model, operation }),
      };
    }
    return { ok: true, model, latencyMs: result.latencyMs, probeText: text };
  } catch (err) {
    const classification = classifyProviderFailure(err);
    return {
      ok: false,
      model,
      latencyMs: Date.now() - started,
      probeText: '',
      error: aiProviderError({ classification, model, operation }),
    };
  }
}

/**
 * Send a prompt and read the assistant's text. Creates a fresh OpenCode session per operation
 * so one failed call can never contaminate the next.
 */
export async function runPrompt(
  model: ModelRef,
  prompt: string,
  options: { timeoutMs?: number; operation?: string; system?: string } = {},
): Promise<AiCallResult> {
  const operation = options.operation ?? 'ai_operation';
  const timeoutMs = options.timeoutMs ?? config().opencodeRequestTimeoutMs;
  const started = Date.now();

  await ensureReady();

  // The Console transport serves the same operation through its OpenAI-compatible chat endpoint.
  // The workspace configuration carries the headers the gateway needs to resolve the account, so
  // they are read from the live configuration rather than assumed.
  if (isConsoleTransport()) {
    try {
      const workspace = await fetchConsoleConfig(30_000);
      const headers = consoleProviderHeaders(workspace, model.providerId);
      const result = await runConsoleChat(model.modelId, prompt, {
        timeoutMs: timeoutMs,
        system: options.system,
        headers,
      });
      return {
        text: result.text,
        provider: model,
        latencyMs: Date.now() - started,
        sessionId: `console:${model.providerId}/${model.modelId}`,
      };
    } catch (err) {
      const classification = classifyProviderFailure(err);
      log.warn('AI operation failed', {
        operation,
        provider: model.providerId,
        model: model.modelId,
        kind: classification.kind,
      });
      throw aiProviderError({ classification, model, operation });
    }
  }

  let sessionId: string;
  try {
    const created = await httpJson<{ id?: string }>(
      '/session',
      { method: 'POST', body: JSON.stringify({ providerID: model.providerId, modelID: model.modelId }) },
      Math.min(timeoutMs, 20_000),
    );
    if (created.status >= 400 || !created.data?.id) {
      throw new Error(`OpenCode could not create a session (${created.status}): ${JSON.stringify(created.data).slice(0, 300)}`);
    }
    sessionId = created.data.id;
  } catch (err) {
    throw aiProviderError({ classification: classifyProviderFailure(err), model, operation });
  }

  try {
    const parts: { type: string; text?: string }[] = [];
    if (options.system) parts.push({ type: 'text', text: options.system });
    parts.push({ type: 'text', text: prompt });

    const res = await httpJson<RawMessageResponse>(
      `/session/${encodeURIComponent(sessionId)}/message`,
      {
        method: 'POST',
        body: JSON.stringify({ model: { providerID: model.providerId, modelID: model.modelId }, parts }),
      },
      timeoutMs,
    );

    if (res.status >= 400) {
      throw new Error(`OpenCode returned ${res.status}: ${JSON.stringify(res.data).slice(0, 500)}`);
    }
    const msgError = res.data?.error;
    if (msgError) {
      throw new Error(`${msgError.name ?? 'provider_error'}: ${msgError.data?.message ?? JSON.stringify(msgError).slice(0, 300)}`);
    }
    const text = (res.data?.parts ?? [])
      .filter((p) => p.type === 'text' && typeof p.text === 'string')
      .map((p) => p.text as string)
      .join('')
      .trim();

    if (!text) {
      throw new Error('Provider returned no text content');
    }
    return { text, provider: model, latencyMs: Date.now() - started, sessionId };
  } catch (err) {
    const classification = classifyProviderFailure(err);
    log.warn('AI operation failed', {
      operation,
      provider: model.providerId,
      model: model.modelId,
      kind: classification.kind,
    });
    throw aiProviderError({ classification, model, operation });
  }
}

/**
 * Structured operation. The provider is asked for JSON and the result is validated here.
 * If the model returns something unusable, the caller receives a provider failure — Nexora
 * Entity never substitutes invented data.
 */
export async function runStructured<T>(
  model: ModelRef,
  spec: {
    operation: string;
    system: string;
    instruction: string;
    payload: unknown;
    schemaHint: string;
  },
  parse: (value: unknown) => T | null,
): Promise<{ value: T; raw: string; latencyMs: number }> {
  const prompt = [
    spec.instruction,
    '',
    'Return ONLY valid JSON matching this shape, with no markdown fences and no commentary:',
    spec.schemaHint,
    '',
    'INPUT DATA (JSON):',
    JSON.stringify(spec.payload).slice(0, 120_000),
  ].join('\n');

  const result = await runPrompt(model, prompt, {
    system: spec.system,
    operation: spec.operation,
  });

  const extracted = extractJson(result.text);
  if (extracted === null) {
    throw aiProviderError({
      classification: {
        kind: 'invalid_response',
        userMessage:
          'The AI provider answered, but not in a form Nexora Entity can read. Nothing was changed. You can repeat the step or choose a different model.',
        retryable: true,
        requiresModelChange: false,
        requiresCredentials: false,
        raw: result.text.slice(0, 400),
      },
      model,
      operation: spec.operation,
    });
  }
  const value = parse(extracted);
  if (value === null) {
    throw aiProviderError({
      classification: {
        kind: 'invalid_response',
        userMessage:
          'The AI provider returned information that did not match what Nexora Entity asked for. Your data is unchanged.',
        retryable: true,
        requiresModelChange: false,
        requiresCredentials: false,
        raw: result.text.slice(0, 400),
      },
      model,
      operation: spec.operation,
    });
  }
  return { value, raw: result.text, latencyMs: result.latencyMs };
}

/** Tolerant JSON extraction: handles fences and leading/trailing prose. */
export function extractJson(text: string): unknown | null {
  const trimmed = text.trim();
  const candidates: string[] = [];
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fence?.[1]) candidates.push(fence[1].trim());
  candidates.push(trimmed);
  const firstObj = trimmed.indexOf('{');
  const firstArr = trimmed.indexOf('[');
  if (firstObj >= 0) {
    const lastObj = trimmed.lastIndexOf('}');
    if (lastObj > firstObj) candidates.push(trimmed.slice(firstObj, lastObj + 1));
  }
  if (firstArr >= 0) {
    const lastArr = trimmed.lastIndexOf(']');
    if (lastArr > firstArr) candidates.push(trimmed.slice(firstArr, lastArr + 1));
  }
  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch {
      /* try next */
    }
  }
  return null;
}

export { health, ensureReady };