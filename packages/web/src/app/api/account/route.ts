import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { config } from '@nexora/core/config';
import { toActionableError } from '@nexora/core';
import {
  listEntitiesForUser,
  listSessionsForUser,
  updateUserFullName,
  hashToken,
} from '@nexora/db';
import { requireUser } from '@/lib/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The signed-in person's account.
 *
 * Section 30 asks for "clear controls for user data and connected accounts", and the account is
 * the first of them: what the account is called, which sessions are open, and which entities
 * belong to it. Nothing here is sensitive beyond what the person already owns, and the session
 * tokens themselves are never returned.
 */
export async function GET() {
  try {
    const user = await requireUser('/app/settings');
    const store = await cookies();
    const token = store.get(config().sessionCookieName)?.value;
    const [entities, sessions] = await Promise.all([
      listEntitiesForUser(user.id),
      listSessionsForUser(user.id, token ? hashToken(token) : undefined),
    ]);

    return NextResponse.json({
      ok: true,
      data: {
        user: {
          id: user.id,
          fullName: user.full_name,
          username: user.username,
          createdAt: user.created_at,
        },
        sessions: sessions.map((s) => ({
          id: s.id,
          createdAt: s.createdAt,
          expiresAt: s.expiresAt,
          revokedAt: s.revokedAt,
          ip: s.ip,
          userAgent: s.userAgent,
          current: s.current,
        })),
        entities: entities.map((e) => ({
          id: e.id,
          displayName: e.display_name,
          slug: e.slug,
          status: e.status,
          publishedAt: e.published_at,
        })),
      },
    });
  } catch (err) {
    const error = toActionableError(err);
    return NextResponse.json({ ok: false, error }, { status: error.status });
  }
}

/**
 * Update the account's name.
 *
 * The username is not changeable: it is half of the sign-in identity, and the product promises a
 * stable identifier that survives changes. The full name is presentation and is safe to change.
 */
export async function PATCH(request: Request) {
  try {
    const user = await requireUser('/app/settings');
    let payload: { fullName?: unknown };
    try {
      payload = (await request.json()) as { fullName?: unknown };
    } catch {
      return NextResponse.json(
        { ok: false, error: { message: 'The request could not be read.', code: 'user_data_invalid', domain: 'user_data' } },
        { status: 400 },
      );
    }

    const fullName = typeof payload.fullName === 'string' ? payload.fullName.trim() : '';
    if (fullName.length < 2 || fullName.length > 120) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            message: 'Enter a full name between 2 and 120 characters.',
            code: 'user_data_invalid',
            domain: 'user_data',
          },
        },
        { status: 400 },
      );
    }

    await updateUserFullName(user.id, fullName);
    return NextResponse.json({ ok: true, data: { user: { id: user.id, fullName, username: user.username } } });
  } catch (err) {
    const error = toActionableError(err);
    return NextResponse.json({ ok: false, error }, { status: error.status });
  }
}
