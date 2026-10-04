import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { config } from '@nexora/core/config';
import { UserDataError } from '@nexora/core';
import { login, startSession } from '@/lib/auth';
import { requestMetaAsync } from '@/lib/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  username: z.string().trim().min(1, 'Enter your username.').max(64),
  securityQuestion: z.string().trim().min(1, 'Enter your security question.').max(200),
  securityAnswer: z.string().trim().min(1, 'Enter your security answer.').max(200),
});

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: UserDataError.invalid('body', 'The request could not be read. Please try again.').toJSON() },
      { status: 400 },
    );
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json(
      { ok: false, error: UserDataError.invalid(first?.path.join('.') ?? 'form', first?.message ?? 'Check the form.').toJSON() },
      { status: 400 },
    );
  }

  try {
    const meta = await requestMetaAsync();
    const user = await login(parsed.data, meta);
    const session = await startSession(user.userId, meta);
    const store = await cookies();
    store.set(config().sessionCookieName, session.token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: config().platformOrigin.startsWith('https://'),
      expires: session.expiresAt,
    });
    return NextResponse.json({ ok: true, next: '/app' });
  } catch (err) {
    const { toActionableError } = await import('@nexora/core');
    const error = toActionableError(err);
    return NextResponse.json({ ok: false, error }, { status: error.status });
  }
}