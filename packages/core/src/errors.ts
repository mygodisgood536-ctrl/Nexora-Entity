/**
 * Nexora Entity — error taxonomy.
 *
 * Spec §29 requires the platform to differentiate user-data validation errors, source-access
 * errors, AI provider errors, deployment errors, and system errors — and to show actionable
 * explanations rather than generic messages.
 *
 * Every error carries:
 *  - a stable machine code,
 *  - a domain (which subsystem failed),
 *  - a human message written for the person using the product,
 *  - whether the operation may be retried,
 *  - whether progress must be preserved (always true),
 *  - remediation instructions.
 */

import type { Severity } from './vocabulary';
import { redact } from './logging';

export const ErrorDomain = {
  /** The person's own input did not satisfy a validation rule. */
  user_data: 'user_data',
  /** The platform could not reach or read an external source. */
  source_access: 'source_access',
  /** The AI provider/model failed. Never the person's fault. */
  ai_provider: 'ai_provider',
  /** Publishing/hosting failed. */
  deployment: 'deployment',
  /** Authentication/authorization. */
  auth: 'auth',
  /** Nexora Entity itself failed. */
  system: 'system',
  /** Requested action is not permitted by the Entity Readiness gate. */
  readiness: 'readiness',
  /** Upload/storage problem. */
  storage: 'storage',
  /** Configuration missing (e.g. no deployment credential configured). */
  configuration: 'configuration',
} as const;

export type ErrorDomainValue = (typeof ErrorDomain)[keyof typeof ErrorDomain];

export interface ActionableErrorShape {
  code: string;
  domain: ErrorDomainValue;
  message: string;
  detail?: string | undefined;
  /** Provider/model identity when the failure came from the AI bridge. */
  provider?: { id: string; modelId: string; displayName: string } | undefined;
  /** Which external source failed, when applicable. */
  source?: { id: string | undefined; url: string | undefined; host: string | undefined } | undefined;
  retryable: boolean;
  /** Actions the interface should offer, in priority order. */
  remediation: RemediationAction[];
  /** Never discard user work because of this error. */
  preservesUserProgress: true;
  severity: Severity;
  status: number;
  occurredAt: string;
  /** Human-readable underlying cause, safe to show in diagnostics. */
  cause?: string | undefined;
  context?: Record<string, unknown> | undefined;
}

export interface RemediationAction {
  kind:
    | 'retry'
    | 'change_ai_configuration'
    | 'open_stage'
    | 'resolve_conflict'
    | 'resolve_ambiguity'
    | 'fix_source'
    | 'sign_in'
    | 'contact_support'
    | 'review_item'
    | 'configure_platform';
  label: string;
  /** Route to navigate to when this action is chosen. */
  href?: string;
  primary?: boolean;
}

export class NexoraError extends Error implements ActionableErrorShape {
  readonly code: string;
  readonly domain: ErrorDomainValue;
  readonly detail: string | undefined;
  readonly provider: ActionableErrorShape['provider'];
  readonly source: ActionableErrorShape['source'];
  readonly retryable: boolean;
  readonly remediation: RemediationAction[];
  readonly preservesUserProgress = true as const;
  readonly severity: Severity;
  readonly status: number;
  readonly occurredAt: string;
  readonly context: Record<string, unknown> | undefined;
  /** Underlying cause, exposed as a string so it can be serialised safely. */
  override readonly cause: string | undefined;

  constructor(init: {
    code: string;
    domain: ErrorDomainValue;
    message: string;
    detail?: string;
    provider?: ActionableErrorShape['provider'];
    source?: ActionableErrorShape['source'];
    retryable?: boolean;
    remediation?: RemediationAction[];
    severity?: Severity;
    status?: number;
    cause?: unknown;
    context?: Record<string, unknown>;
  }) {
    super(init.message);
    this.name = 'NexoraError';
    this.code = init.code;
    this.domain = init.domain;
    this.detail = init.detail;
    this.provider = init.provider;
    this.source = init.source;
    this.retryable = init.retryable ?? false;
    // Every error must offer the interface something to do. A retryable failure defaults to
    // "Try again"; anything else falls back to contacting support, so no error is ever presented
    // as a dead end with no action available.
    this.remediation =
      init.remediation ??
      (this.retryable
        ? [{ kind: 'retry', label: 'Try again', primary: true }]
        : [{ kind: 'contact_support', label: 'Get help', primary: true }]);
    this.severity = init.severity ?? 'blocking';
    this.status = init.status ?? statusForDomain(init.domain);
    this.occurredAt = new Date().toISOString();
    this.context = init.context;
    this.cause = describeCause(init.cause);
  }

  toJSON(): ActionableErrorShape {
    return {
      code: this.code,
      domain: this.domain,
      message: this.message,
      detail: this.detail,
      provider: this.provider,
      source: this.source,
      retryable: this.retryable,
      remediation: this.remediation,
      preservesUserProgress: true,
      severity: this.severity,
      status: this.status,
      occurredAt: this.occurredAt,
      cause: this.cause,
      context: this.context,
    };
  }
}

