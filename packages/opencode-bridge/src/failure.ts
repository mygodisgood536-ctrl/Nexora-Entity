/**
 * Failure classification for the OpenCode bridge (spec §6).
 *
 * Provider/model failures are expected operational conditions. They must be reported as
 * provider failures — never as a problem with the person's entity data.
 */

export const ProviderFailureKind = {
  rateLimited: 'rate_limited',
  usageLimit: 'usage_limit',
  temporarilyUnavailable: 'temporarily_unavailable',
  modelUnavailable: 'model_unavailable',
  authenticationFailed: 'authentication_failed',
  timeout: 'timeout',
  refused: 'refused',
  networkFailure: 'network_failure',
  contentFiltered: 'content_filtered',
  contextOverflow: 'context_overflow',
  invalidResponse: 'invalid_response',
  serverError: 'server_error',
  unknown: 'unknown',
} as const;
export type ProviderFailureKind = (typeof ProviderFailureKind)[keyof typeof ProviderFailureKind];

export interface ProviderFailureClassification {
  kind: ProviderFailureKind;
  /** Message written for the person, in plain language. */
  userMessage: string;
  /** Whether simply retrying the same provider/model could work. */
  retryable: boolean;
  /** Whether the user must choose a different provider/model. */
  requiresModelChange: boolean;
  /** Whether credentials must be supplied or corrected. */
  requiresCredentials: boolean;
  /** Raw text from the provider for diagnostics. Never shown as the user message. */
  raw?: string;
}

interface Rule {
  test: (haystack: string) => boolean;
  classify: (haystack: string) => ProviderFailureClassification;
}

const RULES: Rule[] = [
  {
    test: (h) => /rate[\s_-]?limit|too many requests|\b429\b|quota exceeded/i.test(h),
    classify: () => ({
      kind: ProviderFailureKind.rateLimited,
      userMessage:
        'This AI provider is temporarily limiting how often it can be used. Nothing you entered has been lost.',
      retryable: true,
      requiresModelChange: false,
      requiresCredentials: false,
    }),
  },
  {
    test: (h) =>
      /insufficient[_ ]quota|exceeded your current quota|billing|credit balance|payment required|usage limit|insufficient (account )?funds|\b402\b/i.test(
        h,
      ),
    classify: () => ({
      kind: ProviderFailureKind.usageLimit,
      userMessage:
        'This AI provider has run out of the allowance or credit attached to it. You can choose a different provider or model and carry on from here.',
      retryable: false,
      requiresModelChange: true,
      requiresCredentials: true,
    }),
  },
  {
    // The hosted bridge only allows its free models to be called from inside OpenCode itself.
    // Calling one over the API is refused with a 403 that is not a credential problem, so it is
    // classified before the authentication rule below and reported as what it is: the model
    // cannot be reached this way.
    test: (h) => /free tier can only be used|only be used from within|not available via the api/i.test(h),
    classify: () => ({
      kind: ProviderFailureKind.modelUnavailable,
      userMessage:
        'This model cannot be called through the OpenCode API. Choose a different model and Nexora Entity will continue from where it stopped.',
      retryable: false,
      requiresModelChange: true,
      requiresCredentials: false,
    }),
  },
  {
    test: (h) => /\b401\b|\b403\b|unauthori[sz]ed|invalid[\s_-]?api[\s_-]?key|authentication|permission[\s_-]?denied|forbidden/i.test(h),
    classify: () => ({
      kind: ProviderFailureKind.authenticationFailed,
      userMessage:
        'This AI provider rejected the credentials it was given. OpenCode needs valid credentials for that provider.',
      retryable: false,
      requiresModelChange: false,
      requiresCredentials: true,
    }),
  },
  {
    test: (h) => /model[\s_-]?(not[\s_-]?found|does not exist|unavailable|deprecated|removed|not supported)|\b404\b.*model/i.test(h),
    classify: () => ({
      kind: ProviderFailureKind.modelUnavailable,
      userMessage:
        'The AI model you selected is no longer available through OpenCode. Pick another model and Nexora Entity will continue from where it stopped.',
      retryable: false,
      requiresModelChange: true,
      requiresCredentials: false,
    }),
  },
  {
    test: (h) => /provider[\s_-]?not[\s_-]?found|unknown[\s_-]?provider/i.test(h),
    classify: () => ({
      kind: ProviderFailureKind.modelUnavailable,
      userMessage:
        'The AI provider you selected is no longer available through OpenCode. Choose another provider and continue.',
      retryable: false,
      requiresModelChange: true,
      requiresCredentials: false,
    }),
  },
  {
    test: (h) => /timed?[\s_-]?out|\betimedout\b|abort/i.test(h),
    classify: () => ({
      kind: ProviderFailureKind.timeout,
      userMessage:
        'The AI provider took too long to answer and the request timed out. Your work has been kept exactly as it was.',
      retryable: true,
      requiresModelChange: false,
      requiresCredentials: false,
    }),
  },
  {
    test: (h) => /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket hang up|fetch failed|network|getaddrinfo/i.test(h),
    classify: () => ({
      kind: ProviderFailureKind.networkFailure,
      userMessage:
        'Nexora Entity could not reach the AI provider. This is a connection problem, not a problem with your information.',
      retryable: true,
      requiresModelChange: false,
      requiresCredentials: false,
    }),
  },
  {
    test: (h) => /temporarily[\s_-]?unavailable|service[\s_-]?unavailable|\b503\b|overloaded|capacity|try again later/i.test(h),
    classify: () => ({
      kind: ProviderFailureKind.temporarilyUnavailable,
      userMessage:
        'The AI provider is temporarily unavailable. Nexora Entity kept everything and will continue once it responds, or you can switch provider now.',
      retryable: true,
      requiresModelChange: false,
      requiresCredentials: false,
    }),
  },
  {
    test: (h) => /content[\s_-]?(filter|policy)|safety|blocked by/i.test(h),
    classify: () => ({
      kind: ProviderFailureKind.contentFiltered,
      userMessage:
        'The AI provider declined this particular request under its own content policy. Nothing about your information was lost.',
      retryable: false,
      requiresModelChange: true,
      requiresCredentials: false,
    }),
  },
  {
    test: (h) => /context[\s_-]?(length|window|overflow)|too many tokens|prompt is too long|maximum context/i.test(h),
    classify: () => ({
      kind: ProviderFailureKind.contextOverflow,
      userMessage:
        'This request was larger than the selected model can accept. Choose a model with a larger context window to continue.',
      retryable: false,
      requiresModelChange: true,
      requiresCredentials: false,
    }),
  },
  {
    test: (h) => /stream[\s_-]?closed|no (valid )?json|malformed|unexpected token|could not parse/i.test(h),
    classify: () => ({
      kind: ProviderFailureKind.invalidResponse,
      userMessage:
        'The AI provider returned a response Nexora Entity could not read. The analysis was not applied and your information is unchanged.',
      retryable: true,
      requiresModelChange: false,
      requiresCredentials: false,
    }),
  },
  {
    test: (h) => /\b500\b|internal server error|\b502\b|\b503\b/i.test(h),
    classify: () => ({
      kind: ProviderFailureKind.serverError,
      userMessage: 'The AI provider reported an internal error. Your information is safe and the step can be repeated.',
      retryable: true,
      requiresModelChange: false,
      requiresCredentials: false,
    }),
  },
  {
    test: (h) => /refus|declin|unable to (comply|assist)/i.test(h),
    classify: () => ({
      kind: ProviderFailureKind.refused,
      userMessage:
        'The AI provider declined to answer this request. This is a provider decision, not a problem with your entity data.',
      retryable: false,
      requiresModelChange: true,
      requiresCredentials: false,
    }),
  },
];

