import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { config } from '@nexora/core/config';
import { toActionableError, UserDataError } from '@nexora/core';
import {
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

  const result = await verifyModel(ref, { operation: 'account_configuration' });

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