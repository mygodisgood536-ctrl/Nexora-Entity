import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { config } from '@nexora/core/config';
import { latestOpencodeSnapshot, resolveSession, saveOpencodeSnapshot } from '@nexora/db';
import { fetchCatalogue } from '@nexora/opencode-bridge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Dynamic provider/model discovery. Nothing is hard-coded: the response is whatever OpenCode
 * reports right now. A snapshot is written for diagnostics, and the last snapshot is served
 * if OpenCode cannot be reached (clearly marked as stale rather than presented as live).
 */
export async function GET() {
  const store = await cookies();
  const user = await resolveSession(store.get(config().sessionCookieName)?.value);
  if (!user) return NextResponse.json({ ok: false, error: { message: 'Sign in first.' } }, { status: 401 });

  try {
    const catalogue = await fetchCatalogue();
    await saveOpencodeSnapshot({
      opencodeVersion: catalogue.opencodeVersion,
      providers: catalogue.providers.map((p) => ({
        id: p.id,
        name: p.name,
        connected: p.connected,
        credentialRequirement: p.credentialRequirement,
        modelCount: p.modelCount,
        defaultModelId: p.defaultModelId,
        models: p.models.slice(0, 20).map((m) => ({ id: m.id, name: m.name, context: m.contextWindow, free: m.isFree })),
      })),
      durationMs: catalogue.durationMs,
    });
    return NextResponse.json({ ok: true, data: catalogue });
  } catch (err) {
    const snapshot = await latestOpencodeSnapshot();
    const { toActionableError } = await import('@nexora/core');
    const error = toActionableError(err);
    return NextResponse.json(
      {
        ok: false,
        error: {
          ...error,
          staleSnapshot: snapshot
            ? {
                opencodeVersion: snapshot.opencodeVersion,
                fetchedAt: snapshot.fetchedAt,
                note: 'This is the last known provider list. It may no longer match what OpenCode exposes.',
                providers: snapshot.providers,
              }
            : null,
        },
      },
      { status: 200 },
    );
  }
}