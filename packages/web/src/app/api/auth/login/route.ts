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

function wantsHtml(request: Request): boolean {
  const accept = request.headers.get('accept') ?? '';
  if (!accept) return false;
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

type LoginPayload = {
  username?: unknown;
  securityQuestion?: unknown;
  securityAnswer?: unknown;
};

async function readLoginPayload(request: Request): Promise<LoginPayload> {
  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    try {
      return (await request.json()) as LoginPayload;
    } catch {
      return {};
    }
  }
  try {
    const form = await request.formData();
    return {
      username: form.get('username'),
      securityQuestion: form.get('securityQuestion'),
      securityAnswer: form.get('securityAnswer'),
    };
  } catch {
    return {};
  }
}

export async function POST(request: Request) {
  const payload = await readLoginPayload(request);

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json(
      {
        ok: false,
        error: UserDataError.invalid(first?.path.join('.') ?? 'form', first?.message ?? 'Check the form.').toJSON(),
      },
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
      secure: config().cookieSecure,
      expires: session.expiresAt,
    });
    const next = '/app';
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
