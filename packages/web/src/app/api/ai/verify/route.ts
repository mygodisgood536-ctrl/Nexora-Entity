import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { config } from '@nexora/core/config';
import { toActionableError, UserDataError } from '@nexora/core';
import {
  getActiveAiConfiguration,
  logAiAttempt,
  markAiConfigurationFailed,
  resolveSession,
  upsertVerifiedAiConfiguration,
} from '@nexora/db';
import { verifyModel } from '@nexora/opencode-bridge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  providerId: z.string().min(1).max(120),
  modelId: z.string().min(1).max(200),
  /**
   * A key the person supplied for a provider that needs one.
   *
   * It is used for this test and for that provider's calls afterwards, and it is stored on the
   * account's configuration rather than in the browser. It is never returned by any endpoint and
   * never written to a log.
   */
  apiKey: z.string().min(1).max(500).optional(),
});

/**
 * Verify a provider/model with a real round trip, then make it the account's active
 * configuration. A configuration is only ever marked verified when a real call succeeded.
 */
export async function POST(request: Request) {
  const store = await cookies();
  const user = await resolveSession(store.get(config().sessionCookieName)?.value);
  if (!user) return NextResponse.json({ ok: false, error: { message: 'Sign in first.' } }, { status: 401 });

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: UserDataError.invalid('body', 'Could not read the request.').toJSON() }, { status: 400 });
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: UserDataError.invalid('model', 'Choose a provider and a model.').toJSON() }, { status: 400 });
  }

  const { fetchCatalogue } = await import('@nexora/opencode-bridge');
  const catalogue = await fetchCatalogue();
  const provider = catalogue.providers.find((p) => p.id === parsed.data.providerId);
  if (!provider) {
    const error = UserDataError.invalid('providerId', 'OpenCode no longer exposes that provider. Choose another one.');
    return NextResponse.json({ ok: false, error: error.toJSON() }, { status: 409 });
  }
  const model = provider.models.find((m) => m.id === parsed.data.modelId);
  if (!model) {
    const error = UserDataError.invalid('modelId', 'OpenCode no longer exposes that model. Choose another one.');
    return NextResponse.json({ ok: false, error: error.toJSON() }, { status: 409 });
  }

  const ref = {
    providerId: provider.id,
    providerName: provider.name,
    modelId: model.id,
    modelName: model.name,
  };

  // A key the person supplied is encrypted before it is stored and is never returned by an
  // endpoint. An existing key is reused unless a new one is supplied, so re-verifying the same
  // model does not silently discard the credential.
  const { encryptSecret, decryptSecret } = await import('@nexora/core/secrets');
  const storedVerification = (await getActiveAiConfiguration(user.id))?.verification ?? {};
  const existingKey =
    typeof storedVerification['providerKey'] === 'string' ? decryptSecret(storedVerification['providerKey']) : null;
  const apiKey = parsed.data.apiKey ?? existingKey;

  const result = await verifyModel(ref, { operation: 'account_configuration', apiKey });

  await logAiAttempt({
    userId: user.id,
    providerId: provider.id,
    modelId: model.id,
    operation: 'account_configuration',
    outcome: result.ok ? 'success' : 'failure',
    failureKind: result.error ? result.error.code.replace('ai_provider_', '') : null,
    message: result.ok ? result.probeText : (result.error?.message ?? 'verification failed'),
    latencyMs: result.latencyMs,
  });

  if (!result.ok) {
    // Record the failure against the active configuration so the dock can show it. This is a
    // provider failure, never an issue with the person's entity data.
    await markAiConfigurationFailed(user.id, {
      error: result.error?.message ?? 'The provider did not complete a test request.',
      code: result.error?.code ?? 'ai_provider_unknown',
    });
    const error = result.error ?? toActionableError(new Error('verification failed'));
    return NextResponse.json({ ok: false, error }, { status: error.status });
  }

  const saved = await upsertVerifiedAiConfiguration({
    userId: user.id,
    providerId: provider.id,
    providerName: provider.name,
    modelId: model.id,
    modelName: model.name,
    verification: {
      probe: result.probeText,
      latencyMs: result.latencyMs,
      opencodeVersion: catalogue.opencodeVersion,
      verifiedAt: new Date().toISOString(),
      // The encrypted key travels with the configuration so later calls can use it. It is never
      // returned to the browser.
      ...(apiKey ? { providerKey: encryptSecret(apiKey) } : {}),
    },
  });

  return NextResponse.json({
    ok: true,
    data: {
      providerName: provider.name,
      modelName: model.name,
      latencyMs: result.latencyMs,
      verifiedAt: saved.verified_at ? new Date(saved.verified_at).toISOString() : new Date().toISOString(),
    },
  });
}