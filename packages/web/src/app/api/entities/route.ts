import { NextResponse } from 'next/server';
import { cookies, headers } from 'next/headers';
import { config } from '@nexora/core/config';
import { createLogger } from '@nexora/core';
import { createEntity, findUserByUsername, listEntitiesForUser, resolveSession } from '@nexora/db';
import { ensurePlatformSubdomain } from '@nexora/deploy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api:entities');

export async function GET() {
  const store = await cookies();
  const user = await resolveSession(store.get(config().sessionCookieName)?.value);
  if (!user) return NextResponse.json({ ok: false, error: { message: 'Sign in first.' } }, { status: 401 });
  const entities = await listEntitiesForUser(user.id);
  return NextResponse.json({ ok: true, entities });
}

/** True when the caller is a browser navigating rather than a fetch caller wanting JSON. */
function wantsHtml(request: Request): boolean {
  const accept = request.headers.get('accept') ?? '';
  return accept.includes('text/html');
}

/**
 * Create an entity. The AI provider/model panel opens immediately after this
 * (spec A5): AI is intrinsic to the platform, so there is no "do you want AI?" question.
 */
export async function POST(request: Request) {
  const store = await cookies();
  const user = await resolveSession(store.get(config().sessionCookieName)?.value);
  if (!user) return NextResponse.json({ ok: false, error: { message: 'Sign in first.' } }, { status: 401 });

  let requestedName = '';
  try {
    const form = await request.formData();
    requestedName = String(form.get('displayName') ?? '');
  } catch {
    requestedName = '';
  }

  const account = await findUserByUsername(user.username);
  const displayName = requestedName.trim() || account?.full_name?.trim() || 'New entity';

  try {
    const entity = await createEntity({ userId: user.id, displayName });
    try {
      await ensurePlatformSubdomain(entity.id);
    } catch (err) {
      log.warn('could not provision the platform subdomain yet', {
        entityId: entity.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
    const h = await headers();
    const next = `/app/stages/A_identity?entity=${entity.id}&openProvider=1`;
    const payload = {
      ok: true,
      entityId: entity.id,
      slug: entity.slug,
      next,
      requestId: h.get('x-request-id') ?? null,
    };

    // A plain form post from the studio must land the person on the new entity's first stage.
    // Returning JSON there would leave them staring at the same page with no feedback. Fetch
    // callers (and the HTTP smoke test) send an explicit JSON accept header and get the payload.
    if (wantsHtml(request)) {
      return NextResponse.redirect(new URL(next, request.url), 303);
    }
    return NextResponse.json(payload);
  } catch (err) {
    const { toActionableError } = await import('@nexora/core');
    const error = toActionableError(err);
    return NextResponse.json({ ok: false, error }, { status: error.status });
  }
}