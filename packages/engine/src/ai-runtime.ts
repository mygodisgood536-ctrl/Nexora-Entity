/**
 * AI runtime wiring (Amendment section 9).
 *
 * The provider/model a person verified becomes their account's active AI configuration, and that
 * configuration powers the platform's AI-dependent operations: source and profile analysis,
 * discovered-information analysis, alias reasoning, ambiguity analysis and the plain-language
 * readiness narrative.
 *
 * Two rules govern everything in this module:
 *
 *  1. **AI output is advisory.** It may propose things for a person to review or explain a
 *     deterministic result. It may never satisfy an evidence minimum, change the readiness
 *     verdict, or turn an unresolved item into a fact.
 *
 *  2. **AI failure is never fatal.** A provider that is rate-limited, out of credit, unreachable or
 *     misconfigured must not lose a person's work or fail their review (section 21, section 29).
 *     Every failure is collected and reported instead of thrown.
 */

import { createLogger } from '@nexora/core';
import { getActiveAiConfiguration, findEntityById } from '@nexora/db';
import type { ModelRef } from '@nexora/opencode-bridge';

const log = createLogger('engine:ai-runtime');

export interface AiFailure {
  operation: string;
  message: string;
}
/** Collects AI failures so a run can report them without ever failing because of one. */
export type AiFailureCollector = AiFailure[];

/**
 * The account's active, verified provider/model for an entity.
 *
 * `null` means the person has not verified a provider yet, or the configuration is not usable.
 * That is a normal state: the deterministic engines do not need AI, and the platform must keep
 * working without it.
 */
export async function resolveAccountModel(entityId: string): Promise<ModelRef | null> {
  try {
    const entity = await findEntityById(entityId);
    if (!entity) return null;
    const config = await getActiveAiConfiguration(entity.user_id);
    if (!config) return null;
    // `verified` is a configuration that passed a real model round trip. `degraded` is one that
    // is still active but has recorded a problem — worth trying, and any failure it causes is
    // reported honestly rather than hidden.
    if (config.status !== 'verified' && config.status !== 'degraded') return null;
    if (!config.provider_id || !config.model_id) return null;
    return {
      providerId: config.provider_id,
      providerName: config.provider_name,
      modelId: config.model_id,
      modelName: config.model_name,
    };
  } catch (err) {
    log.warn('could not resolve the account AI configuration', {
      entityId,
      message: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Run one AI operation without ever letting it break the surrounding work.
 *
 * A failure is recorded and `null` is returned. The caller continues with the deterministic
 * result, which is the authoritative one in every case.
 */
export async function safeAi<T>(
  failures: AiFailureCollector,
  operation: string,
  run: () => Promise<T>,
): Promise<T | null> {
  try {
    return await run();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    failures.push({ operation, message });
    log.warn('AI operation failed; continuing without it', { operation, message });
    return null;
  }
}
