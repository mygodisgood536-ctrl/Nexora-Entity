import { NextResponse } from 'next/server';
import { z } from 'zod';
import { UserDataError } from '@nexora/core';
import { usernameAvailable } from '@nexora/db';
import { signup } from '@/lib/auth';
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

function wantsHtml(request: Request): boolean {
  const accept = request.headers.get('accept') ?? '';
  if (!accept) return false;
  // Prefer HTML only when the caller explicitly asks for it and does not prefer JSON.
  let htmlQ = 0;
  let jsonQ = 0;
  for (const part of accept.split(',')) {
    const [type, ...params] = part.trim().split(';');
    if (!type) continue;
    const qParam = params.find((p) => p.trim().startsWith('q='));
    const q = qParam ? Number(qParam.split('=')[1]) || 0 : 1;
    if (type.includes('text/html')) htmlQ = q;
    if (type.includes('application/json')) jsonQ = q;
  }
  return htmlQ > 0 && htmlQ >= jsonQ;
}

type SignupPayload = {
  fullName?: unknown;
  username?: unknown;
  securityQuestion?: unknown;
  securityAnswer?: unknown;
};

async function readSignupPayload(request: Request): Promise<SignupPayload> {
  const contentType = request.headers.get('content-type') ?? '';
  // Branch on the media type the caller actually sent. Trying `formData()` first would swallow or
  // consume a JSON body, silently turning every field into `undefined` and rejecting a valid signup.
  if (contentType.includes('application/json')) {
    try {
      return (await request.json()) as SignupPayload;
    } catch {
      return {};
    }
  }
  try {
    const form = await request.formData();
    return {
      fullName: form.get('fullName'),
      username: form.get('username'),
      securityQuestion: form.get('securityQuestion'),
      securityAnswer: form.get('securityAnswer'),
    };
  } catch {
    return {};
  }
}

export async function POST(request: Request) {
  const payload = await readSignupPayload(request);

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

  const available = await usernameAvailable(String(parsed.data.username ?? ''));
  if (!available) {
    return NextResponse.json(
      { ok: false, error: UserDataError.conflict('That username is already in use. Choose a different one.').toJSON() },
      { status: 409 },
    );
  }

  try {
    const meta = await requestMetaAsync();
    // Spec §4: after signup the person must log in. No session is created here; the
    // server owns the destination URL so `next` and `justRegistered` are encoded once.
    await signup(parsed.data, meta);
    const next = '/login?next=%2Fapp&justRegistered=1';
    // A browser form post must navigate to the login page; a JSON caller receives the payload.
    if (wantsHtml(request)) {
      return NextResponse.redirect(new URL(next, request.url), 303);
    }
    return NextResponse.json({ ok: true, next });
  } catch (err) {
    const { toActionableError } = await import('@nexora/core');
    const error = toActionableError(err);
    return NextResponse.json({ ok: false, error }, { status: error.status });
  }
}