const DEFAULT: ProviderFailureClassification = {
  kind: ProviderFailureKind.unknown,
  userMessage:
    'The AI provider did not complete the request. All of your information has been kept exactly as it was.',
  retryable: true,
  requiresModelChange: false,
  requiresCredentials: false,
};

export function classifyProviderFailure(error: unknown): ProviderFailureClassification {
  // An error that was already classified by the bridge carries the answer in its context. The
  // provider's own words are gone from the message by this point — the message is the plain
  // language written for the person — so re-deriving the classification from it would lose the
  // real cause and report every failure as unknown.
  const carried = carriedClassification(error);
  if (carried) return carried;

  const raw =
    error instanceof Error
      ? `${error.message} ${(error as { cause?: unknown }).cause instanceof Error ? ((error as { cause: Error }).cause.message) : String((error as { cause?: unknown }).cause ?? '')}`
      : typeof error === 'string'
        ? error
        : safeStringify(error);

  for (const rule of RULES) {
    if (rule.test(raw)) return { ...rule.classify(raw), raw };
  }
  return { ...DEFAULT, raw };
}

/**
 * Recover a classification the bridge already made.
 *
 * `aiProviderError` records the classification it was given in the error's context. When a caller
 * classifies that error again, the original answer is authoritative: it was derived from the
 * provider's own response, and re-deriving it from the plain-language message would replace a
 * precise cause with "unknown".
 */
function carriedClassification(error: unknown): ProviderFailureClassification | null {
  if (!error || typeof error !== 'object') return null;
  const context = (error as { context?: Record<string, unknown> }).context;
  if (!context) return null;
  const kind = context['failureKind'];
  if (typeof kind !== 'string') return null;
  const known = Object.values(ProviderFailureKind) as string[];
  if (!known.includes(kind)) return null;
  const raw = typeof context['raw'] === 'string' ? (context['raw'] as string) : undefined;
  const message = (error as { message?: unknown }).message;
  return {
    kind: kind as ProviderFailureKind,
    userMessage: typeof message === 'string' && message ? message : DEFAULT.userMessage,
    retryable: context['retryable'] === true,
    requiresModelChange: context['requiresModelChange'] === true,
    requiresCredentials: context['requiresCredentials'] === true,
    raw,
  };
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

/** Map a classification to the domain-specific error code stored on the configuration. */
export function failureCode(kind: ProviderFailureKind): string {
  return `ai_provider_${kind}`;
}