/** Underlying cause as a string, with anything credential-shaped removed. */
function describeCause(cause: unknown): string | undefined {
  if (cause === undefined || cause === null) return undefined;
  if (cause instanceof Error) {
    const nested = (cause as { cause?: unknown }).cause;
    const nestedText = nested instanceof Error ? nested.message : nested === undefined ? '' : String(nested);
    // An underlying driver error frequently embeds a DSN or a token, so it is redacted too.
    return redact(nestedText ? `${cause.message} (${nestedText})` : cause.message);
  }
  return redact(String(cause));
}

function statusForDomain(domain: ErrorDomainValue): number {
  switch (domain) {
    case 'user_data':
      return 400;
    case 'auth':
      return 401;
    case 'readiness':
      return 409;
    case 'configuration':
      return 424;
    case 'ai_provider':
    case 'source_access':
    case 'deployment':
    case 'storage':
    case 'system':
    default:
      return 502;
  }
}

export const isNexoraError = (v: unknown): v is NexoraError => v instanceof NexoraError;

// ── Constructors ─────────────────────────────────────────────────────────────

export const UserDataError = {
  invalid(field: string, message: string): NexoraError {
    return new NexoraError({
      code: 'user_data_invalid',
      domain: 'user_data',
      message,
      detail: `Field: ${field}`,
      remediation: [
        { kind: 'fix_source', label: 'Correct this information', primary: true },
        { kind: 'retry', label: 'Try again' },
      ],
      context: { field },
    });
  },
  conflict(message: string): NexoraError {
    return new NexoraError({
      code: 'user_data_conflict',
      domain: 'user_data',
      message,
      retryable: false,
      remediation: [{ kind: 'fix_source', label: 'Choose a different value', primary: true }],
    });
  },
};

export const AuthError = {
  invalidCredentials(): NexoraError {
    return new NexoraError({
      code: 'auth_invalid_credentials',
      domain: 'auth',
      message:
        'Those login details did not match our records. Check the username, the security question you chose at sign-up, and your security answer.',
      retryable: true,
      remediation: [
        { kind: 'retry', label: 'Try again', primary: true },
        { kind: 'sign_in', label: 'Back to sign in', href: '/login' },
      ],
    });
  },
  usernameTaken(): NexoraError {
    return new NexoraError({
      code: 'auth_username_taken',
      domain: 'user_data',
      message: 'That username is already in use. Choose a different one.',
      remediation: [{ kind: 'fix_source', label: 'Change username', primary: true }],
    });
  },
  accountLocked(): NexoraError {
    return new NexoraError({
      code: 'auth_account_locked',
      domain: 'auth',
      message:
        'This account is temporarily locked after repeated failed sign-in attempts. Nothing you entered has been lost.',
      retryable: true,
      remediation: [{ kind: 'contact_support', label: 'Get help', primary: true }],
    });
  },
  unauthenticated(): NexoraError {
    return new NexoraError({
      code: 'auth_required',
      domain: 'auth',
      message: 'You need to sign in to continue.',
      remediation: [{ kind: 'sign_in', label: 'Sign in', primary: true, href: '/login' }],
    });
  },
  forbidden(what: string): NexoraError {
    return new NexoraError({
      code: 'auth_forbidden',
      domain: 'auth',
      message: `You do not have permission to ${what}.`,
      remediation: [{ kind: 'sign_in', label: 'Sign in as the account owner', href: '/login' }],
    });
  },
};

export const ReadinessBlockedError = (message: string, detail?: string) =>
  new NexoraError({
    code: 'readiness_blocked',
    domain: 'readiness',
    message:
      message ??
      'This entity has not reached 100% Entity Readiness, so it cannot be published. Nexora Entity will not publish a blocked entity.',
    detail,
    remediation: [{ kind: 'review_item', label: 'Review blocking issues', primary: true, href: '/app/readiness' }],
  });

export const ConfigurationError = (message: string, detail?: string) =>
  new NexoraError({
    code: 'configuration_missing',
    domain: 'configuration',
    message,
    detail,
    retryable: false,
    remediation: [{ kind: 'configure_platform', label: 'Platform configuration', primary: true }],
  });

export const StorageError = (message: string, detail?: string) =>
  new NexoraError({
    code: 'storage_failed',
    domain: 'storage',
    message,
    detail,
    retryable: true,
    remediation: [{ kind: 'retry', label: 'Upload again', primary: true }],
  });

export const SystemError = (message: string, detail?: string, cause?: unknown) =>
  new NexoraError({
    code: 'system_error',
    domain: 'system',
    message,
    detail,
    cause,
    retryable: true,
    remediation: [
      { kind: 'retry', label: 'Try again', primary: true },
      { kind: 'contact_support', label: 'Get help' },
    ],
  });

/** Normalize anything thrown into an ActionableErrorShape for API responses and UI. */
export function toActionableError(v: unknown): ActionableErrorShape {
  if (isNexoraError(v)) return v.toJSON();
  if (v instanceof Error) {
    return new NexoraError({
      code: 'system_error',
      domain: 'system',
      message: 'Nexora Entity ran into an unexpected problem. Nothing you entered has been lost.',
      // An unexpected throw can carry a connection string or token in its message. Redacting
      // here means no code path can leak one into an API response by forgetting to.
      detail: redact(v.message),
      retryable: true,
      cause: v,
    }).toJSON();
  }
  return new NexoraError({
    code: 'system_error',
    domain: 'system',
    message: 'Nexora Entity ran into an unexpected problem.',
    detail: typeof v === 'string' ? redact(v) : undefined,
    retryable: true,
  }).toJSON();
}