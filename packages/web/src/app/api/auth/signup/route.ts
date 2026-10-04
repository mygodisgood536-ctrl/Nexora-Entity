import { NextResponse } from 'next/server';
import { z } from 'zod';
import { UserDataError } from '@nexora/core';
import { usernameAvailable } from '@nexora/db';
import { signup, startSession } from '@/lib/auth';
import { requestMetaAsync } from '@/lib/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  fullName: z.string().trim().min(2, 'Enter your full name.').max(120),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, 'Usernames need at least 3 characters.')
    .max(32, 'Usernames can be at most 32 characters.')
    .regex(/^[a-z0-9][a-z0-9._-]*$/, 'Use letters, numbers, dots, hyphens and underscores.'),
  securityQuestion: z.string().trim().min(8, 'Choose a security question of at least 8 characters.').max(200),
  securityAnswer: z.string().trim().min(2, 'Please give an answer.').max(200),
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
      {
        ok: false,
        error: UserDataError.invalid(first?.path.join('.') ?? 'form', first?.message ?? 'Check the form and try again.').toJSON(),
      },
      { status: 400 },
    );
  }

  const available = await usernameAvailable(parsed.data.username);
  if (!available) {
    return NextResponse.json(
      { ok: false, error: UserDataError.conflict('That username is already in use. Choose a different one.').toJSON() },
      { status: 409 },
    );
  }

  try {
    const meta = await requestMetaAsync();
    const { userId } = await signup(parsed.data, meta);
    // Spec §4: after signup the user must log in. Start a session so the next screen is the
    // login form pre-authenticated is NOT done; the user is sent to /login explicitly.
    void startSession;
    void userId;
    return NextResponse.json({ ok: true, next: '/login?next=%2Fapp&justRegistered=1' });
  } catch (err) {
    const { toActionableError } = await import('@nexora/core');
    const error = toActionableError(err);
    return NextResponse.json({ ok: false, error }, { status: error.status });
  }
}