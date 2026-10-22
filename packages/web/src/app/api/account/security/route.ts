import { NextResponse } from 'next/server';
import { toActionableError, UserDataError } from '@nexora/core';
import { findUserByUsername, verifySecurityAnswer } from '@nexora/db';
import { requireUser } from '@/lib/server';
import { updateSecurityAnswer } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Change the security question and answer.
 *
 * The person must prove they know the current answer before the pair is replaced, so a session
 * that has been stolen cannot be used to take the account over permanently. Changing the pair
 * ends every other session, because a secret that has just been exposed is not safe to keep
 * using anywhere else.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser('/app/settings');

    let payload: { currentAnswer?: unknown; newQuestion?: unknown; newAnswer?: unknown };
    try {
      payload = (await request.json()) as typeof payload;
    } catch {
      return NextResponse.json(
        { ok: false, error: UserDataError.invalid('body', 'The request could not be read.').toJSON() },
        { status: 400 },
      );
    }

    const currentAnswer = typeof payload.currentAnswer === 'string' ? payload.currentAnswer : '';
    const newQuestion = typeof payload.newQuestion === 'string' ? payload.newQuestion.trim() : '';
    const newAnswer = typeof payload.newAnswer === 'string' ? payload.newAnswer : '';

    if (newQuestion.length < 8 || newQuestion.length > 200) {
      return NextResponse.json(
        {
          ok: false,
          error: UserDataError.invalid('newQuestion', 'Choose a security question of at least 8 characters.').toJSON(),
        },
        { status: 400 },
      );
    }
    if (newAnswer.trim().length < 2 || newAnswer.length > 200) {
      return NextResponse.json(
        { ok: false, error: UserDataError.invalid('newAnswer', 'Please give an answer.').toJSON() },
        { status: 400 },
      );
    }

    const record = await findUserByUsername(user.username);
    if (!record) {
      return NextResponse.json(
        { ok: false, error: { message: 'That account could not be found.', code: 'auth_forbidden', domain: 'auth' } },
        { status: 404 },
      );
    }

    if (!verifySecurityAnswer(currentAnswer, record.security_answer_hash, record.security_answer_salt)) {
      // The current answer is wrong. This is a validation failure, not a system failure, and it
      // must not reveal anything beyond that.
      return NextResponse.json(
        {
          ok: false,
          error: UserDataError.invalid('currentAnswer', 'That is not the current security answer.').toJSON(),
        },
        { status: 400 },
      );
    }

    await updateSecurityAnswer(user.id, { securityQuestion: newQuestion, securityAnswer: newAnswer });

    return NextResponse.json({
      ok: true,
      data: { securityQuestion: newQuestion, otherSessionsEnded: true },
    });
  } catch (err) {
    const error = toActionableError(err);
    return NextResponse.json({ ok: false, error }, { status: error.status });
  }
}
