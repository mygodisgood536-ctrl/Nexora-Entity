/**
 * Authentication.
 *
 * Spec §4: signup takes exactly four fields — Full Name, Username, Security Question,
 * Security Answer. Login takes Username, Security Question and Security Answer. Both are
 * functional, secure and persistent. The security answer is stored as a scrypt hash with a
 * per-account salt; it is never kept in plaintext, and matching is case/whitespace tolerant
 * so a small typo does not lock anyone out.
 */

import { config } from '@nexora/core/config';
import { AuthError, createLogger } from '@nexora/core';
import {
  createSession,
  findUserById,
  findUserByUsername,
  hashSecurityAnswer,
  insertUser,
  normalizeQuestion,
  recordLoginAttempt,
  registerFailedAttempt,
  registerSuccessfulAttempt,
  revokeAllSessions,
  revokeSession,
  usernameAvailable,
  verifySecurityAnswer,
} from '@nexora/db';

const log = createLogger('auth');

export interface SignupInput {
  fullName: string;
  username: string;
  securityQuestion: string;
  securityAnswer: string;
}

export interface LoginInput {
  username: string;
  securityQuestion: string;
  securityAnswer: string;
}

export async function signup(input: SignupInput, meta: { ip?: string; userAgent?: string }): Promise<{ userId: string }> {
  if (!(await usernameAvailable(input.username))) {
    throw AuthError.usernameTaken();
  }
  const { hash, salt } = hashSecurityAnswer(input.securityAnswer);
  const user = await insertUser({
    fullName: input.fullName,
    username: input.username,
    securityQuestion: input.securityQuestion,
    answerHash: hash,
    answerSalt: salt,
  });
  await recordLoginAttempt({ userId: user.id, username: input.username, succeeded: true, ip: meta.ip });
  log.info('account created', { username: user.username });
  return { userId: user.id };
}

export interface LoginOutcome {
  userId: string;
  username: string;
  fullName: string;
}

export async function login(input: LoginInput, meta: { ip?: string; userAgent?: string }): Promise<LoginOutcome> {
  const user = await findUserByUsername(input.username);
  if (!user) {
    await recordLoginAttempt({ userId: null, username: input.username, succeeded: false, ip: meta.ip });
    // Deliberately does not reveal whether the username exists.
    throw AuthError.invalidCredentials();
  }

  if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
    await recordLoginAttempt({ userId: user.id, username: input.username, succeeded: false, ip: meta.ip });
    throw AuthError.accountLocked();
  }

  const questionMatches = normalizeQuestion(input.securityQuestion) === normalizeQuestion(user.security_question);
  const answerMatches = verifySecurityAnswer(input.securityAnswer, user.security_answer_hash, user.security_answer_salt);

  if (!questionMatches || !answerMatches) {
    await registerFailedAttempt(user.id);
    await recordLoginAttempt({ userId: user.id, username: input.username, succeeded: false, ip: meta.ip });
    throw AuthError.invalidCredentials();
  }

  await registerSuccessfulAttempt(user.id);
  await recordLoginAttempt({ userId: user.id, username: input.username, succeeded: true, ip: meta.ip });
  log.info('signed in', { username: user.username });
  return { userId: user.id, username: user.username, fullName: user.full_name };
}

export async function startSession(
  userId: string,
  meta: { ip?: string; userAgent?: string },
): Promise<{ token: string; expiresAt: Date }> {
  return createSession(userId, meta);
}

export async function endSession(token: string | undefined): Promise<void> {
  if (token) await revokeSession(token);
}

export async function endAllSessions(userId: string): Promise<void> {
  await revokeAllSessions(userId);
}

export async function updateSecurityAnswer(
  userId: string,
  input: { securityQuestion: string; securityAnswer: string },
): Promise<void> {
  const { updateSecurityAnswer: persist } = await import('@nexora/db');
  const { hash, salt } = hashSecurityAnswer(input.securityAnswer);
  await persist(userId, {
    question: input.securityQuestion,
    hash,
    salt,
  });
  // Changing the security answer invalidates existing sessions.
  await revokeAllSessions(userId);
  log.info('security answer changed', { userId });
}

export { findUserById, findUserByUsername, config };