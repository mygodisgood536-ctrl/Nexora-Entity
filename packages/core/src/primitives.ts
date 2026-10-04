/** Core primitives shared by every Nexora Entity package. */

import { z } from 'zod';
import { STAGE_KEYS } from './vocabulary';

export const uuidSchema = z.string().uuid();

/** Canonical, URL-safe public slug. */
export const slugSchema = z
  .string()
  .min(2)
  .max(48)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and single hyphens.');

export const stageKeySchema = z.enum(STAGE_KEYS);

/** A non-empty, trimmed single-line value. */
export const lineSchema = z.string().trim().min(1, 'This cannot be empty.');

export const urlSchema = z
  .string()
  .trim()
  .min(4, 'Enter a full web address.')
  .max(2048)
  .refine((v) => /^https?:\/\/[^\s]+\.[^\s]+/i.test(v) || /^[^\s]+\.[^\s]{2,}/.test(v), {
    message: 'Enter a complete web address, for example https://example.com',
  });

/** Optional/blank-tolerant URL. */
export const optionalUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .refine((v) => v === '' || urlSchema.safeParse(v).success, { message: 'Enter a complete web address.' });

export const emailSchema = z.string().trim().toLowerCase().email('Enter a valid email address.');

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'Usernames need at least 3 characters.')
  .max(32, 'Usernames can be at most 32 characters.')
  .regex(/^[a-z0-9][a-z0-9._-]*$/, 'Use letters, numbers, dots, hyphens and underscores.');

export const passwordLikeAnswerSchema = z.string().trim().min(2, 'Please give an answer.').max(200);

export const fullNameSchema = z
  .string()
  .trim()
  .min(2, 'Enter your full name.')
  .max(120, 'That name is too long.');

export const securityQuestionSchema = z
  .string()
  .trim()
  .min(8, 'Choose a security question of at least 8 characters.')
  .max(200);

/** ISO period. Either open ended. */
export interface Period {
  start?: string | null;
  end?: string | null;
  current?: boolean;
  label?: string | null;
}

export const periodSchema = z
  .object({
    start: z.string().trim().min(1).max(64).nullish(),
    end: z.string().trim().min(1).max(64).nullish(),
    current: z.boolean().optional(),
    label: z.string().trim().max(120).nullish(),
  })
  .nullable();

/** Confidence is a first-class value, never hidden. 0..1. */
export type Confidence = number;

export function clampConfidence(v: number): Confidence {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

export function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Monotonic-ish wall clock helper so tests can freeze time. */
export function nowIso(): string {
  return new Date().toISOString();
}

export type Result<T, E = unknown> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

/** Promise.allSettled that never throws. */
export async function settle<T>(
  items: readonly T[],
  fn: (item: T) => Promise<unknown>,
): Promise<{ item: T; ok: boolean; error?: unknown }[]> {
  const results = await Promise.allSettled(items.map((item) => fn(item)));
  return results.map((r, i) =>
    r.status === 'fulfilled'
      ? { item: items[i] as T, ok: true }
      : { item: items[i] as T, ok: false, error: r.reason },
  );
}

/** Deterministic JSON stringify with sorted keys — for stable hashes and diffs. */
export function stableJson(value: unknown): string {
  const seen = new WeakSet<object>();
  const walk = (v: unknown): unknown => {
    if (v === null || typeof v !== 'object') return v;
    if (seen.has(v as object)) return '[circular]';
    seen.add(v as object);
    if (Array.isArray(v)) return v.map(walk);
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = walk((v as Record<string, unknown>)[k]);
    }
    return out;
  };
  return JSON.stringify(walk(value));
}

export function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, Math.max(0, n - 1))}…`;
}

export function uniq<T>(items: readonly T[]): T[] {
  return [...new Set(items)];
}

export function groupBy<T, K extends string>(items: readonly T[], key: (item: T) => K): Record<K, T[]> {
  const out = {} as Record<K, T[]>;
  for (const item of items) {
    const k = key(item);
    (out[k] ??= []).push(item);
  }
  return out;
}

export function sum(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

export function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : sum(values) / values.length;
}

export function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}