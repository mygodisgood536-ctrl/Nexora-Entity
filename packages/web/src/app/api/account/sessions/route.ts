import { NextResponse } from 'next/server';
import { toActionableError } from '@nexora/core';
import { revokeSessionById } from '@nexora/db';
import { requireUser } from '@/lib/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Revoke one of the signed-in person's sessions.
 *
 * A person who suspects someone else has access must be able to end that access without ending
 * their own session, so the endpoint revokes by identifier and refuses to touch a session that is
 * not theirs.
 */
export async function DELETE(request: Request) {
  try {
    const user = await requireUser('/app/settings');
    let payload: { sessionId?: unknown };
    try {
      payload = (await request.json()) as { sessionId?: unknown };
    } catch {
      return NextResponse.json(
        { ok: false, error: { message: 'The request could not be read.', code: 'user_data_invalid', domain: 'user_data' } },
        { status: 400 },
      );
    }

    const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : '';
    if (!sessionId) {
      return NextResponse.json(
        { ok: false, error: { message: 'A session must be named.', code: 'user_data_invalid', domain: 'user_data' } },
        { status: 400 },
      );
    }

    const revoked = await revokeSessionById(sessionId, user.id);
    if (!revoked) {
      // The session does not exist, is already revoked, or belongs to someone else. The three are
      // deliberately indistinguishable.
      return NextResponse.json(
        { ok: false, error: { message: 'That session could not be ended.', code: 'auth_forbidden', domain: 'auth' } },
        { status: 403 },
      );
    }

    return NextResponse.json({ ok: true, data: { sessionId, revokedAt: new Date().toISOString() } });
  } catch (err) {
    const error = toActionableError(err);
    return NextResponse.json({ ok: false, error }, { status: error.status });
  }
}
