/**
 * Development/test entry point for `@nexora/db`.
 *
 * Activated only through an explicit bundler alias in development or test. It mirrors the real
 * public surface, so application code imports the same names either way and a test exercises the
 * real repository contract rather than a parallel implementation.
 *
 * `pool-memory.ts` throws when `NODE_ENV=production`, so this module cannot load in a production
 * build even if the alias were somehow applied.
 */

// The `pool` surface, the memory repositories, and the shared store are disjoint by construction:
// `pool-memory.ts` owns `query`/`queryOne`/`transaction` and the coercers, `memory-store.ts` owns
// the row store, and the memory modules own their repository functions. Names are re-exported
// explicitly rather than with `export *` so an accidental name collision becomes a compile error
// here instead of a silent shadowing at the call site.
export {
  query,
  queryOne,
  transaction,
  closePool,
  healthcheck,
  getPool,
  num,
  bool,
  json,
  dateOrNull,
  toIso,
  type TxFn,
} from './pool-memory';

export {
  mem,
  assertNotProduction,
  clone,
  now,
  json as storeJson,
  num as storeNum,
  dateOrNull as storeDateOrNull,
  type Row,
} from './memory-store';

// Core: users, sessions, entities, stage progress, audit, settings.
export * from './memory';

// Evidence: sources, photos, portfolio files.
export * from './memory-evidence';

// Analysis: claims, evidence, identity links, conflicts, ambiguities, review items, runs.
export * from './memory-analysis';

// AI configuration and OpenCode snapshots.
export * from './memory-ai';

// Domains, deployments, revalidation jobs.
export * from './memory-deploy';

// Re-export the pure, non-database helpers from their real modules so behaviour is identical
// rather than reimplemented. Session cookies and hashing matter most: a test that logged in
// against a different cookie format would prove nothing about the real sign-in flow.
export {
  hashSecurityAnswer,
  normalizeAnswer,
  verifySecurityAnswer,
  normalizeUsername,
  normalizeQuestion,
  hashToken,
  newSessionToken,
  sessionCookie,
  clearSessionCookie,
  type SessionRow,
  type AuthenticatedUser,
} from './auth-crypto';
// The session summary shape is part of the public surface, so the memory double offers exactly
// the same type the SQL implementation does.
export type { SessionSummary } from './auth-crypto';

// Re-export the real record and input shapes so application code sees exactly one set of types.
// They are types only, so they cannot collide with the memory implementations above.
export type { UserRecord, EntityRecord, StageProgressRecord } from './repos-core';
export type {
  SourceRecord,
  SourceInsert,
  PhotoRecord,
  PortfolioFileRecord,
  PortfolioExtraction,
  ExtractedSourceData,
  SourceQualifiers,
} from './repos-sources';
export type {
  ClaimRecord,
  ClaimInsert,
  EvidenceRecord,
  IdentityLinkRecord,
  ConflictRecord,
  AmbiguityRecord,
  ReviewItemRecord,
  ReadinessRunRecord,
  EvidenceMinimumsRecord,
  CheckResult,
  BlockingIssue,
} from './repos-analysis';
export type { AiConfigurationRecord, SnapshotPayload } from './repos-ai';
export type { DomainRecord, DeploymentRecord, RevalidationJobRecord } from './repos-deploy';